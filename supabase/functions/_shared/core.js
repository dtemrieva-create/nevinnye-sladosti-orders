export function databaseKey(env) {
  for (const name of ['SERVER_DB_KEY','SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY']) {
    const value=env(name); if(!value) continue;
    if(name!=='SUPABASE_SECRET_KEYS') return value;
    if(value.startsWith('sb_secret_')) return value;
    try { const keys=JSON.parse(value); if(typeof keys.default==='string'&&keys.default) return keys.default; const first=Object.values(keys).find(v=>typeof v==='string'&&v); if(first) return first; } catch {}
  }
  throw new Error('Database key unavailable');
}
export async function equalSecret(a,b){if(!a||!b)return false;const encoder=new TextEncoder();const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));const [x,y]=await Promise.all([digest(a),digest(b)]);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;}
export function json(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
export async function telegram(env,method,payload,transport=fetch){const token=env('BOT_TOKEN');if(!token)throw new Error('Bot not configured');const response=await transport(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});let result;try{result=await response.json();}catch{throw new Error('Telegram response invalid');}if(!response.ok||!result.ok)throw new Error(`Telegram error ${result.error_code||response.status}`);return result.result;}
export async function body(request,max=16384){const length=Number(request.headers.get('content-length'));if(length>max)throw new Error('Body too large');const reader=request.body?.getReader();if(!reader)throw new Error('Body missing');const chunks=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Body too large');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function rpc(env, name, payload, transport=fetch) {
  const key=databaseKey(env);
  const base=env('SUPABASE_URL');
  if (!base || new URL(base).protocol!=='https:') throw new Error('Invalid database URL');
  const headers={apikey:key,'Content-Type':'application/json'};
  if (!key.startsWith('sb_secret_')) headers.Authorization='Bearer '+key;
  const response=await transport(new URL('/rest/v1/rpc/'+name,base),{
    method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Database request failed');
  const result = await response.text();
  return result ? JSON.parse(result) : null;
}
const encoder=new TextEncoder();
export async function sha256(value) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function signature(secret,value) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
