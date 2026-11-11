import {rpc, telegram} from './core.js';
import {maxApi, maxMessage} from './max.js';

export async function deliverOutbox(env, transport = fetch, limit = 8) {
  for (let index = 0; index < limit; index++) {
    const job = await rpc(env, 'nr_claim_outbox', {}, transport);
    if (!job) return;

    let messageId;
    try {
      if (job.channel === 'max') {
        const result = await maxApi(
          env, 'POST', '/messages?user_id=' + job.payload.chat_id,
          maxMessage(job.payload), transport
        );
        messageId = result.message?.body?.mid;
        if (typeof messageId !== 'string' || !messageId) {
          throw new Error('Invalid MAX response');
        }
      } else {
        const result = await telegram(env, 'sendMessage', job.payload, transport);
        if (!Number.isSafeInteger(result?.message_id)) {
          throw new Error('Invalid Telegram response');
        }
        messageId = String(result.message_id);
      }
    } catch (error) {
      const code = /^(Telegram|MAX) error (\d+)$/.exec(error.message);
      await rpc(env, 'nr_failed', {
        i: job.id, l: job.lease_token,
        e: code ? code[1].toLowerCase() + '_' + code[2] : 'transport'
      }, transport);
      continue;
    }
    await rpc(env, 'nr_delivered_remote', {
      i: job.id, l: job.lease_token, m: messageId
    }, transport);
  }
}
