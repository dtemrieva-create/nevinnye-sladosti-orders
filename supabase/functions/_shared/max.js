import {MAX_CA_CERTIFICATES} from './max-ca.js';

let maxHttpClient;

export async function maxApi(env, method, path, payload, transport = fetch) {
  const url = new URL(path, 'https://platform-api2.max.ru');
  if (url.origin !== 'https://platform-api2.max.ru') {
    throw new Error('Invalid MAX destination');
  }
  const token = env('MAX_BOT_TOKEN');
  if (!token) throw new Error('MAX is not configured');

  const options = {
    method,
    headers: {Authorization: token, 'Content-Type': 'application/json'},
    signal: AbortSignal.timeout(8000),
    redirect: 'error'
  };
  if (payload !== undefined) options.body = JSON.stringify(payload);
  if (transport === fetch && typeof Deno !== 'undefined') {
    maxHttpClient ??= Deno.createHttpClient({caCerts: MAX_CA_CERTIFICATES});
    options.client = maxHttpClient;
  }
  const response = await transport(url, options);
  const result = await response.json();
  if (!response.ok || result.success === false || result.error) {
    throw new Error('MAX error ' + response.status);
  }
  return result;
}

export function maxMessage(payload) {
  const result = {text: payload.text, notify: true};
  const rows = payload.reply_markup?.inline_keyboard;
  if (rows?.length) {
    result.attachments = [{
      type: 'inline_keyboard',
      payload: {buttons: rows.map(row => row.map(button => ({
        type: 'callback',
        text: button.text,
        payload: button.callback_data
      })))}
    }];
  }
  return result;
}
