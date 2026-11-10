import {z} from 'zod';
import {Difficulty,SubjectCode,QuestionSchema,type Question,type TopicContext,AssessmentError,validateQuestion,VerificationSchema} from './assessment.ts';
import {ProgrammeKey,QualificationCode,objectiveEligible,type Programme,GenerationSelectionSchema} from './qualifications.ts';
import {isTimeZone} from './security.ts';
const reserved=new Set(['admin','administrator','root','support','moderator','pearson','edexcel','scienceledger','system','security']);
export const Username=z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,19}$/).refine(s=>!reserved.has(s),'Choose a different username.');
export const Login=z.string().trim().toLowerCase().max(254).pipe(z.union([z.email(),Username]));
export const AuthInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('signin'),identifier:Login,password:z.string().min(1).max(128)}).strict(),
 z.object({action:z.literal('signup'),username:Username,email:z.email().max(254),password:z.string().min(12).max(128),privacy:z.literal(true)}).strict(),
 z.object({action:z.literal('reset'),email:z.email().max(254)}).strict(),z.object({action:z.literal('signout')}).strict(),
 z.object({action:z.literal('password'),password:z.string().min(12).max(128)}).strict()
]);
export const ProfileInput=z.object({display_name:z.string().trim().max(80),time_zone:z.string().max(80).refine(isTimeZone),daily_goal_minutes:z.number().int().min(5).max(180),extra_time_percent:z.union([z.literal(0),z.literal(25),z.literal(50),z.literal(100)]),programme_key:ProgrammeKey,practice_difficulty:Difficulty,share_study_stats:z.boolean(),friend_chat_enabled:z.boolean()}).strict();
export const FriendInput=z.discriminatedUnion('action',[z.object({action:z.literal('request'),username:Username}).strict(),z.object({action:z.enum(['accept','decline','remove','block','unblock']),id:z.uuid()}).strict()]);
export const ChatText=z.string().trim().min(1).max(2000).refine(s=>!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s));
export const ChatInput=z.object({peer:z.uuid(),body:ChatText,event:z.uuid()}).strict();
export const ReportInput=z.object({message:z.uuid(),reason:z.enum(['spam','harassment','unsafe','other']),details:z.string().trim().max(500).default('')}).strict();
export const CardInput=z.object({subject:SubjectCode,front:z.string().trim().min(3).max(6000),back:z.string().trim().min(1).max(12000)}).strict();
export const Rating=z.enum(['again','hard','good','easy']);
export type CardSchedule={repetitions:number;interval_days:number;ease:number;due_at:string};
export function scheduleReview(s:CardSchedule,rating:unknown,now:Date):CardSchedule{
 const r=Rating.parse(rating);if(!Number.isFinite(now.getTime())||!Number.isInteger(s.repetitions)||s.repetitions<0||!Number.isInteger(s.interval_days)||s.interval_days<0||s.interval_days>365||s.ease<1.3||s.ease>3)throw new Error('INVALID_CARD_SCHEDULE');
 if(r==='again')return {repetitions:0,interval_days:0,ease:Math.max(1.3,s.ease-.2),due_at:new Date(now.getTime()+600000).toISOString()};
 const ease=Math.max(1.3,Math.min(3,s.ease+(r==='hard'?-.15:r==='easy'?.15:0)));
 const days=Math.min(365,r==='hard'?Math.max(1,Math.ceil(s.interval_days*1.2)):r==='easy'?Math.max(4,Math.ceil(s.interval_days*ease)):s.repetitions===0?1:s.repetitions===1?3:Math.ceil(s.interval_days*ease));
 return {repetitions:Math.min(10000,s.repetitions+1),interval_days:days,ease,due_at:new Date(now.getTime()+days*86400000).toISOString()};
}
const coordinate=z.number().finite().min(0).max(800);
const Shape=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('line'),x1:coordinate,y1:coordinate,x2:coordinate,y2:coordinate,arrow:z.boolean()}).strict(),
 z.object({kind:z.literal('circle'),x:coordinate,y:coordinate,r:z.number().positive().max(200)}).strict(),
 z.object({kind:z.literal('rect'),x:coordinate,y:coordinate,width:z.number().positive().max(800),height:z.number().positive().max(800)}).strict(),
 z.object({kind:z.literal('label'),x:coordinate,y:coordinate,text:z.string().min(1).max(160)}).strict()
]);
export const Visual=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('diagram'),alt:z.string().min(5).max(1000),width:z.number().int().min(100).max(800),height:z.number().int().min(100).max(800),shapes:z.array(Shape).min(1).max(60)}).strict(),
 z.object({kind:z.literal('graph'),alt:z.string().min(5).max(1000),x_label:z.string().min(1).max(80),y_label:z.string().min(1).max(80),points:z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).min(2).max(60)}).strict()
]);
export const Packet=z.object({question:QuestionSchema,visuals:z.array(Visual).max(3)}).strict();
export type QuestionPacket=z.infer<typeof Packet>;
export function validatePacket(input:unknown,topic:TopicContext,verification:unknown,programme:Programme,marks?:number){const p=Packet.parse(input);if(!objectiveEligible(programme,topic))throw new AssessmentError('OBJECTIVE_OUTSIDE_SELECTED_COURSE');validateQuestion(p.question,topic,verification,marks);for(const v of p.visuals){if(v.kind==='graph'&&new Set(v.points.map(p=>p.x)).size<2)throw new AssessmentError('INVALID_GRAPH_AXIS');if(v.kind==='diagram'&&v.shapes.some(s=>s.kind==='label'&&(s.x>v.width||s.y>v.height)))throw new AssessmentError('DIAGRAM_OUT_OF_BOUNDS');}return p;}
export const GenerationInput=z.object({selection:GenerationSelectionSchema,purpose:z.enum(['practice','cards','game']).default('practice'),event:z.uuid()}).strict();
export const MockInput=z.object({qualification:QualificationCode,blueprint:z.uuid().nullable(),event:z.uuid()}).strict();
export const ExtractedItem=z.object({label:z.string().min(1).max(40),page:z.number().int().min(1).max(100),prompt:z.string().min(1).max(20000),marks:z.number().int().min(1).max(100).nullable(),command:z.string().max(40).nullable(),format:z.string().max(40).nullable(),confidence:z.number().min(0).max(1),content:z.array(z.object({kind:z.literal('text'),text:z.string().max(20000)}).strict()).max(12),knowledge:z.array(z.string().max(200)).max(15)}).strict();
export const Extraction=z.object({page_count:z.number().int().min(1).max(100),pages:z.array(z.object({number:z.number().int().min(1).max(100),text:z.string().max(100000),confidence:z.number().min(0).max(1),uncertainties:z.array(z.string().max(500)).max(15)}).strict()).min(1).max(100),items:z.array(ExtractedItem).max(200),summary:z.string().max(6000)}).strict();
export function validateExtraction(input:unknown){const e=Extraction.parse(input);if(e.pages.length!==e.page_count||new Set(e.pages.map(p=>p.number)).size!==e.page_count||e.pages.some(p=>p.number>e.page_count)||new Set(e.items.map(q=>q.label)).size!==e.items.length||e.items.some(q=>q.page>e.page_count))throw new Error('INVALID_DOCUMENT_STRUCTURE');return e;}
export type Evidence={attempt_id:string;question_id:string;topic_id:string;earned:number;available:number;at:string;accepted:boolean;source:'assessment'|'game'|'flashcard'};
export function mastery(topics:TopicContext[],rows:Evidence[],programme:Programme,now:Date){
 if(!Number.isFinite(now.getTime()))throw new Error('INVALID_CLOCK');const ids=new Set<string>();for(const r of rows){if(r.source!=='assessment'||!r.accepted)continue;if(ids.has(r.attempt_id))throw new Error('DUPLICATE_EVIDENCE');ids.add(r.attempt_id);if(!Number.isInteger(r.earned)||!Number.isInteger(r.available)||r.available<1||r.earned<0||r.earned>r.available||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)>now.getTime())throw new Error('INVALID_EVIDENCE');}
 return topics.filter(t=>objectiveEligible(programme,t)).map(t=>{const unique=new Map<string,Evidence>();for(const r of rows.filter(r=>r.topic_id===t.id&&r.accepted&&r.source==='assessment')){const old=unique.get(r.question_id);if(!old||Date.parse(old.at)<Date.parse(r.at))unique.set(r.question_id,r);}let earned=0,available=0;for(const r of unique.values()){const w=2**(-(now.getTime()-Date.parse(r.at))/(30*86400000));earned+=r.earned*w;available+=r.available*w;}const n=unique.size,recall=n?(earned+1)/(available+2):null;return {topic_id:t.id,subject:t.subject_code,unique_questions:n,weighted_marks:available,estimated_recall:recall,status:n===0?'unassessed':n<3||available<6?'insufficient':recall!>=.85&&n>=8?'secure':recall!<.65?'priority':'developing',confidence:n<3?'low':n<12?'limited':'higher'};});
}
export const GradeBoundaries=z.object({qualification:QualificationCode,maximum:z.number().int().positive(),series:z.string().min(3),source_url:z.url().refine(u=>u.startsWith('https://qualifications.pearson.com/')),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),verified:z.literal(true),entries:z.array(z.object({label:z.string().max(5),threshold:z.number().int().nonnegative()}).strict()).min(2)}).strict();
export type GradeEvidence={id:string;qualification:string;marks:number;available:number;complete:boolean;unseen:boolean;timed:boolean;reviewed:boolean;calibrated:boolean;at:string};
export function attainment(input:unknown,rows:GradeEvidence[],now:Date){if(!Number.isFinite(now.getTime()))throw new Error('INVALID_CLOCK');if(!input)return {status:'insufficient_evidence',grade:null,future_prediction:null,reason:'Verified boundaries and at least two reviewed full qualification assessments are required. Hours, games and self-ratings are not grade evidence.'};const b=GradeBoundaries.parse(input);const labels=b.qualification==='4SD0'?Array.from({length:9},(_,i)=>9-i).flatMap(n=>n>1?[`${n}-${n}`,`${n}-${n-1}`]:['1-1']).concat('U'):['9','8','7','6','5','4','3','2','1','U'];const entries=[...b.entries].sort((a,c)=>c.threshold-a.threshold);if(b.maximum!==(b.qualification==='4SD0'?330:180)||entries.map(e=>e.label).join('|')!==labels.join('|')||new Set(entries.map(e=>e.threshold)).size!==entries.length||entries.at(-1)?.threshold!==0||entries.some(e=>e.threshold>b.maximum))throw new Error('INVALID_BOUNDARIES');const valid=rows.filter(r=>r.qualification===b.qualification&&r.complete&&r.unseen&&r.timed&&r.reviewed&&r.calibrated&&r.available===b.maximum&&Date.parse(r.at)<=now.getTime()&&now.getTime()-Date.parse(r.at)<=90*86400000).sort((a,c)=>Date.parse(c.at)-Date.parse(a.at)).slice(0,5);if(new Set(valid.map(r=>r.id)).size!==valid.length||valid.some(r=>!Number.isInteger(r.marks)||r.marks<0||r.marks>r.available))throw new Error('INVALID_GRADE_EVIDENCE');if(valid.length<2)return attainment(null,[],now);const indexes=valid.map(r=>entries.findIndex(e=>r.marks>=e.threshold));return {status:'available',label:'Practice-based current attainment benchmark',grade:entries[indexes[0]].label,observed_range:{lowest:entries[Math.max(...indexes)].label,highest:entries[Math.min(...indexes)].label},future_prediction:null,evidence_count:valid.length,series:b.series,source_url:b.source_url,confidence:'limited',reason:'Observed practice range, not a statistical confidence interval, future forecast or official Pearson grade. Paper difficulty, marking and boundaries can differ.'};}
