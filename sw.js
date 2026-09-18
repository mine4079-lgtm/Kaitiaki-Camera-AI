const CACHE_NAME = 'kaitiaki-camera-v71';
const IMAGE_CACHE = 'kaitiaki-camera-images-v1';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./sw.js','./runtime-fix.js','./ai-trainer-v13.js?v=10','./training-v2.html','./ai-v2-field-classifier.js?v=11','./training-v3.html','./ai-v3-field-classifier.js?v=6','./training-v4.html','./ai-v4-field-classifier.js?v=10'];

async function patchHtml(response, requestUrl=''){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  try{
    const text=await response.text();
    const pathname=(()=>{try{return new URL(requestUrl,self.location.origin).pathname}catch{return ''}})();
    if(pathname.endsWith('/training-v2.html') || pathname.endsWith('training-v2.html') || pathname.endsWith('/training-v4.html') || pathname.endsWith('training-v4.html')){
      const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');
      return new Response(text,{status:response.status,statusText:response.statusText,headers});
    }
    let patched=text.replace(/<script[^>]+src=["'][^"']*(?:offline-fix|batch-review|phase2-fix|runtime-fix|bulk-training)\.js[^>]*><\/script>\s*/gi,'');
    const backgroundTrainingFix=`<script>(function(){if(window.__kaitiakiBackgroundTrainingFix)return;window.__kaitiakiBackgroundTrainingFix=true;const nativeRAF=window.requestAnimationFrame&&window.requestAnimationFrame.bind(window);if(!nativeRAF)return;window.requestAnimationFrame=function(cb){if(document.visibilityState==='hidden')return setTimeout(function(){cb(performance.now())},0);return nativeRAF(cb)}})();</script>`;
    patched=patched.replace('</body>',backgroundTrainingFix+'\n<script src="./runtime-fix.js?v=3"></script>\n<script src="./ai-trainer-v13.js?v=10"></script>\n</body>');
    const headers=new Headers(response.headers);headers.set('content-type','text/html; charset=utf-8');
    return new Response(patched,{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}
async function cacheShell(){const cache=await caches.open(CACHE_NAME);for(const url of APP_SHELL){try{const r=await fetch(url,{cache:'no-store'});await cache.put(url,url.endsWith('.html')||url==='./'?await patchHtml(r.clone(),url):r)}catch{}}}
self.addEventListener('install',e=>e.waitUntil(cacheShell().then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==IMAGE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{const p=await patchHtml(r.clone(),e.request.url);caches.open(CACHE_NAME).then(c=>c.put(e.request,p.clone())).catch(()=>{});return p}).catch(()=>caches.match(e.request).then(c=>c||(e.request.mode==='navigate'?caches.match('./index.html'):new Response('',{status:504,statusText:'Offline'})))))});
