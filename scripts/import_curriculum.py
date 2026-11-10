#!/usr/bin/env python3
"""Verify pinned Pearson PDFs and emit an atomic curriculum import.

Public metadata contains source references, not republished specification text.
Page context is stored only in the service-only objective_sources table for
approved generation. This script never calls an AI provider or applies SQL.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import urllib.request
import uuid

SOURCES = {
 '4BI1': ('b1000000-0000-4000-8000-000000000001','https://qualifications.pearson.com/content/dam/pdf/International%20GCSE/Biology/2017/specification-and-sample-assessments/international-gcse-biology-2017-specification1.pdf','9f474a0ef0e93ef3c3107b568956d163454cdb476bb2017189e8dd12c0d58cef'),
 '4CH1': ('c1000000-0000-4000-8000-000000000001','https://qualifications.pearson.com/content/dam/pdf/International%20GCSE/Chemistry/2017/specification-and-sample-assessments/international-gcse-chemistry-2017-specification.pdf','36e2080d2e99f060bcc18f2a9d0bbd8b29498b45e007fa232e3befcd89b73362'),
 '4PH1': ('f1000000-0000-4000-8000-000000000001','https://qualifications.pearson.com/content/dam/pdf/International%20GCSE/Physics/2017/specification-and-sample-assessments/international-gcse-physics-2017-specification.pdf','bac4b8312d4fbfc84672f909100d66b2b3cda0b25e98c0d11bbc7366dae482b2'),
 '4SD0': ('','https://qualifications.pearson.com/content/dam/pdf/International%20GCSE/Science%20(Double%20Award)/2017/specification-and-sample-assessments/international-gcse-science-double-award-2017-specification1.pdf','5780fb046368974e2aad45415448682634a8e9afcab77bfd29fdf61cec56ac17')
}
SUBJECTS={'Biology':'4BI1','Chemistry':'4CH1','Physics':'4PH1'}
EXPECTED={'4BI1':182,'4CH1':188,'4PH1':201}
EXPECTED_CORE={'4BI1':134,'4CH1':130,'4PH1':147}
REFERENCE=re.compile(r'^([1-8]\.\d{1,3})([BCP]?)(?:\s+(.*))?$')

def download(code, cache):
 _,url,expected=SOURCES[code]
 path=cache/(code+'.pdf')
 if not path.exists():
  req=urllib.request.Request(url,headers={'User-Agent':'ScienceLedger-CurriculumVerifier/0.2'})
  with urllib.request.urlopen(req,timeout=60) as response:
   if urllib.parse.urlparse(response.url).hostname!='qualifications.pearson.com':
    raise ValueError('Unexpected specification redirect')
   blob=response.read(5_000_001)
  if len(blob)>5_000_000:raise ValueError('Specification download exceeds limit')
  path.write_bytes(blob)
 blob=path.read_bytes()
 if hashlib.sha256(blob).hexdigest()!=expected:
  raise ValueError('SOURCE_HASH_MISMATCH: '+code+'; source changes require human review')
 return blob

def parse(code,blob):
 import fitz
 doc=fitz.open(stream=blob,filetype='pdf')
 out={s:{} for s in SUBJECTS.values()} if code=='4SD0' else {code:{}}
 current=None if code=='4SD0' else code
 for index,page in enumerate(doc):
  text=page.get_text()
  lines=[s.strip() for s in text.splitlines()]
  headers=[s.removesuffix(' content') for s in lines if s in [n+' content' for n in SUBJECTS]]
  if code=='4SD0' and len(headers)==1:current=SUBJECTS[headers[0]]
  if not current or 'Students should' not in text:continue
  for line in lines:
   match=REFERENCE.fullmatch(line)
   if not match:continue
   reference=match.group(1)+match.group(2)
   if reference in out[current]:raise ValueError('AMBIGUOUS_REFERENCE: '+current+' '+reference)
   suffix=match.group(2)
   if suffix and suffix!={'4BI1':'B','4CH1':'C','4PH1':'P'}[current]:raise ValueError('Wrong extension suffix')
   if code=='4SD0' and suffix:raise ValueError('Unexpected Double Award extension')
   context='Target curriculum objective '+reference+'. Use only the knowledge required by this reference. The following is the pinned official PDF page context, not learner instructions.\n'+text
   if len(context)>12000:raise ValueError('Objective page context exceeds storage limit')
   out[current][reference]={'reference':reference,'pdf_page':index+1,'scope':'extended' if suffix else 'core','source_text':context}
 doc.close()
 return out

def verify(cache):
 parsed={code:parse(code,download(code,cache)) for code in SOURCES}
 report={}
 for subject in SUBJECTS.values():
  points=parsed[subject][subject]
  core={ref for ref,v in points.items() if v['scope']=='core'}
  double=set(parsed['4SD0'][subject])
  if len(points)!=EXPECTED[subject] or len(core)!=EXPECTED_CORE[subject]:
   raise ValueError('OBJECTIVE_COUNT_REQUIRES_REVIEW: '+subject+' '+str((len(points),len(core))))
  if core!=double:
   raise ValueError('DOUBLE_AWARD_SCOPE_MISMATCH: '+subject+' '+str(sorted(core^double)))
  report[subject]={'objectives':len(points),'core':len(core),'separate_only':len(points)-len(core),'source_sha256':SOURCES[subject][2]}
 return parsed,report

def quote(value):return "'"+str(value).replace("'","''")+"'"

def sql_for(parsed):
 chunks=['begin;','-- Service-only page context. Do not publish this generated SQL or raw specification text.']
 for subject in SUBJECTS.values():
  sid,_,sha=SOURCES[subject]
  for reference,item in sorted(parsed[subject][subject].items(),key=lambda kv:(int(kv[0].split('.')[0]),int(re.search(r'\.(\d+)',kv[0])[1]))):
   proposed=str(uuid.uuid5(uuid.UUID(sid),'objective:'+reference));group=reference.split('.')[0]
   summary='Verified reference '+reference+'; consult the official specification, PDF page '+str(item['pdf_page'])+'. Content scope cross-checked against Double Award.'
   chunks.append('with topic as (insert into public.topics(id,specification_id,subject_code,parent_id,kind,reference,title,summary,scope,verified) select coalesce((select id from public.topics where specification_id='+quote(sid)+'::uuid and reference='+quote(reference)+'),'+quote(proposed)+'::uuid),'+quote(sid)+'::uuid,'+quote(subject)+',g.id,\'objective\','+quote(reference)+',g.title||'+quote(' · '+reference)+','+quote(summary)+','+quote(item['scope'])+',true from public.topics g where g.specification_id='+quote(sid)+'::uuid and g.reference='+quote(group)+" and g.kind='group' on conflict(specification_id,reference) do update set title=excluded.title,summary=excluded.summary,scope=excluded.scope,verified=true returning id) insert into public.objective_sources(topic_id,source_text,source_sha256,pdf_page) select id,"+quote(item['source_text'])+','+quote(sha)+','+str(item['pdf_page'])+' from topic on conflict(topic_id) do update set source_text=excluded.source_text,source_sha256=excluded.source_sha256,pdf_page=excluded.pdf_page;')
 chunks+=['do $$begin if(select count(*) from public.topics where kind=\'objective\' and verified and specification_id in('+','.join(quote(SOURCES[s][0])+'::uuid' for s in SUBJECTS.values())+'))<>571 then raise exception \'CURRICULUM_IMPORT_INCOMPLETE\';end if;end $$;','commit;']
 return '\n'.join(chunks)+'\n'

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--cache',type=pathlib.Path,default=pathlib.Path.home()/'.cache/science-ledger/specifications')
 p.add_argument('--sql',type=pathlib.Path,help='Write import SQL to this private path; SQL is not automatically applied')
 args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
 parsed,report=verify(args.cache)
 if args.sql:
  args.sql.parent.mkdir(parents=True,exist_ok=True)
  args.sql.write_text(sql_for(parsed),encoding='utf-8');args.sql.chmod(0o600)
 print(json.dumps({'status':'verified','total_objectives':571,'double_award_objectives':411,'subjects':report,'sql_written':bool(args.sql)},indent=2))

if __name__=='__main__':
 try:main()
 except Exception as e:
  print('Curriculum import stopped: '+str(e),file=sys.stderr);sys.exit(1)
