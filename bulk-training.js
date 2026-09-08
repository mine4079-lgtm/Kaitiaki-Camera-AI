// Kaitiaki Camera AI — Phase 2 bulk training import
// The hard-drive images are reviewed in the browser and only explicitly
// verified labels become training records. Originals are never modified.
(function(){
  'use strict';
  const KEY='kaitiaki-camera-bulk-training-v1';
  const labels=['Possum','Rat','Stoat','Cat','Bird','Empty / No animal','Other','Unclear'];
  let queue=[];

  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return[]}};
  const write=v=>localStorage.setItem(KEY,JSON.stringify(v));

  function makePanel(){
    const host=document.getElementById('bulkTrainingPanel'); if(host)return host;
    const target=document.querySelector('#training')||document.querySelector('[data-view="training"]')||document.body;
    const panel=document.createElement('section');panel.id='bulkTrainingPanel';panel.className='card';
    panel.innerHTML=`<div class="card-head"><div><h2>Bulk Training Import</h2><p class="muted">Review images from your hard drive without changing the original files.</p></div><label class="btn primary" for="bulkTrainingFiles">Choose folder / images</label><input id="bulkTrainingFiles" type="file" accept="image/*" multiple webkitdirectory style="display:none"></div><div class="row"><span id="bulkTrainingStatus" class="muted">No images loaded.</span><button id="bulkVerifyVisible" class="btn" type="button" disabled>Verify selected</button></div><div id="bulkTrainingGrid" class="training-list"></div>`;
    target.appendChild(panel);return panel;
  }

  function render(){
    const grid=document.getElementById('bulkTrainingGrid'),status=document.getElementById('bulkTrainingStatus'),btn=document.getElementById('bulkVerifyVisible');
    if(!grid)return;
    const data=read();status.textContent=`${queue.length} images in review · ${data.length} verified bulk training records`;
    btn.disabled=!queue.length;
    grid.innerHTML=queue.map((x,i)=>`<article class="training-item" data-i="${i}"><img src="${x.url}" alt="${esc(x.name)}"><div class="training-item-main"><b>${esc(x.name)}</b><span>${esc(x.path||'')}</span><select class="bulk-label" data-i="${i}"><option value="">Choose classification…</option>${labels.map(l=>`<option>${esc(l)}</option>`).join('')}</select><label><input type="checkbox" class="bulk-verify" data-i="${i}"> Verified training data</label></div></article>`).join('');
  }

  function importFiles(files){
    queue.forEach(x=>URL.revokeObjectURL(x.url));
    queue=Array.from(files).filter(f=>f.type.startsWith('image/')).map((f,i)=>({file:f,name:f.name,path:f.webkitRelativePath||f.name,url:URL.createObjectURL(f),i}));
    render();
  }

  function verify(){
    const data=read(), now=new Date().toISOString();let added=0;
    document.querySelectorAll('.bulk-verify:checked').forEach(cb=>{
      const i=Number(cb.dataset.i),label=document.querySelector(`.bulk-label[data-i="${i}"]`)?.value,x=queue[i];
      if(!x||!label)return;
      data.push({id:'BULK-'+Date.now()+'-'+i+'-'+Math.random().toString(36).slice(2,7),source:'hard-drive-bulk-import',originalFileName:x.name,sourcePath:x.path,label,verifiedAt:now});added++;
      cb.checked=false;
    });
    if(added){try{write(data);alert(`${added} image${added===1?'':'s'} added to the separate training dataset.`)}catch{alert('Training dataset storage is full. No original files were changed.')}}
    render();
  }

  function boot(){const panel=makePanel(),input=document.getElementById('bulkTrainingFiles'),btn=document.getElementById('bulkVerifyVisible');input?.addEventListener('change',e=>importFiles(e.target.files));btn?.addEventListener('click',verify);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
