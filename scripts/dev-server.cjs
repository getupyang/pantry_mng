// Local frontend + real hosted API. Writes go to the connected cloud family.
// Run: node scripts/dev-server.cjs
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const upstream='https://pantry-mng.vercel.app';
const allowedFiles=new Map([['/pantry.html','text/html; charset=utf-8'],['/config.js','text/javascript; charset=utf-8']]);
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      if(!/^\/api\/(families(?:\/.*)?|openrouter|recognition-review|usage-event)$/.test(url.pathname)){
        res.writeHead(404);res.end();return;
      }
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const headers={};
      for(const key of ['content-type','x-client-id','x-family-id','x-recognition-type','x-review-consent'])if(req.headers[key])headers[key]=req.headers[key];
      const response=await fetch(upstream+url.pathname+url.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),signal:AbortSignal.timeout(180000)});
      res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
      res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const pathname=url.pathname==='/'?'/pantry.html':url.pathname;
    if(!allowedFiles.has(pathname)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':allowedFiles.get(pathname),'Cache-Control':'no-store'});
    res.end(await fs.readFile(path.join(root,pathname)));
  }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local API proxy failed',message:error.message}));}
}).listen(8031,'127.0.0.1',()=>console.log('http://localhost:8031/pantry.html — real cloud API enabled'));
