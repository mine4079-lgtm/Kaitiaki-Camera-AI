const CACHE_NAME = 'kaitiaki-camera-v7';
const IMAGE_CACHE = 'kaitiaki-camera-images-v1';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./sw.js','./offline-fix.js','./batch-review.js'];

async function patchHtml(response){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  try{
    const text=await response.text();
    let patched=text;
    if(!patched.includes('offline-fix.js')) patched=patched.replace('</body>','<script src="./offline-fix.js"></script>\n</body>');
    if(!patched.includes('batch-review.js')) patched=patched.replace('</body>','<script src="./batch-review.js"></script>\n</body>');
    const headers=new Headers(response.headers); headers.set('content-type','text/html; charset=utf-8');
    return new Response(patched,{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==IMAGE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(fetch(event.request).then(async r=>{const p=await patchHtml(r.clone());caches.open(CACHE_NAME).then(c=>c.put(event.request,p.clone()));return p}).catch(()=>caches.match(event.request).then(c=>c|| (event.request.mode==='navigate'?caches.match('./index.html'):new Response('',{status:504,statusText:'Offline'}))))
});
