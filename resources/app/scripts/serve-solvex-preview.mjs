// UI-only preview: static assets + in-memory fixtures. No backend or database imports.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, wallet } from '../test/fixtures/solvex-preview.mjs';
const root = path.resolve(import.meta.dirname, '../public');
const port = Number(process.env.SOLVEX_PREVIEW_PORT || 5175);
const injection = '<script>window.ethereum={request:async function(p){if(["eth_accounts","eth_requestAccounts"].includes(p.method))return ["'+wallet+'"];if(p.method==="eth_chainId")return "0x38";if(p.method==="personal_sign")return "UI_PREVIEW_ONLY";throw Error("界面预览不提交链上操作")},on:function(){},removeListener:function(){}};window.EventSource=class{static CLOSED=2;readyState=1;close(){this.readyState=2}addEventListener(){}removeEventListener(){}};if("serviceWorker" in navigator)navigator.serviceWorker.register=async function(){return {}};</script><div style="position:fixed;right:14px;bottom:80px;z-index:2000;background:#252946;color:#d8ccff;padding:5px 14px;border-radius:20px;font:11px system-ui;pointer-events:none;white-space:nowrap">界面预览 · 示例数据</div>';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(url.pathname.startsWith('/api/')) {
      const allowed = req.method === 'GET' || ['/api/wallet/login-challenge','/api/wallet/login-sign','/api/wallet/disconnect','/api/support/read','/api/community/read'].includes(url.pathname);
      res.writeHead(allowed?200:403,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(allowed?fixture(url):{error:'界面预览使用示例数据，资金与消息操作未提交'}));
      return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if(!file.startsWith(root + path.sep)){res.writeHead(403);res.end();return;}
    let body = await fs.readFile(file);
    if(path.extname(file)==='.html') {
      const separator=injection.indexOf('<div');
      body=Buffer.from(body.toString().replace('<head>','<head>'+injection.slice(0,separator)).replace('<body>','<body>'+injection.slice(separator)));
    }
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:body);
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log('Solvex UI preview: http://127.0.0.1:'+port+' (fixtures only)'));
