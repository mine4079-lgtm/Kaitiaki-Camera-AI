// Phase 2 batch collection/review enhancement.
// This file is injected by the service worker so the existing app is not rebuilt.
(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn); else fn(); }
  ready(function(){
    const input=document.getElementById('fileInput');
    const saveBtn=document.getElementById('saveImage');
    if(!input||!saveBtn) return;
    input.setAttribute('multiple','multiple');
    input.setAttribute('accept','image/*');

    const drop=input.closest('.drop');
    if(drop){
      let msg=drop.querySelector('.batch-help');
      if(!msg){
        msg=document.createElement('div'); msg.className='batch-help';
        msg.style.cssText='margin-top:10px;font-size:12px;color:#69736f;font-weight:700';
        msg.textContent='You can now choose multiple images at once.';
        drop.appendChild(msg);
      }
    }

    let batch=[];
    let previewList=document.getElementById('batchPreviewList');
    if(!previewList){
      previewList=document.createElement('div'); previewList.id='batchPreviewList';
      previewList.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px';
      input.closest('.drop').appendChild(previewList);
    }

    input.addEventListener('change',function(){
      batch=Array.from(input.files||[]);
      render();
      saveBtn.textContent=batch.length?('Save '+batch.length+' images to collection'):'Save image to collection';
    });

    function render(){
      previewList.innerHTML='';
      batch.slice(0,30).forEach(file=>{
        const img=document.createElement('img'); img.src=URL.createObjectURL(file);
        img.alt=file.name; img.title=file.name;
        img.style.cssText='width:100%;height:75px;object-fit:cover;border-radius:8px;background:#dfe6e3';
        previewList.appendChild(img);
      });
      if(batch.length>30){
        const n=document.createElement('div'); n.textContent='+'+(batch.length-30)+' more';
        n.style.cssText='grid-column:1/-1;font-size:11px;color:#69736f;padding:4px'; previewList.appendChild(n);
      }
    }

    async function compress(file,maxSide,quality){
      return new Promise((resolve,reject)=>{
        const url=URL.createObjectURL(file),img=new Image();
        img.onload=function(){
          try{
            const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
            const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
            const c=document.createElement('canvas'); c.width=w;c.height=h;
            c.getContext('2d').drawImage(img,0,0,w,h);
            const out=c.toDataURL('image/jpeg',quality); URL.revokeObjectURL(url); resolve(out);
          }catch(e){URL.revokeObjectURL(url);reject(e)}
        };
        img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read image'))}; img.src=url;
      });
    }

    async function saveBatch(){
      if(!batch.length){ alert('Choose one or more images first.'); return; }
      const cameras=JSON.parse(localStorage.getItem('kaitiaki-camera-cameras-v2')||'[]');
      const cameraId=document.getElementById('captureCamera')?.value || cameras[0]?.id || '';
      const note=document.getElementById('captureNote')?.value.trim()||'';
      let images=[]; try{images=JSON.parse(localStorage.getItem('kaitiaki-camera-images-v2')||'[]')}catch{}
      const original=images.slice();
      saveBtn.disabled=true;
      let done=0;
      try{
        for(const file of batch){
          let src;
          try{src=await compress(file,1600,.72)}catch{src=await compress(file,1000,.55)}
          images.unshift({id:'IMG-'+Date.now()+'-'+done,cameraId,src,note,created:new Date().toISOString(),result:null,originalFileName:file.name});
          done++;
          saveBtn.textContent='Saving '+done+' of '+batch.length+'...';
          try{localStorage.setItem('kaitiaki-camera-images-v2',JSON.stringify(images))}
          catch(e){
            images=original.slice();
            throw new Error('Storage is full. Saved '+(done-1)+' images before storage filled.');
          }
        }
        batch=[]; input.value=''; previewList.innerHTML='';
        const p=document.getElementById('preview');if(p)p.style.display='none';
        const n=document.getElementById('captureNote');if(n)n.value='';
        saveBtn.textContent='Save image to collection';
        // Use the existing app refresh/navigation if present.
        if(typeof window.refresh==='function') window.refresh();
        if(typeof window.showView==='function') window.showView('inbox');
        else document.querySelector('[data-go="inbox"]')?.click();
      }catch(e){
        alert(e.message||'Some images could not be saved.');
        if(typeof window.refresh==='function') window.refresh();
      }finally{saveBtn.disabled=false;if(!batch.length)saveBtn.textContent='Save image to collection';}
    }
    // Replace the original single-file save action with batch save.
    saveBtn.onclick=saveBatch;
  });
})();
