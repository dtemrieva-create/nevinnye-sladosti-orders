import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files={
 '/':'index.html','/index.html':'index.html','/styles.css':'styles.css',
 '/app.js':'app.js','/config.js':'config.js'
};
const contentTypes={html:'text/html',css:'text/css',js:'text/javascript'};
createServer(async (request,response)=>{
 const file=files[new URL(request.url,'http://localhost').pathname];
 if(!file||!['GET','HEAD'].includes(request.method)){response.writeHead(404).end();return;}
 try {
  const data=await readFile(new URL('../public/'+file,import.meta.url));
  response.writeHead(200,{'Content-Type':contentTypes[file.split('.').at(-1)]+'; charset=utf-8','Cache-Control':'no-store'});
  response.end(request.method==='HEAD'?undefined:data);
 } catch { response.writeHead(500).end(); }
}).listen(8788,'127.0.0.1',()=>console.log('http://127.0.0.1:8788/'));
