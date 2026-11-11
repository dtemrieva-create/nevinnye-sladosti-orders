import {body,equalSecret,json,rpc,sha256,telegram} from '../_shared/core.js';
import {deliverOutbox} from '../_shared/delivery.js';

export function handler(env,transport=fetch) {
  return async request=>{
    if (!await equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env('TG_WEBHOOK_SECRET'))) {
      return json({error:'Unauthorized'},401);
    }
    if (request.method!=='POST') return json({error:'Method not allowed'},405);
    let update;
    try { update=await body(request,65536); } catch { return json({error:'Invalid update'},400); }
    const callback=update?.callback_query;
    const message=callback?.message??update?.message;
    const sender=callback?.from??message?.from;
    const chat=message?.chat;
    if (!Number.isSafeInteger(update?.update_id)||chat?.type!=='private'||
        !Number.isSafeInteger(chat.id)||chat.id<=0||sender?.id!==chat.id||sender.is_bot!==false) {
      return json({ok:true});
    }
    const text=!callback&&typeof message.text==='string'&&message.text.length<=2000?message.text.trim():null;
    const data=callback&&typeof callback.data==='string'&&callback.data.length<=64?callback.data:null;
    if (callback&&!data) return json({ok:true});
    const start=text?.match(/^\/start ([A-Za-z0-9_-]{43})$/);
    const owner=env('ADMIN_CHAT_ID');
    const reply=message.reply_to_message;
    try {
      await rpc(env,'nr_handle_event_v2',{
        u:String(update.update_id),c:chat.id,a:/^[1-9][0-9]*$/.test(owner||'')?owner:null,
        p_channel:'telegram',ma:/^[1-9][0-9]*$/.test(env('MAX_ADMIN_CHAT_ID')||'')?env('MAX_ADMIN_CHAT_ID'):null,
        txt:text,cb:data,h:start?await sha256(start[1]):null,
        r:!callback&&Number.isSafeInteger(reply?.message_id)?String(reply.message_id):null,
        bot_reply:!callback&&reply?.from?.is_bot===true
      },transport);
      if (callback&&typeof callback.id==='string') {
        try { await telegram(env,'answerCallbackQuery',{callback_query_id:callback.id},transport); } catch {}
      }
      await deliverOutbox(env, transport);
      const pending=await rpc(env,'nr_pending_count',{},transport);
      return pending>0?json({retry:true},503):json({ok:true});
    } catch { return json({retry:true},503); }
  };
}
if(import.meta.main) Deno.serve(handler(name=>Deno.env.get(name)));
