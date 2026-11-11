import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('public');
const contentTypes = {
  html:'text/html', css:'text/css', js:'text/javascript', mjs:'text/javascript',
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', svg:'image/svg+xml'
};
createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep) || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end(); return;
  }
  try {
    const data = await readFile(target);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(target).slice(1)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404).end(); }
}).listen(8788, '127.0.0.1', () => console.log('http://127.0.0.1:8788/'));
