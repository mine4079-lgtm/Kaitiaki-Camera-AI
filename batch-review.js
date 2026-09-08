// Phase 2 batch collection/review enhancement.
// Keeps the existing app and Phase 1 workflow intact.
// Adds reliable multi-image selection and aggressively compacts local image data
// so the existing observation/review storage continues to work on phones.
(function(){
  'use strict';
  const IMAGE_KEY='kaitiaki-camera-images-v2';
  const CAMERA_KEY='kaitiaki-camera-cameras-v2';

  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn); else fn(); }
  function loadImages(){try{const x=JSON.parse(localStorage.getItem(IMAGE_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
  function saveImages(v){localStorage.setItem(IMAGE_KEY,JSON.stringify(v))}

  function compressDataUrl(src,maxSide,quality){
    return new Promise((resolve,reject)=>{
      if(!src || !src.startsWith('data:image/')) return resolve(src);
      const img=new Image();
      img.onload=()=>{
        try{
          const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
          const w=Math.max(1,Math.round((img.naturalWidth||1)*scale));
          const h=Math.max(1,Math.round((img.naturalHeight||1)*scale));
          const c=document.createElement('canvas'); c.width=w; c.height=h;
          c.getContext('2d').drawImage(img,0,0,w,h);
          resolve(c.toDataURL('image/jpeg',quality));
        }catch(e){reject(e)}
      };
      img.onerror=()=>reject(new Error('Could not compress stored image'));
      img.src=src;
    });
  }

  async function compactStoredImages(){
    const images=loadImages();
    if(!images.length) return;
    let changed=false;
    for(const item of images){
      if(!item.src || !item.src.startsWith('data:image/')) continue;
      try{
        const compact=await compressDataUrl(item.src,600,.32);
        if(compact.length < item.src.length*.9){ item.src=compact; changed=true; }
      }catch{}
    }
    if(changed){
      try{saveImages(images)}catch{}
    }
  }

  ready(function(){
    const input=document.getElementById('fileInput');
    const saveBtn=document.getElementById('saveImage');
    if(!input||!saveBtn) return;

    // The original Phase 1 picker now supports gallery multi-select.
    input.type='file';
    input.accept='image/*';
    input.multiple=true;

    const drop=input.closest('.drop');
    if(!drop) return;

    let batch=[];
    let previewList=document.getElementById('batchPreviewList');
    if(!previewList){
      previewList=document.createElement('div');
      previewList.id='batchPreviewList';
      previewList.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px';
      drop.appendChild(previewList);
    }

    let msg=drop.querySelector('.batch-help');
    if(!msg){
      msg=document.createElement('div');
      msg.className='batch-help';
      msg.style.cssText='margin-top:8px;font-size:12px;color:#69736f;font-weight:700;text-align:center;line-height:1.4';
      msg.textContent='From the gallery you can select several images at once. Taking a new photo remains one photo at a time.';
      drop.appendChild(msg);
    }

    function render(){
      previewList.innerHTML='';
      batch.slice(0,30).forEach(file=>{
        const img=document.createElement('img');
        img.src=URL.createObjectURL(file);
        img.alt=file.name;
        img.title=file.name;
        img.style.cssText='width:100%;height:75px;object-fit:cover;border-radius:8px;background:#dfe6e3';
        img.onload=()=>URL.revokeObjectURL(img.src);
        previewList.appendChild(img);
      });
      const count=document.getElementById('batchCount');
      if(count){
        count.style.display=batch.length?'block':'none';
        count.textContent=batch.length===1?'1 image selected':`${batch.length} images selected`;
      }
      saveBtn.textContent=batch.length>1?`Save ${batch.length} images to collection`:'Save image to collection';
    }

    input.addEventListener('change',function(){
      batch=Array.from(input.files||[]).filter(f=>f.type.startsWith('image/'));
      render();
    });

    async function compressFile(file,maxSide,quality){
      return new Promise((resolve,reject)=>{
        const url=URL.createObjectURL(file),img=new Image();
        img.onload=()=>{
          try{
            const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
            const w=Math.max(1,Math.round((img.naturalWidth||1)*scale));
            const h=Math.max(1,Math.round((img.naturalHeight||1)*scale));
            const c=document.createElement('canvas');c.width=w;c.height=h;
            c.getContext('2d').drawImage(img,0,0,w,h);
            const out=c.toDataURL('image/jpeg',quality);
            URL.revokeObjectURL(url);resolve(out);
          }catch(e){URL.revokeObjectURL(url);reject(e)}
        };
        img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read image'))};
        img.src=url;
      });
    }

    async function makeCompact(file){
      try{return await compressFile(file,700,.36)}
      catch{return await compressFile(file,500,.24)}
    }

    async function saveBatch(){
      if(!batch.length){alert('Choose one or more images first.');return}
      const cameras=JSON.parse(localStorage.getItem(CAMERA_KEY)||'[]');
      const cameraId=document.getElementById('captureCamera')?.value||cameras[0]?.id||'';
      const note=document.getElementById('captureNote')?.value.trim()||'';

      saveBtn.disabled=true;
      try{
        // Existing Phase 1 images may have been stored at much larger sizes.
        // Compact them before adding more so review observations still have room to save.
        await compactStoredImages();

        let images=loadImages();
        const files=[...batch];
        let done=0;
        for(const file of files){
          let src=await makeCompact(file);
          let record={
            id:'IMG-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
            cameraId,
            src,
            note,
            created:new Date().toISOString(),
            result:null,
            originalFileName:file.name
          };
          images.unshift(record);
          try{
            saveImages(images);
          }catch(e){
            // One more aggressive compaction pass before giving up.
            for(const old of images){
              if(old.src&&old.src.startsWith('data:image/')){
                try{old.src=await compressDataUrl(old.src,400,.20)}catch{}
              }
            }
            try{saveImages(images)}catch(e2){
              images.shift();
              throw new Error(`Storage is full. ${done} of ${files.length} images were saved. The existing images are safe.`);
            }
          }
          done++;
          saveBtn.textContent=`Saving ${done} of ${files.length}...`;
        }

        batch=[];input.value='';previewList.innerHTML='';
        const noteEl=document.getElementById('captureNote');if(noteEl)noteEl.value='';
        const count=document.getElementById('batchCount');if(count){count.style.display='none';count.textContent='';}
        saveBtn.textContent='Save image to collection';
        if(typeof window.refresh==='function')window.refresh();
        if(typeof window.showView==='function')window.showView('inbox');
        else document.querySelector('[data-go="inbox"]')?.click();
      }catch(e){
        alert(e.message||'Some images could not be saved.');
        if(typeof window.refresh==='function')window.refresh();
      }finally{
        saveBtn.disabled=false;
        if(!batch.length)saveBtn.textContent='Save image to collection';
      }
    }

    // Capture the save click before the original Phase 1 handler only when this
    // Phase 2 collector has a selected image. This keeps the original workflow intact.
    saveBtn.addEventListener('click',function(e){
      if(!batch.length)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      saveBatch();
    },true);

    // Compact the existing collection shortly after load.
    setTimeout(()=>compactStoredImages(),500);
  });
})();
