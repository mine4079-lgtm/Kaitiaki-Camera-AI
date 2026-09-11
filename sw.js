const CACHE_NAME = 'kaitiaki-camera-v47';
const IMAGE_CACHE = 'kaitiaki-camera-images-v1';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./sw.js','./runtime-fix.js','./bulk-training-ai-v2.js'];

async function patchHtml(response){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  try{
    const text=await response.text();
    let patched=text.replace(/<script[^>]+src=["'][^"']*(?:offline-fix|batch-review|phase2-fix|runtime-fix|bulk-training)\.js[^>]*><\/script>\s*/gi,'');
    patched=patched.replace('</body>','<script src="./runtime-fix.js?v=3"></script>\n<script src="./ai-trainer-v13.js?v=7"></script>\n</body>');
    const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');
    return new Response(patched,{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}
async function cacheShell(){const cache=await caches.open(CACHE_NAME);for(const url of APP_SHELL){try{const r=await fetch(url,{cache:'no-store'});await cache.put(url,url.endsWith('.html')||url==='./'?await patchHtml(r.clone()):r)}catch{}}}
self.addEventListener('install',e=>e.waitUntil(cacheShell().then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==IMAGE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{const p=await patchHtml(r.clone());caches.open(CACHE_NAME).then(c=>c.put(e.request,p.clone())).catch(()=>{});return p}).catch(()=>caches.match(e.request).then(c=>c||(e.request.mode==='navigate'?caches.match('./index.html'):new Response('',{status:504,statusText:'Offline'})))))});
