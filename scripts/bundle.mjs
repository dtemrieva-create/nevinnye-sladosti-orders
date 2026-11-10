import fs from 'node:fs/promises';
await fs.mkdir('.local/dashboard',{recursive:true});
const core=await fs.readFile('supabase/functions/_shared/core.js','utf8');
for(const name of ['setup-telegram','create-application','telegram-hook']){try{let source=await fs.readFile(`supabase/functions/${name}/index.js`,'utf8');source=source.replace(/^import .* from ['"]\.\.\/_shared\/core\.js['"];?\r?\n/m,'');await fs.writeFile(`.local/dashboard/${name}.js`,core+'\n'+source);}catch(error){if(error.code!=='ENOENT')throw error;}}
