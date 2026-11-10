import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('migrations protect data and route replies by prompt',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const migration of ['202611070001_schema','202611070002_telegram']) {
   await db.exec(await readFile(new URL('../supabase/migrations/'+migration+'.sql',import.meta.url),'utf8'));
  }
  const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
  const update=(u,c,txt=null,cb=null,h=null,r=null)=>db.query('select public.nr_handle_update($1,$2,900,$3,$4,$5,$6,$7)',[u,c,txt,cb,h,r,r!==null]);
  const draft=(id,hash,name)=>scalar('select public.nr_create_draft($1,$2,$3,$4,$5,$6) as value',[id,name,'Торт','Шоколадный торт',hash,'ip']);
  const first='00000000-0000-4000-8000-000000000001';
  await draft(first,'hash1','Анна');
  await draft(first,'hash1','Анна');
  assert.equal((await draft(first,'hash1','Другое имя')).error,'conflict');
  await draft('00000000-0000-4000-8000-000000000002','hash2','Ирина');
  await update(1,100,null,null,'hash1');
  await update(2,200,null,null,'hash2');
  await update(2,200,null,null,'hash2');
  assert.equal(await scalar("select count(*)::int as value from requests_app.tickets where status='new'"),2);
  await update(3,100,null,'reply:2');
  assert.equal(await scalar("select payload->>'text' as value from requests_app.outbox where effect_key='update:3'"),'Обращение недоступно.');
  await update(4,900,null,'reply:1');
  await update(5,900,null,'reply:2');
  let job;
  while((job=await scalar('select public.nr_claim_outbox() as value'))) {
   await db.query('select public.nr_delivered($1,$2,$3)',[job.id,job.lease_token,1000+job.id]);
  }
  const prompt=async n=>scalar('select p.message_id::int as value from requests_app.prompts p join requests_app.tickets t on p.ticket_id=t.id where t.number=$1',[n]);
  await update(6,900,'Ответ Ирине',null,null,await prompt(2));
  await update(7,900,'Ответ Анне',null,null,await prompt(1));
  assert.deepEqual((await db.query("select chat_id::int as chat_id from requests_app.outbox where effect_key in ('update:6:send','update:7:send') order by id")).rows.map(r=>r.chat_id),[200,100]);
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from requests_app.tickets'),/permission denied/);
 } finally { await db.close(); }
});
test('expired links, quick replies, leases and retries are handled transactionally',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const migration of ['202611070001_schema','202611070002_telegram'])
   await db.exec(await readFile(new URL('../supabase/migrations/'+migration+'.sql',import.meta.url),'utf8'));
  const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
  const claim=()=>value('select public.nr_claim_outbox() as value');
  const update=(u,c,txt=null,cb=null,h=null,r=null)=>db.query('select public.nr_handle_update($1,$2,900,$3,$4,$5,$6,$7)',[u,c,txt,cb,h,r,r!==null]);
  const draft=(n,ip='ip')=>value('select public.nr_create_draft($1,$2,$3,$4,$5,$6) as value',[`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,'Анна','Торт','Торт на праздник','hash'+n,ip]);
  for(let n=1;n<=10;n++) assert.ok((await draft(n)).expires_at);
  assert.equal((await draft(11)).error,'rate');
  await db.exec("update requests_app.tickets set expires_at=now()-interval '1 second' where number=1");
  await update(1,100,null,null,'hash1');
  assert.equal(await value('select status as value from requests_app.tickets where number=1'),'draft');
  await update(2,100,null,null,'hash2');
  await update(3,100,null,null,'hash3');
  await update(4,100,null,'reply:2');
  await update(5,100,null,'reply:3');
  let job;
  let prompt;
  while((job=await claim())){
   if(job.payload.reply_markup?.force_reply){prompt=job;break;}
   await db.query('select public.nr_delivered($1,$2,$3)',[job.id,job.lease_token,100+job.id]);
  }
  assert.ok(prompt);
  await assert.rejects(update(6,100,'Первое уточнение',null,null,500),{code:'40001'});
  assert.equal(await value('select count(*)::int as value from requests_app.updates where id=6'),0);
  await db.exec("update requests_app.outbox set leased_until=now()-interval '1 second' where state='processing'");
  const recovered=await claim();
  assert.equal(recovered.id,prompt.id);
  assert.notEqual(recovered.lease_token,prompt.lease_token);
  await db.query('select public.nr_delivered($1,$2,500)',[recovered.id,recovered.lease_token]);
  const second=await claim();
  await db.query('select public.nr_delivered($1,$2,501)',[second.id,second.lease_token]);
  await update(7,100,'Второе уточнение',null,null,501);
  await update(6,100,'Первое уточнение',null,null,500);
  assert.deepEqual((await db.query('select t.number::int as n from requests_app.messages m join requests_app.tickets t on m.ticket_id=t.id order by m.id')).rows.map(row=>row.n),[3,2]);
  const outgoing=await claim();
  await db.query("select public.nr_failed($1,$2,'telegram_403')",[outgoing.id,outgoing.lease_token]);
  await update(8,100,null,'retry:'+outgoing.id);
  assert.equal(await value('select state as value from requests_app.outbox where id=$1',[outgoing.id]),'failed');
  await update(9,900,null,'retry:'+outgoing.id);
  assert.equal((await claim()).id,outgoing.id);
  await update(10,900,null,'done:2');
  assert.equal(await value('select status as value from requests_app.tickets where number=2'),'done');
 } finally { await db.close(); }
});
