import {readFile} from 'node:fs/promises';

const action = process.argv[2];
if (!['identity', 'status', 'register'].includes(action)) {
  console.error('Usage: node scripts/max.mjs identity|status|register');
  process.exit(1);
}
try {
  const raw = await readFile(new URL('../.local/secrets.env', import.meta.url), 'utf8');
  const secret = raw.match(/^SETUP_SECRET=([A-Za-z0-9_-]{32,})\s*$/m)?.[1];
  if (!secret) throw Error();
  const response = await fetch('https://qdblduviiygaolwknuda.supabase.co/functions/v1/setup-max', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Setup-Secret': secret},
    body: JSON.stringify({action}), signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Error();
  console.log(JSON.stringify(await response.json()));
} catch {
  console.error('MAX setup unavailable. The temporary setup-max function may have been removed.');
  process.exitCode = 1;
}
