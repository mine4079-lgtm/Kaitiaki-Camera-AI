// Phase 2 batch collection/review enhancement.
// Adds a clear multi-image gallery workflow without rebuilding the existing app.
(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn); else fn(); }
  ready(function(){
    const input=document.getElementById('fileInput');
    const saveBtn=document.getElementById('saveImage');
    if(!input||!saveBtn) return;
    input.setAttribute('accept','image/*');
    const drop=input.closest('.drop');
    if(!drop) return;

    let batchInput=document.getElementById('batchFileInput');
    if(!batchInput){
      batchInput=document.createElement('input');
      batchInput.id='batchFileInput';
      batchInput.type='file';
      batchInput.accept='image/*';
      batchInput.multiple=true;
      batchInput.style.display='none';
      drop.appendChild(batchInput);
    }

    let batchButton=document.getElementById('batchChooseBtn');
    if(!batchButton){
      batchButton=document.createElement('button');
      batchButton.type='button';
      batchButton.id='batchChooseBtn';
      batchButton.className='btn secondary';
      batchButton.style.cssText='margin-top:10px;width:100%';
      batchButton.textContent='🖼️ Choose multiple images from gallery';
      drop.appendChild(batchButton);
    }

    let msg=drop.querySelector('.batch-help');
    if(!msg){
      msg=document.createElement('div');
      msg.className='batch-help';
      msg.style.cssText='margin-top:8px;font-size:12px;color:#69736f;font-weight:700;text-align:center;line-height:1.4';
      msg.textContent='Use the gallery button to select several images at once. Take photo remains one image at a time.';
      drop.appendChild(msg);
    }

    let batch=[];
    let previewList=document.getElementById('batchPreviewList');
    if(!previewList){
      previewList=document.createElement('div');
      previewList.id='batchPreviewList';
      previewList.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px';
      drop.appendChild(previewList);
    }

    batchButton.addEventListener('click',()=>batchInput.click());

    batchInput.addEventListener('change',function(){
      batch=Array.from(batchInput.files||[]);
      render();
      saveBtn.textContent=batch.length?('Save '+batch.length+' images to collection'):'Save image to collection';
    });

    input.addEventListener('change',function(){
      if(input.files?.length){
        batch=[];
        batchInput.value='';
        previewList.innerHTML='';
        saveBtn.textContent='Save image to collection';
      }
    });

    function render(){
      previewList.innerHTML='';
      batch.slice(0,30).forEach(file=>{
        const img=document.createElement('img');
        img.src=URL.createObjectURL(file);
        img.alt=file.name;
        img.title=file.name;
        img.style.cssText='width:100%;height:75px;object-fit:cover;border-radius:8px;background:#dfe6e3';
        previewList.appendChild(img);
      });
      if(batch.length>30){
        const n=document.createElement('div');
        n.textContent='+'+(batch.length-30)+' more';
        n.style.cssText='grid-column:1/-1;font-size:11px;color:#69736f;padding:4px';
        previewList.appendChild(n);
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
            const out=c.toDataURL('image/jpeg',quality);
            URL.revokeObjectURL(url);
            resolve(out);
          }catch(e){URL.revokeObjectURL(url);reject(e)}
        };
        img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read image'))};
        img.src=url;
      });
    }

    async function saveBatch(){
      if(!batch.length){ alert('Choose one or more images from the gallery first.'); return; }
      const cameras=JSON.parse(localStorage.getItem('kaitiaki-camera-cameras-v2')||'[]');
      const cameraId=document.getElementById('captureCamera')?.value || cameras[0]?.id || '';
      const note=document.getElementById('captureNote')?.value.trim()||'';
      let images=[];
      try{images=JSON.parse(localStorage.getItem('kaitiaki-camera-images-v2')||'[]')}catch{}
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
          catch(e){images=original.slice();throw new Error('Storage is full. Saved '+(done-1)+' images before storage filled.');}
        }
        batch=[];
        batchInput.value='';
        input.value='';
        previewList.innerHTML='';
        const p=document.getElementById('preview');if(p)p.style.display='none';
        const n=document.getElementById('captureNote');if(n)n.value='';
        saveBtn.textContent='Save image to collection';
        if(typeof window.refresh==='function') window.refresh();
        if(typeof window.showView==='function') window.showView('inbox');
        else document.querySelector('[data-go="inbox"]')?.click();
      }catch(e){
        alert(e.message||'Some images could not be saved.');
        if(typeof window.refresh==='function') window.refresh();
      }finally{
        saveBtn.disabled=false;
        if(!batch.length) saveBtn.textContent='Save image to collection';
      }
    }

    saveBtn.addEventListener('click',function(e){
      if(!batch.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      saveBatch();
    },true);
  });
})();
