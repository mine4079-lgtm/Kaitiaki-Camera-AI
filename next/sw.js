/* Kaitiaki Camera AI offline shell. Source photo bytes are never cached. */
const CACHE="kaitiaki-next-shell-v48";
const SHELL=["./","./index.html","./cloud-ui.js","./shared-ui.js","./camera-report.js","./manifest.webmanifest"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith("kaitiaki-next-")&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(event.request.mode==="navigate"){
    event.respondWith(
      fetch(event.request,{cache:"no-store"}).then(response=>{
        if(response.ok)caches.open(CACHE).then(cache=>cache.put("./index.html",response.clone())).catch(()=>{});
        return response;
      }).catch(()=>caches.match("./index.html").then(cached=>cached||caches.match("./")))
    );
    return;
  }

  const isShell=SHELL.some(p=>new URL(p,self.registration.scope).href===event.request.url);
  if(isShell){
    event.respondWith(
      caches.match(event.request).then(cached=>{
        const fresh=fetch(event.request).then(response=>{
          if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone())).catch(()=>{});
          return response;
        }).catch(()=>cached);
        return cached||fresh;
      })
    );
  }
});
