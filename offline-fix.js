(function(){
  const KEY='kaitiaki-camera-images-v2';
  const btn=document.getElementById('saveImage');
  if(!btn) return;
  function read(){try{const x=JSON.parse(localStorage.getItem(KEY));return Array.isArray(x)?x:[]}catch{return []}}
  function write(v){localStorage.setItem(KEY,JSON.stringify(v))}
  function compress(file,maxSide=800,quality=.48){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{try{const s=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*s)),h=Math.max(1,Math.round(img.naturalHeight*s)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);const out=c.toDataURL('image/jpeg',quality);URL.revokeObjectURL(url);resolve(out)}catch(e){URL.revokeObjectURL(url);reject(e)}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read image'))};img.src=url})}
  async function shrinkStored(list){
    for(const x of list){
      if(!x.src || !x.src.startsWith('data:image/')) continue;
      try{
        const r=await fetch(x.src), b=await r.blob();
        x.src=await compress(b,420,.35);
      }catch{}
    }
  }
  function showStatus(message){
    let n=document.getElementById('offlineStatus');
    if(!n){n=document.createElement('div');n.id='offlineStatus';n.style.cssText='position:fixed;top:0;left:0;right:0;z-index:200;text-align:center;padding:6px 8px;font:700 12px Arial;background:#e8f3f0;color:#0d6658;display:none';document.body.appendChild(n)}
    n.textContent=message;
    n.style.display='block';
    clearTimeout(showStatus.t);showStatus.t=setTimeout(()=>n.style.display='none',4500);
  }
  btn.onclick=async()=>{
    const input=document.getElementById('fileInput'), file=input?.files?.[0];
    if(!file){alert('Take a photo or choose an image first.');return}
    btn.disabled=true;btn.textContent='Saving image...';
    try{
      images=read();
      const record={id:'IMG-'+Date.now(),cameraId:document.getElementById('captureCamera').value,src:await compress(file,800,.48),note:document.getElementById('captureNote').value.trim(),created:new Date().toISOString(),result:null,syncStatus:navigator.onLine?'local':'offline-pending'};
      images.unshift(record);
      try{write(images)}catch(e){
        if(e?.name!=='QuotaExceededError') throw e;
        await shrinkStored(images.slice(1));
        write(images);
      }
      input.value='';
      document.getElementById('preview').style.display='none';
      document.getElementById('captureNote').value='';
      selectedFile=null;
      if(typeof refresh==='function') refresh();
      if(typeof showView==='function') showView('inbox');
      showStatus(navigator.onLine?'Image saved on this device':'Offline: image saved on this device and marked pending');
    }catch(e){console.error(e);alert('The image could not be saved on this device. Please try the photo again.');}
    finally{btn.disabled=false;btn.textContent='Save image to collection'}
  };
  function status(){
    showStatus(navigator.onLine?'Online — images save on this device':'Offline — images save on this device and can be reviewed without internet');
  }
  window.addEventListener('online',status);
  window.addEventListener('offline',status);
  status();
})();
