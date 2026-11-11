import {body, equalSecret, json, rpc, sha256} from '../_shared/core.js';
import {maxApi} from '../_shared/max.js';
import {deliverOutbox} from '../_shared/delivery.js';

export function handler(env, transport = fetch) {
  return async request => {
    if (!await equalSecret(
      request.headers.get('X-Max-Bot-Api-Secret'), env('MAX_WEBHOOK_SECRET')
    )) return json({error: 'Unauthorized'}, 401);
    if (request.method !== 'POST') return json({error: 'Method not allowed'}, 405);

    let update;
    try { update = await body(request, 65536); }
    catch { return json({error: 'Invalid update'}, 400); }

    const type = update?.update_type;
    if (!['bot_started', 'message_created', 'message_callback'].includes(type)) {
      return json({ok: true});
    }
    const callback = update.callback;
    const message = update.message;
    const user = type === 'bot_started' ? update.user
      : type === 'message_callback' ? callback?.user : message?.sender;
    if (!Number.isSafeInteger(user?.user_id) || user.user_id <= 0 || user.is_bot !== false) {
      return json({ok: true});
    }
    if (type !== 'bot_started' && message?.recipient?.chat_type !== 'dialog') {
      return json({ok: true});
    }
    // In MAX a dialog's recipient is the bot, while callback messages were sent to the user.
    if (type === 'message_callback' && message.recipient.user_id !== user.user_id) {
      return json({ok: true});
    }
    const mid = message?.body?.mid;
    const callbackId = callback?.callback_id;
    let eventId;
    if (type === 'bot_started' && Number.isSafeInteger(update.timestamp)) {
      eventId = 'start:' + user.user_id + ':' + update.timestamp;
    } else if (type === 'message_callback' && typeof callbackId === 'string') {
      eventId = 'callback:' + callbackId;
    } else if (type === 'message_created' && typeof mid === 'string') {
      eventId = 'message:' + mid;
    }
    if (!eventId || eventId.length > 200) return json({ok: true});
    const text = type === 'message_created' && typeof message.body.text === 'string'
      && message.body.text.length <= 2000 ? message.body.text.trim() : null;
    const data = type === 'message_callback' && typeof callback.payload === 'string'
      && callback.payload.length <= 64 ? callback.payload : null;
    if (type === 'message_callback' && !data) return json({ok: true});
    const start = type === 'bot_started' && /^[A-Za-z0-9_-]{43}$/.test(update.payload || '')
      ? update.payload : text?.match(/^\/start ([A-Za-z0-9_-]{43})$/)?.[1];
    const reply = message?.link;
    const owner = env('ADMIN_CHAT_ID');
    try {
      await rpc(env, 'nr_handle_event', {
        u: eventId, c: user.user_id,
        a: /^[1-9][0-9]*$/.test(owner || '') ? owner : null,
        p_channel: 'max', txt: text, cb: data,
        h: start ? await sha256(start) : null,
        r: reply?.type === 'reply' && typeof reply.message?.mid === 'string'
          ? reply.message.mid : null,
        bot_reply: reply?.type === 'reply' && reply.sender?.is_bot === true
      }, transport);
      if (data) {
        try {
          await maxApi(env, 'POST', '/answers?callback_id=' + encodeURIComponent(callbackId),
            {notification: 'Готово'}, transport);
        } catch {}
      }
      await deliverOutbox(env, transport);
      return await rpc(env, 'nr_pending_count', {}, transport) > 0
        ? json({retry: true}, 503) : json({ok: true});
    } catch { return json({retry: true}, 503); }
  };
}
if (import.meta.main) Deno.serve(handler(name => Deno.env.get(name)));
