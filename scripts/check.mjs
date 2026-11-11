import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const files = await readdir('public', {recursive: true, withFileTypes: true});
const forbidden = /sb_secret_[A-Za-z0-9_-]{12,}|\b[0-9]{7,}:[A-Za-z0-9_-]{20,}|SERVICE_ROLE_KEY|FORM_SECRET|BOT_TOKEN|SETUP_SECRET|TG_WEBHOOK_SECRET|MAX_WEBHOOK_SECRET/;
for (const entry of files) {
  if (!entry.isFile()) continue;
  const file = entry.parentPath + '/' + entry.name;
  assert.doesNotMatch(file, /(?:^|\/)\.env|secrets\.env|\.local/);
  if (/\.(html|css|m?js|json|svg)$/.test(file)) {
    assert.doesNotMatch(await readFile(file, 'utf8'), forbidden);
  }
}
for (const directory of ['public', 'scripts', 'supabase/functions', 'tests']) {
  for (const file of await readdir(directory, {recursive: true})) {
    if (!/\.(m?js)$/.test(file)) continue;
    assert.equal(spawnSync(process.execPath, ['--check', directory + '/' + file], {stdio: 'inherit'}).status, 0);
  }
}
console.log('Public files and JavaScript syntax verified.');
