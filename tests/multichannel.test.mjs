import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handler as maxHandler} from '../supabase/functions/max-hook/index.js';
import {validateOrder} from '../supabase/functions/_shared/order.js';
import {parseCatalog} from '../public/js/catalog-data.js';

test('catalog supports quoted descriptions and no category column', () => {
 const cakes=parseCatalog('id,name,description,price,image,available\r\na,Медовик,"Карамель, сметана\nи мёд",3000,image1.jpg,TRUE\r\nb,Другой,Описание,3000,b.jpg,FALSE\r\nc,Моя начинка,,,,');
 assert.equal(cakes.length,1);
 assert.equal(cakes[0].description,'Карамель, сметана\nи мёд');
 assert.throws(()=>parseCatalog('id,name,description,price,image,available\na,Торт,Вкус,от 3000 ₽,image1,TRUE'));
});

test('order validation uses catalog names, half kilograms and Moscow dates', async () => {
 const now=new Date('2026-11-10T22:30:00Z');
 const input={name:' Анна ',phone:'+79267085613',fillingId:'a',weight:2.5,candles:'none',
  notes:'Без орехов',pickupDate:'2026-11-14',fulfillment:'pickup',channel:'max'};
 const transport=async()=>Response.json(null);
 const catalogTransport=async()=>new Response('id,name,description,price,image,available\na,Медовик,Карамельный,3000,image1.jpg,TRUE');
 const result=await validateOrder(input,'https://docs.google.com/spreadsheets/d/e/test/pub?output=csv',catalogTransport,now);
 assert.equal(result.name,'Анна');
 assert.equal(result.details.filling,'Медовик');
 await assert.rejects(validateOrder({...input,weight:2.3},'',transport,now));
 await assert.rejects(validateOrder({...input,pickupDate:'2026-11-13'},'',transport,now));
});

test('MAX rejects wrong secrets and group callbacks before contacting the DB', async()=>{
 const env=key=>({MAX_WEBHOOK_SECRET:'test-secret',ADMIN_CHAT_ID:'900'})[key];
 const handle=maxHandler(env,()=>assert.fail('Unexpected transport'));
 const send=(event,secret='test-secret')=>handle(new Request('https://example.org',{method:'POST',
  headers:{'X-Max-Bot-Api-Secret':secret},body:JSON.stringify(event)}));
 assert.equal((await send({},'wrong')).status,401);
 assert.equal((await send({update_type:'message_callback',
  callback:{user:{user_id:100,is_bot:false},payload:'card:1',callback_id:'x'},
  message:{recipient:{chat_type:'chat',user_id:100}}})).status,200);
});

test('MAX client and Telegram owner exchange messages without cross-channel access',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const name of ['202611070001_schema','202611070002_telegram','202611110003_multichannel']){
   await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
  }
  const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
  const event=(u,c,channel,txt=null,cb=null,h=null,r=null)=>db.query(
   'select public.nr_handle_event($1,$2,900,$3,$4,$5,$6,$7,$8)',[u,c,channel,txt,cb,h,r,r!==null]);
  const id='00000000-0000-4000-8000-000000000101';
  const create=details=>scalar('select public.nr_create_order($1,$2,$3,$4,$5,$6,$7,$8,$9,900) as value',
   [id,'Анна','Торт','Торт ко дню рождения','maxhash','ip','max','+79267085613',details]);
  const order=await create({weight:2});
  assert.equal(order.number,1);
  assert.equal((await create({weight:2})).number,1);
  assert.equal((await create({weight:3})).error,'conflict');
  await event('1001',900,'telegram',null,'reply:1');
  assert.equal(await scalar("select count(*)::int as value from requests_app.outbox where prompt_ticket is not null"),0);
  await event('max-start',100,'max',null,null,'maxhash');
  await event('max-start',100,'max',null,null,'maxhash');
  assert.equal(await scalar('select chat_id::int as value from requests_app.tickets where number=1'),100);
  await event('stolen-start',101,'max',null,null,'maxhash');
  assert.equal(await scalar('select chat_id::int as value from requests_app.tickets where number=1'),100);
  await event('1002',100,'telegram',null,'card:1');
  assert.equal(await scalar("select payload->>'text' as value from requests_app.outbox where effect_key='update:1002'"),'Обращение недоступно.');
  await event('max-admin-spoof',900,'max','/requests');
  assert.match(await scalar("select payload->>'text' as value from requests_app.outbox where effect_key='max:max-admin-spoof'"),/недоступен/);
  await event('1003',900,'telegram',null,'reply:1');
  await event('client-prompt',100,'max',null,'reply:1');
  let job;
  while((job=await scalar('select public.nr_claim_outbox() as value'))){
   await db.query('select public.nr_delivered_remote($1,$2,$3)',[job.id,job.lease_token,'mid-'+job.id]);
  }
  const prompt=async channel=>scalar('select message_id as value from requests_app.prompts where channel=$1',[channel]);
  await event('1004',900,'telegram','Ответ из Telegram',null,null,await prompt('telegram'));
  await event('client-reply',100,'max','Уточнение из MAX',null,null,await prompt('max'));
  const outgoing=(await db.query("select channel,chat_id::int as recipient from requests_app.outbox where effect_key in ('update:1004:send','max:client-reply:send') order by id")).rows;
  assert.deepEqual(outgoing,[{channel:'max',recipient:100},{channel:'telegram',recipient:900}]);
  await event('1005',900,'telegram',null,'progress:1');
  assert.equal(await scalar("select channel as value from requests_app.outbox where effect_key='update:1005:status'"),'max');
  await event('client-forged-status',100,'max',null,'done:1');
  assert.equal(await scalar('select status as value from requests_app.tickets where number=1'),'in_progress');
  await event('other-client',101,'max',null,'history:1');
  assert.equal(await scalar("select payload->>'text' as value from requests_app.outbox where effect_key='max:other-client'"),'Обращение недоступно.');
 } finally {await db.close();}
});
