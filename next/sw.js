/* Kaitiaki Next: isolated offline shell. Photo bytes are never cached. */
const CACHE="kaitiaki-next-shell-v2";
const SHELL=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("kaitiaki-next-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
   if(response.ok && (event.request.mode==="navigate"||SHELL.some(p=>new URL(p,self.registration.scope).href===event.request.url))){
      caches.open(CACHE).then(cache=>cache.put(event.request,response.clone())).catch(()=>{});
   }
   return response;
 }).catch(()=>caches.match(event.request).then(r=>r||(event.request.mode==="navigate"?caches.match("./index.html"):new Response("Offline",{status:503})))));
});