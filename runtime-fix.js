// Kaitiaki Camera AI - Phase 2 runtime reliability fix
// Keeps the existing app/workflow. Fixes Android multi-image saving and
// human observation saving without changing the camera list.
(function(){
  'use strict';
  const IMAGE_KEY='kaitiaki-camera-images-v2';
  const TRAINING_KEY='kaitiaki-camera-training-v1';

  function read(key,fallback){try{const v=JSON.parse(localStorage.getItem(key));return Array.isArray(v)?v:fallback}catch{return fallback}}
  function write(key,v){localStorage.setItem(key,JSON.stringify(v))}

  function compressBlob(blob,maxSide,quality){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob), img=new Image();
      img.onload=()=>{
        try{
          const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
          const w=Math.max(1,Math.round((img.naturalWidth||1)*scale));
          const h=Math.max(1,Math.round((img.naturalHeight||1)*scale));
          const c=document.createElement('canvas'); c.width=w; c.height=h;
          c.getContext('2d').drawImage(img,0,0,w,h);
          const out=c.toDataURL('image/jpeg',quality);
          URL.revokeObjectURL(url); resolve(out);
        }catch(e){URL.revokeObjectURL(url);reject(e)}
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read image'))};
      img.src=url;
    });
  }

  async function compactStoredImages(){
    const imgs=read(IMAGE_KEY,[]); if(!imgs.length)return;
    let changed=false;
    for(const x of imgs){
      if(!x.src || !x.src.startsWith('data:image/'))continue;
      try{
        const out=await compressBlob(await (await fetch(x.src)).blob(),600,.30);
        if(out.length < x.src.length*.8){x.src=out;changed=true}
      }catch{}
    }
    if(changed){try{write(IMAGE_KEY,imgs)}catch{}}
  }

  function migrateTraining(){
    const tr=read(TRAINING_KEY,[]);
    let changed=false;
    for(const t of tr){
      if(Object.prototype.hasOwnProperty.call(t,'src')){delete t.src;changed=true}
    }
    if(changed){try{write(TRAINING_KEY,tr)}catch{}}
    return tr;
  }

  function freshButton(id){
    const old=document.getElementById(id); if(!old)return null;
    const fresh=old.cloneNode(true); old.replaceWith(fresh); return fresh;
  }

  async function saveBatch(){
    const input=document.getElementById('fileInput');
    const btn=document.getElementById('saveImage');
    const files=Array.from(input?.files||[]).filter(f=>f.type.startsWith('image/'));
    if(!files.length){alert('Take a photo or choose one or more images first.');return}
    const cameraId=document.getElementById('captureCamera')?.value||'';
    const note=document.getElementById('captureNote')?.value.trim()||'';
    btn.disabled=true;
    try{
      migrateTraining();
      await compactStoredImages();
      let imgs=read(IMAGE_KEY,[]);
      for(let i=0;i<files.length;i++){
        const src=await compressBlob(files[i],650,.30);
        const record={id:'IMG-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),cameraId,src,note,created:new Date().toISOString(),result:null,originalFileName:files[i].name};
        btn.textContent=`Saving ${i+1} of ${files.length}...`;
        try{write(IMAGE_KEY,[record,...imgs]);imgs=read(IMAGE_KEY,imgs)}
        catch(e){
          try{
            for(const old of imgs){
              if(old.src?.startsWith('data:image/')) old.src=await compressBlob(await (await fetch(old.src)).blob(),420,.18);
            }
            write(IMAGE_KEY,[record,...imgs]);imgs=read(IMAGE_KEY,imgs);
          }catch(e2){throw new Error(`Storage is full. ${i} of ${files.length} images were saved. Existing images were kept.`)}
        }
      }
      input.value='';
      const grid=document.getElementById('previewGrid');if(grid)grid.innerHTML='';
      const count=document.getElementById('batchCount');if(count){count.style.display='none';count.textContent=''}
      const noteEl=document.getElementById('captureNote');if(noteEl)noteEl.value='';
      if(typeof refresh==='function')refresh();
      if(typeof showView==='function')showView('inbox');
    }catch(e){console.error(e);alert(e.message||'The images could not be saved on this device.')}
    finally{btn.disabled=false;btn.textContent='Save images to collection'}
  }

  function installCapture(){
    const input=document.getElementById('fileInput');
    if(input){
      input.multiple=true;
      input.accept='image/*';
      const freshInput=input.cloneNode(true); input.replaceWith(freshInput);
      freshInput.addEventListener('change',()=>{
        const files=Array.from(freshInput.files||[]);
        const grid=document.getElementById('previewGrid');
        const count=document.getElementById('batchCount');
        if(grid){grid.innerHTML='';files.forEach(f=>{const img=document.createElement('img');img.src=URL.createObjectURL(f);img.onload=()=>URL.revokeObjectURL(img.src);grid.appendChild(img)})}
        if(count){count.style.display=files.length?'block':'none';count.textContent=`${files.length} image${files.length===1?'':'s'} selected`}
      });
    }
    const btn=freshButton('saveImage');
    if(btn)btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();saveBatch()},true);
  }

  function installReviewSave(){
    window.saveReview=async function(next){
      if(!selectedResult){alert('Choose an observation first.');return}
      const list=pending(),x=list[currentReview];if(!x)return;
      const real=images.find(i=>i.id===x.id);if(!real)return;
      real.result=selectedResult;
      real.reviewNote=document.getElementById('reviewNote')?.value.trim()||'';
      real.reviewedAt=new Date().toISOString();
      const verified=document.getElementById('trainingVerified')?.checked&&!trainingFor(real.id);
      try{
        await compactStoredImages();
        images=read(IMAGE_KEY,images);
        const target=images.find(i=>i.id===real.id)||real;
        target.result=real.result;target.reviewNote=real.reviewNote;target.reviewedAt=real.reviewedAt;
        write(IMAGE_KEY,images);
      }catch(e){alert('The observation could not be saved because this device is out of local storage. No data was deleted.');return}
      if(verified){
        const c=cameraById(real.cameraId)||{};
        const tr=read(TRAINING_KEY,[]);
        tr.push({id:'TRAIN-'+real.id,imageId:real.id,label:real.result,cameraId:real.cameraId||'',cameraName:c.name||'',site:c.site||'',imageDate:real.created,verifiedAt:new Date().toISOString(),reviewNote:real.reviewNote||''});
        try{write(TRAINING_KEY,tr);trainingData=tr}catch{alert('Observation saved, but there was not enough local storage to add it to the training dataset.')}
      }
      selectedResult='';currentReview=(next&&pending().length)?Math.min(currentReview,pending().length-1):0;refresh();
    };
  }

  function boot(){migrateTraining();installCapture();installReviewSave();setTimeout(()=>compactStoredImages(),250)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,100));else setTimeout(boot,100);
})();
