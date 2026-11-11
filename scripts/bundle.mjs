import fs from 'node:fs/promises';
import path from 'node:path';

await fs.mkdir('.local/dashboard', {recursive: true});
const entrypoints = ['create-application', 'telegram-hook', 'setup-telegram', 'max-hook', 'setup-max'];
for (const name of entrypoints) {
  const seen = new Set();
  const modules = [];
  async function visit(file) {
    const absolute = path.resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    let source = await fs.readFile(absolute, 'utf8');
    const imports = [...source.matchAll(/^import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"];?\r?\n/gm)];
    for (const match of imports) {
      if (!match[1].startsWith('.')) throw new Error('Bundle requires a local module');
      await visit(path.resolve(path.dirname(absolute), match[1]));
      source = source.replace(match[0], '');
    }
    source = source.replace(/if\s*\(import\.meta\.main\)\s*/g, '');
    modules.push('// ' + path.relative(process.cwd(), absolute).replaceAll('\\', '/') + '\n' + source);
  }
  await visit('supabase/functions/' + name + '/index.js');
  await fs.writeFile('.local/dashboard/' + name + '.js', modules.join('\n'));
}
console.log('Standalone function bundles prepared.');
