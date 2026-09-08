// Phase 2 reliability fix.
// Keeps the existing app intact while reducing localStorage pressure so
// human observations and verified training data can continue to be saved.
(function(){
  'use strict';
  const IMAGE_KEY='kaitiaki-camera-images-v2';
  const TRAINING_KEY='kaitiaki-camera-training-v1';

  function compactDataUrl(src,maxSide,quality){
    return new Promise((resolve,reject)=>{
      if(!src || !src.startsWith('data:image/')) return resolve(src);
      const img=new Image();
      img.onload=()=>{
        try{
          const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
          const w=Math.max(1,Math.round((img.naturalWidth||1)*scale));
          const h=Math.max(1,Math.round((img.naturalHeight||1)*scale));
          const canvas=document.createElement('canvas');
          canvas.width=w;canvas.height=h;
          canvas.getContext('2d').drawImage(img,0,0,w,h);
          resolve(canvas.toDataURL('image/jpeg',quality));
        }catch(e){reject(e)}
      };
      img.onerror=()=>reject(new Error('Image compression failed'));
      img.src=src;
    });
  }

  async function compactImages(images,maxSide=640,quality=.25){
    let changed=false;
    for(const item of images){
      if(!item.src || !item.src.startsWith('data:image/')) continue;
      try{
        const compact=await compactDataUrl(item.src,maxSide,quality);
        if(compact.length < item.src.length*.9){item.src=compact;changed=true;}
      }catch{}
    }
    return changed;
  }

  function migrateTraining(){
    try{
      const raw=localStorage.getItem(TRAINING_KEY);
      if(!raw)return;
      const data=JSON.parse(raw);
      if(!Array.isArray(data))return;
      let changed=false;
      for(const item of data){
        if(Object.prototype.hasOwnProperty.call(item,'src')){delete item.src;changed=true;}
      }
      if(changed)localStorage.setItem(TRAINING_KEY,JSON.stringify(data));
    }catch{}
  }

  async function renderTrainingFixed(){
    const el=document.getElementById('trainingList');
    const pill=document.getElementById('trainingCountPill');
    if(!el||typeof trainingData==='undefined')return;
    if(pill)pill.textContent=`${trainingData.length} image${trainingData.length===1?'':'s'}`;
    if(!trainingData.length){
      el.innerHTML='<div class="empty"><p class="muted">No verified training images yet.</p><p class="small">Review an image, choose the correct animal, then tick the training-data box before saving.</p></div>';
      return;
    }
    let sourceImages=[];
    try{sourceImages=JSON.parse(localStorage.getItem(IMAGE_KEY)||'[]');}catch{}
    const byId=new Map(sourceImages.map(x=>[x.id,x]));
    el.innerHTML=`<div class="training-list">${trainingData.slice().reverse().map(t=>{
      const source=byId.get(t.imageId)||{};
      const src=source.src||'';
      return `<div class="training-item">${src?`<img src="${src}" alt="Training image">`:''}<div class="training-item-main"><b>${String(t.label||'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}</b><span>${String(t.cameraName||t.cameraId||'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))} · ${t.imageDate?new Date(t.imageDate).toLocaleString('en-NZ'):''}</span><span>Verified ${t.verifiedAt?new Date(t.verifiedAt).toLocaleString('en-NZ'):''}</span></div></div>`;
    }).join('')}</div>`;
  }

  async function saveReviewFixed(next){
    if(!selectedResult){alert('Choose an observation first.');return;}
    const list=pending(),x=list[currentReview];
    if(!x)return;
    const real=images.find(i=>i.id===x.id);
    if(!real)return;

    real.result=selectedResult;
    real.reviewNote=document.getElementById('reviewNote')?.value.trim()||'';
    real.reviewedAt=new Date().toISOString();
    const verified=document.getElementById('trainingVerified')?.checked&&!trainingFor(real.id);

    // Compact the whole collection before writing the updated observation.
    await compactImages(images,640,.25);

    try{
      save(IMAGE_KEY,images);
    }catch(e){
      // Last-resort compact pass for phones with a small storage quota.
      await compactImages(images,420,.18);
      try{save(IMAGE_KEY,images)}catch(e2){
        alert('The observation could not be saved because this device is out of local storage. No data was deleted.');
        return;
      }
    }

    if(verified){
      const c=cameraById(real.cameraId)||{};
      trainingData.push({
        id:'TRAIN-'+real.id,
        imageId:real.id,
        label:real.result,
        cameraId:real.cameraId||'',
        cameraName:c.name||'',
        site:c.site||'',
        imageDate:real.created,
        verifiedAt:new Date().toISOString(),
        reviewNote:real.reviewNote||''
      });
      try{save(TRAINING_KEY,trainingData)}catch{
        trainingData.pop();
        alert('Observation saved, but there was not enough local storage to add this image to the training dataset.');
      }
    }

    selectedResult='';
    if(next&&pending().length)currentReview=Math.min(currentReview,pending().length-1);else currentReview=0;
    refresh();
    renderTrainingFixed();
  }

  async function boot(){
    migrateTraining();
    try{
      const compacted=await compactImages(images,640,.25);
      if(compacted){
        try{save(IMAGE_KEY,images)}catch{}
      }
    }catch{}
    // Training records now store metadata only; the image remains in the
    // ordinary monitoring record and is looked up by imageId when displayed.
    if(typeof saveReview==='function')saveReview=saveReviewFixed;
    if(typeof renderTraining==='function')renderTraining=renderTrainingFixed;
    renderTrainingFixed();
  }

  setTimeout(boot,150);
})();
