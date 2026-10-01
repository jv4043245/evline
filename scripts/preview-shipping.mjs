// Loopback-only, read-only UI fixture. No production API, credentials, AI or DB.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import evidence from '../tests/fixtures/shipping-evidence.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const port=Number(process.env.PORT || 8791);
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') {res.writeHead(405);return res.end('Read-only fixture');}
  if(url.pathname==='/api/admin/shipping-reference') {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...evidence,ai_enabled:false}));}
  if(url.pathname==='/api/admin/shipping') {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({carriers:[],rates:[]}));}
  if(!/^\/(?:admin\/(?:shipping-pricelist\/|admin\.css)|assets\/|favicon)/.test(url.pathname)) {res.writeHead(404);return res.end('Not in shipping preview');}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(!/^(?:admin\/(?:shipping-pricelist\/|admin\.css$)|assets\/|favicon)/.test(relative)) {res.writeHead(404);return res.end('Not in shipping preview');}
  if(!file.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
  try {const bytes=await readFile(file);res.setHeader('Content-Type',(mime[path.extname(file)] || 'application/octet-stream')+'; charset=utf-8');res.end(bytes);}
  catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Read-only shipping fixture: http://127.0.0.1:${port}/admin/shipping-pricelist/`));
