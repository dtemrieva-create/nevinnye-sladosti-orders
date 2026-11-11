import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../supabase/functions/create-application/index.js';

const origin='https://desserts.pages.dev';
const env=key=>({SITE_URL:origin+'/orders/',BOT_USERNAME:'desserts_test_bot',ADMIN_CHAT_ID:'900',FORM_SECRET:'f'.repeat(43),SERVER_DB_KEY:'sb_secret_test',SUPABASE_URL:'https://test.supabase.co'})[key];
const valid={name:'Анна',subject:'Торт',description:'Торт на праздник',website:'',idempotency_key:'00000000-0000-4000-8000-000000000001'};
function post(input,site=origin){
 return new Request('https://test.supabase.co/functions/v1/create-application',{method:'POST',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify(input)});
}
test('form rejects other origins, oversized bodies and honeypot before DB',async()=>{
 const handle=handler(env,()=>assert.fail('unexpected RPC'));
 assert.equal((await handle(post(valid,origin+'.invalid'))).status,403);
 assert.equal((await handle(post({...valid,description:'a'.repeat(17000)}))).status,413);
 assert.equal((await handle(post({...valid,website:'spam'}))).status,400);
 const options=await handle(new Request('https://test.supabase.co',{method:'OPTIONS',headers:{Origin:origin}}));
 assert.equal(options.status,204);
 assert.equal(options.headers.get('Access-Control-Allow-Origin'),origin);
});
test('form returns a stable opaque link and only stores its hash',async()=>{
 const received=[];
 const handle=handler(env,async(url,request)=>{
  received.push(JSON.parse(request.body));
  return Response.json({expires_at:'2026-11-10T00:30:00Z'});
 });
 const first=await (await handle(post(valid))).json();
 const second=await (await handle(post(valid))).json();
 assert.deepEqual(first,second);
 assert.match(first.confirmation_url,/^https:\/\/t\.me\/desserts_test_bot\?start=[A-Za-z0-9_-]{43}$/);
 assert.match(received[0].p_code_hash,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(received).includes(new URL(first.confirmation_url).searchParams.get('start')));
});
