import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Explicit test-only Auth/Storage shims. Not a test of Supabase's real HTTP services.
const db=new PGlite();const A=randomUUID(),B=randomUUID();
const SPEC='f1000000-0000-4000-8000-000000000001';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const query=async<T extends Record<string,unknown>=Record<string,unknown>>(sql:string,params:unknown[]=[])=> (await db.query<T>(sql,params)).rows;
let qa:{id:string;criteria:string[]},qb:{id:string;criteria:string[]},qe:{id:string;criteria:string[]};
let bp:string,docA:string;
async function isolated(fn:()=>Promise<unknown>){await db.exec('begin');try{await fn();await db.exec('set constraints all immediate');}finally{await db.exec('rollback; reset role');}}
async function asUser(id:string){await query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await db.exec('set local role authenticated');}
async function makeQuestion(user:string,scope='core',allocated=2){
 const topic=randomUUID(),id=randomUUID(),criteria=[randomUUID(),randomUUID()];
 await query("insert into public.topics(id,specification_id,subject_code,kind,reference,title,summary,scope,verified) values($1,$2,'4PH1','objective',$3,'TEST ONLY objective','Synthetic fixture, not a curriculum seed.',$4,true)",[topic,SPEC,`TEST-${topic}`,scope]);
 await query("insert into public.generated_questions(id,user_id,subject_code,topic_id,prompt,marks,difficulty,format,command_word,content_hash) values($1,$2,'4PH1',$3,'Calculate the force for the synthetic test object.',2,'standard','calculation','Calculate',$4)",[id,user,topic,hash(id)]);
 await query("insert into public.question_solutions(question_id,model_answer,examiner_explanation,common_mistakes,verification) values($1,'F = ma = 6 N','Synthetic fixture only',array['Missing units'],$2)",[id,JSON.stringify({scientific_status:'pass',mark_scheme_status:'pass',originality_status:'pass',model:'fixture-validator',generator_model:'fixture-generator'})]);
 await query("insert into public.mark_criteria(id,question_id,criterion_key,description,marks) values($1,$3,'M1','Uses force relationship',1),($2,$3,'A1','Correct result and unit',$4)",[criteria[0],criteria[1],id,allocated-1]);
 await query("update public.generated_questions set validation_status='validated' where id=$1",[id]);return {id,criteria};
}
async function makeMock(question=qa.id,blueprint=bp){
 const id=randomUUID();await query("insert into public.mock_exams(id,user_id,subject_code,blueprint_id) values($1,$2,'4PH1',$3)",[id,A,blueprint]);
 await query("insert into public.mock_exam_questions(mock_id,user_id,subject_code,question_id,position,question_label) values($1,$2,'4PH1',$3,1,'1')",[id,A,question]);
 await query("update public.mock_exams set status='ready' where id=$1",[id]);return id;
}
async function makeMark(options:{evidence?:string;award1?:number;award2?:number;earned?:number;ecf?:boolean;confidence?:number;accept?:boolean;validate?:boolean}={}){
 const attempt=randomUUID(),run=randomUUID();
 await query("insert into public.attempts(id,user_id,question_id,answer,status,submitted_at) values($1,$2,$3,'F = ma. The result is 6 N.','submitted',now())",[attempt,A,qa.id]);
 await query("insert into public.marking_runs(id,attempt_id,user_id,question_id,earned_marks,available_marks,confidence,feedback,model_id,input_sha256,verification) values($1,$2,$3,$4,$5,2,$6,'Synthetic test feedback','fixture-model',$7,'{\"status\":\"pass\"}')",[run,attempt,A,qa.id,options.earned??2,options.confidence??0.95,hash(attempt)]);
 await query("insert into public.criterion_awards(run_id,criterion_id,question_id,marks,evidence,ecf,explanation) values($1,$2,$4,$5,'F = ma',$7,'Relationship evidence'),($1,$3,$4,$6,$8,false,'Result evidence')",[run,qa.criteria[0],qa.criteria[1],qa.id,options.award1??1,options.award2??1,options.ecf??false,options.evidence??'6 N']);
 if(options.validate!==false)await query("update public.marking_runs set status='validated' where id=$1",[run]);
 if(options.accept!==false)await query("update public.attempts set status='marked',accepted_marking_id=$2 where id=$1",[attempt,run]);
 return {attempt,run};
}
before(async()=>{
 await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to authenticated;
 grant all on storage.objects,storage.buckets to service_role;`);
 const folder=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(folder)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,folder),'utf8'));
 await query('insert into auth.users(id) values($1),($2)',[A,B]);
 await db.exec('begin');qa=await makeQuestion(A);qb=await makeQuestion(B);qe=await makeQuestion(A,'extended');
 bp=randomUUID();await query("insert into public.paper_blueprints(id,specification_id,subject_code,code,title,total_marks,duration_minutes,core_only,verified_at,source_pages) values($1,$2,'4PH1','TEST/CORE','TEST ONLY',2,1,true,now(),'Synthetic fixture')",[bp,SPEC]);
 docA=randomUUID();const docB=randomUUID();
 for(const [id,user] of [[docA,A],[docB,B]]){
  await query("insert into public.documents(id,user_id,subject_code,kind,file_name,object_path,mime_type,byte_size,rights_attested_at) values($1,$2,'4PH1','paper','fixture.pdf',$3,'application/pdf',100,now())",[id,user,`${user}/${id}/original.pdf`]);
  await query("insert into storage.objects(bucket_id,name) values('revision-private',$1)",[`${user}/${id}/original.pdf`]);
 }
 await db.exec('commit');
});
after(async()=>{await db.close();});

test('all 44 application tables have RLS enabled',async()=>{const rows=await query<{relrowsecurity:boolean}>("select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");assert.equal(rows.length,44);assert.ok(rows.every(r=>r.relrowsecurity));});
test('catalog has three subjects and six verified paper blueprints',async()=>{assert.equal((await query('select * from public.subjects')).length,3);const p=await query<{total_marks:number;duration_minutes:number;core_only:boolean}>('select * from public.paper_blueprints where code not like \'TEST/%\'');assert.equal(p.length,6);assert.ok(p.every(p=>p.core_only?p.total_marks===110&&p.duration_minutes===120:p.total_marks===70&&p.duration_minutes===75));});
test('signup trigger creates a nonprivileged profile',async()=>assert.equal((await query('select * from public.profiles where user_id=$1',[A])).length,1));
test('RLS isolates learner documents',async()=>isolated(async()=>{await asUser(A);const rows=await query<{user_id:string}>('select user_id from public.documents');assert.equal(rows.length,1);assert.equal(rows[0].user_id,A);}));
test('RLS isolates generated questions',async()=>isolated(async()=>{await asUser(B);const rows=await query<{user_id:string}>('select user_id from public.generated_questions');assert.equal(rows.length,1);assert.equal(rows[0].user_id,B);}));
test('private storage objects are isolated by owner',async()=>isolated(async()=>{await asUser(A);const rows=await query<{name:string}>('select name from storage.objects');assert.equal(rows.length,1);assert.ok(rows[0].name.startsWith(`${A}/`));}));
test('the storage bucket is private and size-limited',async()=>{const [b]=await query<{public:boolean;file_size_limit:number}>('select public,file_size_limit from storage.buckets');assert.equal(b.public,false);assert.equal(Number(b.file_size_limit),26214400);});
for(const table of ['question_solutions','mark_criteria'])test(`browser cannot read ${table}`,async()=>assert.rejects(isolated(async()=>{await asUser(A);await query(`select * from public.${table}`);}),/permission denied/));
for(const table of ['generated_questions','marking_runs','criterion_awards','jobs','attempts'])test(`browser cannot write authoritative ${table}`,async()=>{const [r]=await query<{allowed:boolean}>('select has_table_privilege(\'authenticated\',$1,\'INSERT\') as allowed',[`public.${table}`]);assert.equal(r.allowed,false);});
test('browser cannot invoke a worker RPC',async()=>assert.rejects(isolated(async()=>{await asUser(A);await query('select * from public.claim_revision_job($1)',[randomUUID()]);}),/permission denied/));
test('cross-owner question attempts fail the composite FK',async()=>assert.rejects(isolated(async()=>{await query('insert into public.attempts(user_id,question_id) values($1,$2)',[A,qb.id]);}),/foreign key/));
test('document storage path cannot escape its owner/document namespace',async()=>assert.rejects(isolated(async()=>{await query("insert into public.documents(user_id,subject_code,kind,file_name,object_path,mime_type,byte_size,rights_attested_at) values($1,'4PH1','paper','bad.pdf','other/path.pdf','application/pdf',10,now())",[A]);}),/check constraint/));
test('validated question allocations must match the maximum',async()=>assert.rejects(isolated(async()=>{await makeQuestion(A,'core',3);}),/CRITERION_TOTAL_MISMATCH/));
test('validated questions cannot be silently edited',async()=>assert.rejects(isolated(async()=>{await query("update public.generated_questions set prompt='A changed question prompt' where id=$1",[qa.id]);}),/IMMUTABLE/));
test('validated criteria cannot be edited or reassigned',async()=>assert.rejects(isolated(async()=>{await query("update public.mark_criteria set description='Changed scheme' where id=$1",[qa.criteria[0]]);}),/IMMUTABLE/));
test('valid evidence-based marking can be atomically accepted',async()=>isolated(async()=>{const {attempt}=await makeMark();assert.equal((await query<{status:string}>('select status from public.attempts where id=$1',[attempt]))[0].status,'marked');}));
test('criterion overawards are rejected',async()=>assert.rejects(isolated(async()=>{await makeMark({award1:2,award2:0});}),/CRITERION_AWARD_INVALID/));
test('invented positive-mark evidence is rejected',async()=>assert.rejects(isolated(async()=>{await makeMark({evidence:'Never written'});}),/AWARD_EVIDENCE_INVALID/));
test('unpermitted ECF is rejected',async()=>assert.rejects(isolated(async()=>{await makeMark({ecf:true});}),/CRITERION_AWARD_INVALID/));
test('award sums must equal the recorded total',async()=>assert.rejects(isolated(async()=>{await makeMark({earned:1});}),/AWARD_TOTAL_MISMATCH/));
test('low confidence is held for review, not accepted',async()=>assert.rejects(isolated(async()=>{await makeMark({confidence:0.2});}),/MARKING_REQUIRES_REVIEW/));
test('an unvalidated marking run cannot be accepted',async()=>assert.rejects(isolated(async()=>{await makeMark({validate:false});}),/ACCEPTED_MARKING_NOT_VALIDATED/));
test('submitted answer evidence is immutable',async()=>assert.rejects(isolated(async()=>{const {attempt}=await makeMark();await query("update public.attempts set answer='rewritten' where id=$1",[attempt]);}),/ANSWER_LOCKED/));
test('validated marking runs are immutable',async()=>assert.rejects(isolated(async()=>{const {run}=await makeMark();await query("update public.marking_runs set feedback='changed' where id=$1",[run]);}),/IMMUTABLE/));
test('mock readiness enforces exact totals',async()=>assert.rejects(isolated(async()=>{const id=randomUUID();await query("insert into public.mock_exams(id,user_id,subject_code,blueprint_id) values($1,$2,'4PH1',$3)",[id,A,bp]);await query("update public.mock_exams set status='ready' where id=$1",[id]);}),/MOCK_TOTAL_MISMATCH/));
test('paper 1 cannot include extension-only questions',async()=>assert.rejects(isolated(async()=>{await makeMock(qe.id);}),/MOCK_QUESTION_NOT_ELIGIBLE/));
test('mock items cannot cross learner ownership',async()=>assert.rejects(isolated(async()=>{await makeMock(qb.id);}),/foreign key/));
test('starting a mock is idempotent and creates a server deadline',async()=>isolated(async()=>{const id=await makeMock();await query('select public.start_revision_mock($1,$2)',[id,A]);await query('select public.start_revision_mock($1,$2)',[id,A]);const [r]=await query<{n:number}>('select extract(epoch from deadline-started_at)::integer as n from public.mock_exams where id=$1',[id]);assert.equal(r.n,60);assert.equal((await query('select * from public.attempts where mock_id=$1',[id])).length,1);}));
test('extra time is applied from stored profile preferences',async()=>isolated(async()=>{await query('update public.profiles set extra_time_percent=25 where user_id=$1',[A]);const id=await makeMock();await query('select public.start_revision_mock($1,$2)',[id,A]);const [r]=await query<{n:number}>('select allotted_seconds as n from public.mock_exams where id=$1',[id]);assert.equal(r.n,75);}));
test('mock submission enqueues marking once and locks answers',async()=>isolated(async()=>{const id=await makeMock();await query('select public.start_revision_mock($1,$2)',[id,A]);const [a]=await query<{id:string}>('select id from public.attempts where mock_id=$1',[id]);await query('select public.save_revision_answer($1,$2,$3)',[a.id,A,'F = ma']);await query('select public.submit_revision_mock($1,$2)',[id,A]);await query('select public.submit_revision_mock($1,$2)',[id,A]);assert.equal((await query("select * from public.jobs where payload->>'attempt_id'=$1",[a.id])).length,1);}));
test('mock deadlines cannot be extended after starting',async()=>assert.rejects(isolated(async()=>{const id=await makeMock();await query('select public.start_revision_mock($1,$2)',[id,A]);await query("update public.mock_exams set deadline=deadline+interval '1 hour',allotted_seconds=allotted_seconds+3600 where id=$1",[id]);}),/MOCK_STRUCTURE_LOCKED/));
test('lease claims increment an attempt and fence stale workers',async()=>isolated(async()=>{const id=randomUUID(),old=randomUUID(),worker=randomUUID();await query("insert into public.jobs(id,user_id,kind,payload,idempotency_key,status,attempt_count,lease_token,lease_expires_at) values($1,$2,'generate_question','{}',$3,'running',1,$4,now()-interval '1 minute')",[id,A,`test:${id}`,old]);const rows=await query<{attempt_count:number}>('select * from public.claim_revision_job($1)',[worker]);assert.equal(rows[0].attempt_count,2);const [stale]=await query<{ok:boolean}>("select public.finish_revision_job($1,$2,1,'{}') as ok",[id,old]);assert.equal(stale.ok,false);const [current]=await query<{ok:boolean}>("select public.finish_revision_job($1,$2,2,'{}') as ok",[id,worker]);assert.equal(current.ok,true);}));
test('retry-exhausted leases fail rather than loop forever',async()=>isolated(async()=>{const id=randomUUID();await query("insert into public.jobs(id,user_id,kind,payload,idempotency_key,status,attempt_count,lease_token,lease_expires_at) values($1,$2,'generate_question','{}',$3,'running',3,$4,now()-interval '1 minute')",[id,A,`test:${id}`,randomUUID()]);assert.equal((await query('select * from public.claim_revision_job($1)',[randomUUID()])).length,0);assert.equal((await query<{status:string}>('select status from public.jobs where id=$1',[id]))[0].status,'failed');}));
test('usage increments stop exactly at the server limit',async()=>isolated(async()=>{for(const expected of [true,true,false]){const [r]=await query<{ok:boolean}>("select public.consume_revision_usage($1,'generation',2) as ok",[A]);assert.equal(r.ok,expected);}const [r]=await query<{used:number}>("select used from public.usage_counters where user_id=$1 and feature='generation'",[A]);assert.equal(r.used,2);}));
test('negative quota increments are rejected',async()=>assert.rejects(isolated(async()=>{await query("select public.consume_revision_usage($1,'generation',2,-1)",[A]);}),/INVALID_QUOTA_ARGUMENTS/));

// Qualification-route regressions. These are metadata/state tests, not live AI mocks.
test('catalog represents two programmes, four qualifications and nine paper mappings',async()=>{assert.equal((await query('select * from public.science_programmes')).length,2);assert.equal((await query('select * from public.science_qualifications')).length,4);assert.equal((await query('select * from public.qualification_papers')).length,9);});
test('Double Award database metadata preserves 330 marks and two awards',async()=>{const [q]=await query<{total_marks:number;award_count:number;exam_tier:string}>("select total_marks,award_count,exam_tier from public.science_qualifications where code='4SD0'");assert.equal(q.total_marks,330);assert.equal(q.award_count,2);assert.equal(q.exam_tier,'untiered');});
test('the new course catalog is readable but not writable by learners',async()=>{for(const table of ['science_programmes','science_qualifications','programme_qualifications','qualification_papers']){const [p]=await query<{read:boolean;write:boolean}>("select has_table_privilege('authenticated',$1,'SELECT') as read,has_table_privilege('authenticated',$1,'INSERT') as write",['public.'+table]);assert.equal(p.read,true);assert.equal(p.write,false);}});
test('profiles default to higher-demand practice without inventing an exam tier',async()=>{const [p]=await query<{practice_difficulty:string}>('select practice_difficulty from public.profiles where user_id=$1',[A]);assert.equal(p.practice_difficulty,'stretch');});
test('learners may save their own programme selection under existing profile RLS',async()=>isolated(async()=>{await asUser(A);await query("update public.profiles set programme_key='double_award',practice_difficulty='challenge' where user_id=$1",[A]);assert.equal((await query<{programme_key:string}>('select programme_key from public.profiles where user_id=$1',[A]))[0].programme_key,'double_award');}));
test('foundation is not accepted as a profile practice preference',async()=>assert.rejects(isolated(async()=>{await asUser(A);await query("update public.profiles set practice_difficulty='foundation' where user_id=$1",[A]);}),/check constraint/));
test('a learner cannot switch another learner programme through profile RLS',async()=>isolated(async()=>{await asUser(A);const r=await query("update public.profiles set programme_key='double_award' where user_id=$1 returning user_id",[B]);assert.equal(r.length,0);}));
test('Double Award cannot be mapped to Paper 2 in a new mock',async()=>assert.rejects(isolated(async()=>{const [p]=await query<{id:string}>("select id from public.paper_blueprints where code='4PH1/2P'");await query("insert into public.mock_exams(user_id,subject_code,blueprint_id,qualification_code) values($1,'4PH1',$2,'4SD0')",[A,p.id]);}),/foreign key/));
test('Double Award can link to its shared Paper 1 blueprint',async()=>isolated(async()=>{const [p]=await query<{id:string}>("select id from public.paper_blueprints where code='4PH1/1P'");await query("update public.profiles set programme_key='double_award' where user_id=$1",[A]);await query("insert into public.mock_exams(user_id,subject_code,blueprint_id,qualification_code) values($1,'4PH1',$2,'4SD0')",[A,p.id]);}));
test('separate-science profile cannot create a Double Award mock by changing request fields',async()=>assert.rejects(isolated(async()=>{const [p]=await query<{id:string}>("select id from public.paper_blueprints where code='4PH1/1P'");await query("update public.profiles set programme_key='separate_sciences' where user_id=$1",[A]);await query("insert into public.mock_exams(user_id,subject_code,blueprint_id,qualification_code) values($1,'4PH1',$2,'4SD0')",[A,p.id]);}),/QUALIFICATION_OUTSIDE_LEARNER_PROGRAMME/));
test('Double Award profile cannot bypass its programme by requesting a separate qualification',async()=>assert.rejects(isolated(async()=>{const [p]=await query<{id:string}>("select id from public.paper_blueprints where code='4PH1/2P'");await query("update public.profiles set programme_key='double_award' where user_id=$1",[A]);await query("insert into public.mock_exams(user_id,subject_code,blueprint_id,qualification_code) values($1,'4PH1',$2,'4PH1')",[A,p.id]);}),/QUALIFICATION_OUTSIDE_LEARNER_PROGRAMME/));
test('new Foundation-labelled question inserts are blocked without rewriting old rows',async()=>assert.rejects(isolated(async()=>{const [q]=await query<{topic_id:string}>('select topic_id from public.generated_questions where id=$1',[qa.id]);const id=randomUUID();await query("insert into public.generated_questions(id,user_id,subject_code,topic_id,prompt,marks,difficulty,format,command_word,content_hash) values($1,$2,'4PH1',$3,'Calculate this synthetic test value.',2,'foundation','calculation','Calculate',$4)",[id,A,q.topic_id,hash(id)]);}),/FOUNDATION_PRACTICE_DISABLED/));
test('new stretch questions can be stored as pending while independent checks run',async()=>isolated(async()=>{const [q]=await query<{topic_id:string}>('select topic_id from public.generated_questions where id=$1',[qa.id]);const id=randomUUID();await query("insert into public.generated_questions(id,user_id,subject_code,topic_id,prompt,marks,difficulty,format,command_word,content_hash) values($1,$2,'4PH1',$3,'Calculate this synthetic test value.',2,'stretch','calculation','Calculate',$4)",[id,A,q.topic_id,hash(id)]);}));
test('verified qualification paper mappings cannot be removed without invalidating the total',async()=>assert.rejects(isolated(async()=>{await query("delete from public.qualification_papers where qualification_code='4SD0' and subject_code='4PH1'");}),/QUALIFICATION_PAPER_TOTAL_MISMATCH/));
test('an unverified or wrong paper cannot be appended to Double Award',async()=>assert.rejects(isolated(async()=>{const [p]=await query<{id:string}>("select id from public.paper_blueprints where code='4PH1/2P'");await query("insert into public.qualification_papers(qualification_code,blueprint_id,subject_code,paper_reference) values('4SD0',$1,'4PH1','4SD0/2P')",[p.id]);}),/QUALIFICATION_PAPER_TOTAL_MISMATCH|PAPER_NOT_ELIGIBLE_FOR_QUALIFICATION/));
test('International GCSE qualification records cannot be relabelled as Higher-tier',async()=>assert.rejects(isolated(async()=>{await query("update public.science_qualifications set exam_tier='higher' where code='4SD0'");}),/check constraint/));
