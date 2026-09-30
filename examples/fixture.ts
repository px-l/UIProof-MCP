import { createServer } from 'node:http';
export async function fixture() {
  let broken=false;
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:#15213b;font:16px Arial}header{padding:24px 40px;background:white;border-bottom:1px solid #ddd}main{padding:32px 40px}h1{font-size:32px}section{display:flex;gap:20px}.card{background:white;padding:24px;border-radius:12px;width:220px;height:140px}button{border:0;background:${broken?'#e2513a':'#3659db'};color:white;padding:14px 24px;border-radius:8px;font-size:16px}#details{margin-top:20px;background:white;padding:20px}</style><header>UIProof / 项目工作台</header><main><h1>交付概览</h1><p>从需求到可验收的产品</p><section><div class="card" id="requirements">待确认需求<h1>12</h1></div><div class="card" id="completed">已完成<h1>${broken?'80':'08'}</h1></div>${broken?'':'<div class="card" id="review">待评审<h1>03</h1></div>'}</section><p><button id="create" onclick="document.querySelector('#details').hidden=false">创建任务</button></p><div hidden id="details">新任务 · 填写验收标准</div></main></html>`);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string') throw new Error('No fixture port');
  return {url:`http://127.0.0.1:${address.port}`,setBroken:(v:boolean)=>{broken=v;},close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
