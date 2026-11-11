import {body, equalSecret, json} from '../_shared/core.js';
import {maxApi} from '../_shared/max.js';

export function handler(env, transport = fetch) {
  return async request => {
    if (!await equalSecret(request.headers.get('X-Setup-Secret'), env('SETUP_SECRET'))) {
      return json({error: 'Unauthorized'}, 401);
    }
    if (request.method !== 'POST') return json({error: 'Method not allowed'}, 405);
    try {
      const input = await body(request, 1024);
      if (input.action === 'identity') {
        const bot = await maxApi(env, 'GET', '/me', undefined, transport);
        return json({is_bot: bot.is_bot, username: bot.username, name: bot.first_name});
      }
      if (input.action === 'status') {
        const result = await maxApi(env, 'GET', '/subscriptions', undefined, transport);
        return json({urls: result.subscriptions?.map(item => item.url) || []});
      }
      if (input.action === 'register') {
        const base = env('SUPABASE_URL');
        const secret = env('MAX_WEBHOOK_SECRET');
        if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base || '') ||
            !/^[A-Za-z0-9_-]{32,256}$/.test(secret || '')) throw new Error('Invalid settings');
        const result = await maxApi(env, 'POST', '/subscriptions', {
          url: base + '/functions/v1/max-hook',
          update_types: ['bot_started', 'message_created', 'message_callback'],
          secret
        }, transport);
        return json({ok: result.success === true});
      }
      return json({error: 'Unknown action'}, 400);
    } catch { return json({error: 'MAX setup unavailable'}, 502); }
  };
}
if (import.meta.main) Deno.serve(handler(name => Deno.env.get(name)));
