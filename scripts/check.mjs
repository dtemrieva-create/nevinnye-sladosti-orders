import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const expected=['.nojekyll','app.js','config.js','index.html','styles.css'];
assert.deepEqual((await readdir('public')).sort(),expected);
for(const name of expected){
 const source=await readFile('public/'+name,'utf8');
 assert.doesNotMatch(source,/sb_secret_[A-Za-z0-9_-]{12,}|\b[0-9]{7,}:[A-Za-z0-9_-]{20,}|SERVICE_ROLE_KEY|FORM_SECRET|BOT_TOKEN|SETUP_SECRET|TG_WEBHOOK_SECRET/);
}
for(const dir of ['public','scripts','supabase/functions','tests']){
 for(const name of await readdir(dir,{recursive:true})){
  if(!/\.(m?js)$/.test(name))continue;
  assert.equal(spawnSync(process.execPath,['--check',dir+'/'+name],{stdio:'inherit'}).status,0);
 }
}
console.log('Public files and JavaScript syntax verified.');
