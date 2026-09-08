const CACHE_NAME = 'kaitiaki-camera-v12';
const IMAGE_CACHE = 'kaitiaki-camera-images-v1';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./sw.js','./runtime-fix.js'];

async function patchHtml(response){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  try{
    const text=await response.text();
    let patched=text
      .replace(/<script[^>]+src=["'][^"']*(?:offline-fix|batch-review|phase2-fix|runtime-fix)\.js[^>]*><\/script>\s*/gi,'');
    if(!patched.includes('runtime-fix.js')) patched=patched.replace('</body>','<script src="./runtime-fix.js?v=2"></script>\n</body>');
    const headers=new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    return new Response(patched,{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}

async function cacheShell(){
  const cache=await caches.open(CACHE_NAME);
  for(const url of APP_SHELL){
    try{
      const response=await fetch(url,{cache:'no-store'});
      const patched=url.endsWith('.html')||url==='./'?await patchHtml(response.clone()):response;
      await cache.put(url,patched);
    }catch{}
  }
}

self.addEventListener('install',event=>{event.waitUntil(cacheShell().then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==IMAGE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(
    fetch(event.request,{cache:'no-store'}).then(async r=>{
      const p=await patchHtml(r.clone());
      caches.open(CACHE_NAME).then(c=>c.put(event.request,p.clone())).catch(()=>{});
      return p;
    }).catch(()=>caches.match(event.request).then(c=>c || (event.request.mode==='navigate'?caches.match('./index.html'):new Response('',{status:504,statusText:'Offline'}))))
  );
});
