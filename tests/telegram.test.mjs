import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/telegram-hook/index.js';
const secret='test-secret-for-webhook';
const env=name=>({TG_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"sb_secret_test"}',BOT_TOKEN:'test'})[name];
function request(update,token=secret) {
 return new Request('https://test.supabase.co/functions/v1/telegram-hook',{
  method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':token},body:JSON.stringify(update)
 });
}
test('rejects an invalid webhook secret before contacting any service',async()=>{
 const handle=handler(env,()=>assert.fail('Unexpected network call'));
 assert.equal((await handle(request({},'wrong'))).status,401);
});
test('ignores callbacks with a mismatched private chat sender',async()=>{
 const handle=handler(env,()=>assert.fail('Unexpected network call'));
 const update={update_id:1,callback_query:{data:'list:all:0',from:{id:2,is_bot:false},message:{chat:{id:1,type:'private'}}}};
 assert.equal((await handle(request(update))).status,200);
});
test('saves the update, records blocked delivery, and passes modern key via apikey',async()=>{
 const operations=[];
 const handle=handler(env,async(url,options)=>{
  const method=String(url).split('/').at(-1);
  operations.push(method);
  if(method.startsWith('nr_')) {
   assert.equal(options.headers.apikey,'sb_secret_test');
   assert.equal(options.headers.Authorization,undefined);
  }
  if(method==='nr_claim_outbox')return Response.json(operations.filter(x=>x===method).length===1?{id:1,lease_token:'lease',payload:{chat_id:1,text:'hello'}}:null);
  if(method==='sendMessage')return Response.json({ok:false,error_code:403},{status:403});
  if(method==='nr_failed')assert.equal(JSON.parse(options.body).e,'telegram_403');
  if (method==='nr_pending_count') return Response.json(0);
  return new Response(null,{status:204});
 });
 const update={update_id:1,message:{text:'/id',chat:{id:1,type:'private'},from:{id:1,is_bot:false}}};
 assert.equal((await handle(request(update))).status,200);
 assert.deepEqual(operations,['nr_handle_event_v2','nr_claim_outbox','sendMessage','nr_failed','nr_claim_outbox','nr_pending_count']);
});
