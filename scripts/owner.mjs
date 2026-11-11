import {readFile} from 'node:fs/promises';
const action=process.argv[2];
if(!['status','register','test'].includes(action)){
 console.error('Usage: node scripts/owner.mjs status|register|test');
 process.exit(1);
}
try {
 const raw=await readFile(new URL('../.local/secrets.env',import.meta.url),'utf8');
 const match=raw.match(/^SETUP_SECRET=([A-Za-z0-9_-]{32,})\s*$/m);
 if(!match)throw Error();
 const response=await fetch('https://qdblduviiygaolwknuda.supabase.co/functions/v1/setup-telegram',{
  method:'POST',headers:{'Content-Type':'application/json','X-Setup-Secret':match[1]},
  body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)
 });
 if(!response.ok){
  console.error('Setup request returned HTTP '+response.status);
  process.exitCode=1;
 } else {
  const result=await response.json();
  if(action==='status')console.log(JSON.stringify({
   webhook:result.url, pending:result.pending_update_count,lastErrorDate:result.last_error_date
  }));
  else if(result.ok===true)console.log('Telegram confirmed '+action);
  else throw Error();
 }
} catch {
 console.error('Setup request failed.');
 process.exitCode=1;
}
