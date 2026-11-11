import {body,json,rpc,sha256,signature} from '../_shared/core.js';
import {validateOrder} from '../_shared/order.js';
import {deliverOutbox} from '../_shared/delivery.js';

export function handler(env,transport=fetch) {
  return async request=>{
    let site;
    try { site=new URL(env('SITE_URL')); } catch {}
    const origin=request.headers.get('Origin');
    const cors=site?.protocol==='https:'&&site.origin===origin
      ? {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'} : {};
    if (!cors['Access-Control-Allow-Origin']) return json({error:'origin'},403,{'Vary':'Origin'});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if (request.method!=='POST') return json({error:'method'},405,cors);
    const bot=env('BOT_USERNAME'), secret=env('FORM_SECRET'), owner=env('ADMIN_CHAT_ID');
    if (!/^[a-z][a-z0-9_]{4,31}$/i.test(bot||'') || !secret || secret.length<32 || !/^[1-9][0-9]*$/.test(owner||'')) return json({error:'disabled'},503,cors);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')) return json({error:'content_type'},415,cors);
    let input;
    try { input=await body(request); }
    catch(error) { return json({error:'invalid_body'},error.message==='Body too large'?413:400,cors); }
    if (!input || typeof input!=='object' || input.website!=='' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotency_key||'') ||
        typeof input.idempotency_key!=='string') return json({error:'invalid_form'},400,cors);

    if (input.kind === 'order') {
      let order;
      try {
        order = await validateOrder(input.order, env('GOOGLE_CATALOG_CSV_URL'), transport);
      } catch (error) {
        return json({error: 'invalid_order', message: error.message}, 400, cors);
      }
      const username = order.channel === 'max' ? env('MAX_BOT_USERNAME') : bot;
      if (!/^[A-Za-z][A-Za-z0-9_]{4,63}$/.test(username || '') ||
          (order.channel === 'max' && !env('MAX_BOT_TOKEN'))) {
        return json({error: 'channel_unavailable'}, 503, cors);
      }
      try {
        const id = input.idempotency_key.toLowerCase();
        const code = await signature(secret, id);
        const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
        const result = await rpc(env, 'nr_create_order', {
          p_id: id, p_name: order.name, p_subject: order.subject,
          p_description: order.description, p_code_hash: await sha256(code),
          p_ip_hash: await signature(secret, 'ip:' + ip),
          p_channel: order.channel, p_phone: order.phone, p_details: order.details,
          p_admin: owner
        }, transport);
        if (result.error) return json({error: result.error}, result.error === 'rate' ? 429 : 409, cors);
        try { await deliverOutbox(env, transport, 3); } catch {}
        const domain = order.channel === 'max' ? 'max.ru' : 't.me';
        return json({
          number: result.number,
          confirmation_url: 'https://' + domain + '/' + username + '?start=' + code,
          expires_at: result.expires_at,
          expired: result.expired === true
        }, 200, cors);
      } catch { return json({error: 'unavailable'}, 503, cors); }
    }
    const fields={};
    for (const [key,min,max] of [['name',1,80],['subject',1,120],['description',5,2000]]) {
      if (typeof input[key]!=='string') return json({error:'invalid_form'},400,cors);
      const value=input[key].trim();
      if (value.length<min||value.length>max||value.includes('\u0000')) return json({error:'invalid_form'},400,cors);
      fields['p_'+key]=value;
    }
    try {
      const id=input.idempotency_key.toLowerCase();
      const code=await signature(secret,id);
      const ip=request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()||'unknown';
      const result=await rpc(env,'nr_create_draft',{...fields,p_id:id,p_code_hash:await sha256(code),p_ip_hash:await signature(secret,'ip:'+ip)},transport);
      if (result.error) return json({error:result.error},result.error==='rate'?429:409,cors);
      return json({confirmation_url:'https://t.me/'+bot+'?start='+code,expires_at:result.expires_at},200,cors);
    } catch { return json({error:'unavailable'},503,cors); }
  };
}
if(import.meta.main) Deno.serve(handler(name=>Deno.env.get(name)));
