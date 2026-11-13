import type { Plugin } from 'vite';

export function referralsMockPlugin():Plugin {
  return {name:'local-referral-scenarios',apply:'serve',configureServer(server){
    let mock:Promise<Awaited<ReturnType<typeof import('../../tests/fixtures/referrals.ts').createReferralScenarios>>>|undefined;
    const load=()=>mock??=import('../../tests/fixtures/referrals.ts').then(module=>module.createReferralScenarios());
    server.httpServer?.once('close',()=>{if(mock)void mock.then(value=>value.db.close()).catch(()=>{});});
    server.middlewares.use(async(request,response,next)=>{
      const url=new URL(request.url??'/','http://127.0.0.1');
      if(url.pathname!=='/mock/referrals'&&url.pathname!=='/api/__dev/referrals')return next();
      response.setHeader('Cache-Control','no-store');
      if(request.method!=='GET'){response.statusCode=405;response.end('Mock is read only');return;}
      try{
        if(url.pathname==='/mock/referrals'){
          const html=await server.transformIndexHtml(url.pathname,'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>邀请返利原因 · 本地 Mock</title></head><body><div id="root"></div><script type="module" src="/src/dev/ReferralPreview.tsx"></script></body></html>');
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;
        }
        const {referrals,inviterId}=await load();
        const data=referrals.report(url.searchParams,url.searchParams.get('view')==='admin'?undefined:inviterId);
        response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify({data}));
      }catch(error){response.statusCode=500;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({error:{message:error instanceof Error?error.message:'Mock 加载失败'}}));}
    });
  }};
}
