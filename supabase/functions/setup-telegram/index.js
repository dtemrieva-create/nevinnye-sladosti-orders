import {equalSecret,json,telegram,body} from '../_shared/core.js';
export function handler(env,transport=fetch){return async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!await equalSecret(request.headers.get('X-Setup-Secret'),env('SETUP_SECRET')))return json({error:'Unauthorized'},401);
 try{const input=await body(request,1024);let result;
 if(input.action==='register') { const base=env('SUPABASE_URL'); if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base||''))throw new Error('Project URL invalid'); const secret=env('TG_WEBHOOK_SECRET');if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret||''))throw new Error('Webhook secret invalid');result=await telegram(env,'setWebhook',{url:base+'/functions/v1/telegram-hook',secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false},transport);return json({ok:result===true}); }
 if(input.action==='status'){result=await telegram(env,'getWebhookInfo',{},transport);return json({url:result.url,pending_update_count:result.pending_update_count,last_error_date:result.last_error_date,last_error_message:result.last_error_message});}
 if(input.action==='test'){const id=env('ADMIN_CHAT_ID');if(!/^[1-9][0-9]*$/.test(id||''))throw new Error('Owner not configured');await telegram(env,'sendMessage',{chat_id:id,text:'Проверка подключения «Невинные сладости». Это служебное сообщение, не обращение клиента.'},transport);return json({ok:true});}
 return json({error:'Unknown action'},400);
 }catch{return json({error:'Setup operation failed'},502);}
};}
if(import.meta.main)Deno.serve(handler(name=>Deno.env.get(name)));
