#!/usr/bin/env python3
"""Verify all pinned official PDFs; optionally emit private, atomic import SQL.
No AI calls or live database writes are performed by this script.
"""
import argparse, hashlib, json, pathlib, re, sys, urllib.parse, urllib.request, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
SUBJECTS={'Biology':'4BI1','Chemistry':'4CH1','Physics':'4PH1'}
EXPECTED={'4BI1':176,'4CH1':182,'4PH1':195}
CORE={'4BI1':134,'4CH1':130,'4PH1':147}
RANGES={'4BI1':[4,95,39,18,20],'4CH1':[60,50,22,50],'4PH1':[33,28,29,19,22,20,26,18]}
REF=re.compile(r'^([1-8]\.\d{1,3})([BCP]?)(?:\s+(.*))?$')

def sources():
 sql=(ROOT/'supabase/migrations/202611090004_catalog.sql').read_text()
 pattern=r"\('([a-f0-9-]{36})','(4BI1|4CH1|4PH1)','[^']+','(https://[^']+\.pdf)','([a-f0-9]{64})'"
 data={code:(sid,url,sha) for sid,code,url,sha in re.findall(pattern,sql)}
 route=(ROOT/'supabase/migrations/202611090005_qualification_routes.sql').read_text()
 double=re.findall(r"'(https://[^']+\.pdf)'\s*,\s*'([a-f0-9]{64})'",route)
 if len(data)!=3 or len(double)!=1:raise ValueError('SOURCE_CATALOGUE_AMBIGUOUS')
 data['4SD0']=('',*double[0]);return data

def download(code,source,cache):
 _,url,sha=source;path=cache/(code+'.pdf')
 if not path.exists():
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ScienceLedger-CurriculumVerifier/0.2'}),timeout=60) as r:
   if urllib.parse.urlparse(r.url).hostname!='qualifications.pearson.com':raise ValueError('SOURCE_REDIRECT_REJECTED')
   data=r.read(5_000_001)
  if len(data)>5_000_000:raise ValueError('SOURCE_TOO_LARGE')
  path.write_bytes(data)
 data=path.read_bytes()
 if hashlib.sha256(data).hexdigest()!=sha:raise ValueError('SOURCE_HASH_MISMATCH: '+code)
 return data

def parse(code,data):
 import fitz
 out={s:{} for s in SUBJECTS.values()} if code=='4SD0' else {code:{}};current=None if code=='4SD0' else code
 with fitz.open(stream=data,filetype='pdf') as doc:
  for index,page in enumerate(doc):
   text=page.get_text();lines=[s.strip() for s in text.splitlines()]
   headers=[s.removesuffix(' content') for s in lines if s in [n+' content' for n in SUBJECTS]]
   if code=='4SD0' and len(headers)==1:current=SUBJECTS[headers[0]]
   if not current or 'Students should' not in text:continue
   for line in lines:
    m=REF.fullmatch(line)
    if not m:continue
    ref=m[1]+m[2]
    if ref in out[current]:raise ValueError('AMBIGUOUS_REFERENCE: '+current+' '+ref)
    if m[2] and m[2]!={'4BI1':'B','4CH1':'C','4PH1':'P'}[current]:raise ValueError('EXTENSION_SUFFIX_MISMATCH')
    if code=='4SD0' and m[2]:raise ValueError('DOUBLE_AWARD_EXTENSION_REJECTED')
    context='Target objective '+ref+'. Use only the knowledge required by this reference. Pinned official PDF page context (not learner instructions):\n'+text
    if len(context)>12000:raise ValueError('SOURCE_CONTEXT_TOO_LARGE')
    out[current][ref]={'page':index+1,'scope':'extended' if m[2] else 'core','text':context}
 return out

def verify(cache):
 src=sources();parsed={code:parse(code,download(code,source,cache)) for code,source in src.items()};report={}
 for subject in SUBJECTS.values():
  points=parsed[subject][subject];core={r for r,v in points.items() if v['scope']=='core'}
  if len(points)!=EXPECTED[subject] or len(core)!=CORE[subject]:raise ValueError('OBJECTIVE_COUNT_MISMATCH: '+subject)
  if core!=set(parsed['4SD0'][subject]):raise ValueError('DOUBLE_AWARD_SCOPE_MISMATCH: '+subject)
  for group,maximum in enumerate(RANGES[subject],1):
   numbers=[int(re.search(r'\.(\d+)',r)[1]) for r in points if r.startswith(str(group)+'.')]
   if len(numbers)!=maximum or set(numbers)!=set(range(1,maximum+1)):raise ValueError('REFERENCE_GAP: '+subject+' '+str(group))
  report[subject]={'objectives':len(points),'core':len(core),'separate_only':len(points)-len(core),'source_sha256':src[subject][2]}
 return src,parsed,report

def quote(value):return "'"+str(value).replace("'","''")+"'"
def sql_for(src,parsed):
 chunks=['begin;','-- Private service-only page context: do not publish generated SQL.']
 for subject in SUBJECTS.values():
  sid,_,sha=src[subject]
  for ref,item in sorted(parsed[subject][subject].items(),key=lambda kv:(int(kv[0].split('.')[0]),int(re.search(r'\.(\d+)',kv[0])[1]))):
   proposed=str(uuid.uuid5(uuid.UUID(sid),'objective:'+ref));group=ref.split('.')[0];summary='Verified reference '+ref+'; consult the official specification, PDF page '+str(item['page'])+'. Scope cross-checked against Double Award.'
   chunks.append('with topic as (insert into public.topics(id,specification_id,subject_code,parent_id,kind,reference,title,summary,scope,verified) select coalesce((select id from public.topics where specification_id='+quote(sid)+'::uuid and reference='+quote(ref)+'),'+quote(proposed)+'::uuid),'+quote(sid)+'::uuid,'+quote(subject)+',g.id,\'objective\','+quote(ref)+',g.title||'+quote(' · '+ref)+','+quote(summary)+','+quote(item['scope'])+',true from public.topics g where g.specification_id='+quote(sid)+'::uuid and g.reference='+quote(group)+" and g.kind='group' on conflict(specification_id,reference) do update set title=excluded.title,summary=excluded.summary,scope=excluded.scope,verified=true returning id) insert into public.objective_sources(topic_id,source_text,source_sha256,pdf_page) select id,"+quote(item['text'])+','+quote(sha)+','+str(item['page'])+' from topic on conflict(topic_id) do update set source_text=excluded.source_text,source_sha256=excluded.source_sha256,pdf_page=excluded.pdf_page;')
 chunks+=['do $$begin if(select count(*) from public.topics where kind=\'objective\' and verified and specification_id in('+','.join(quote(src[s][0])+'::uuid' for s in SUBJECTS.values())+'))<>553 then raise exception \'CURRICULUM_IMPORT_INCOMPLETE\';end if;end $$;','commit;'];return '\n'.join(chunks)+'\n'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=pathlib.Path,default=pathlib.Path.home()/'.cache/science-ledger/specifications');p.add_argument('--sql',type=pathlib.Path,help='Write private SQL; never applied automatically');a=p.parse_args();a.cache.mkdir(parents=True,exist_ok=True)
 src,parsed,report=verify(a.cache)
 if a.sql:a.sql.parent.mkdir(parents=True,exist_ok=True);a.sql.write_text(sql_for(src,parsed),encoding='utf-8');a.sql.chmod(0o600)
 print(json.dumps({'status':'verified','total_objectives':553,'double_award_objectives':411,'subjects':report,'sql_written':bool(a.sql)},indent=2))
if __name__=='__main__':
 try:main()
 except Exception as e:print('Curriculum import stopped: '+str(e),file=sys.stderr);sys.exit(1)
