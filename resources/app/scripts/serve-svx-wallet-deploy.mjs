import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../output/svx-wallet-deploy');
const port=Number(process.env.SVX_DEPLOY_PORT||8787);
const files=new Map([['/',['index.html','text/html']],['/client.js',['client.js','text/javascript']],['/artifacts.json',['artifacts.json','application/json']],['/standard-input.json',['standard-input.json','application/json']]]);
createServer((req,res)=>{
 if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end();return;}
 const file=files.get(req.url);
 if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
 try {res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});res.end(readFileSync(resolve(root,file[0])));}
 catch {res.writeHead(500);res.end('Run node scripts/build-svx-wallet-deploy.mjs first');}
}).listen(port,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+port+' in the browser with your wallet extension.'));
