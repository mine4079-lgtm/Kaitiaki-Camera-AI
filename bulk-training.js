// Kaitiaki Camera AI — Phase 2 bulk training import
// Folder names provide proposed labels; the human reviewer still confirms them.
// Originals are never changed, moved, renamed, or uploaded to GitHub.
(function(){
  'use strict';
  const KEY='kaitiaki-camera-bulk-training-v1';
  const labels=['Possum','Rat','Stoat','Cat','Bird','Empty / No animal','Other','Unclear'];
  const BATCH=250;
  let queue=[];
  let page=0;

  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return[]}};
  const write=v=>localStorage.setItem(KEY,JSON.stringify(v));

  function proposedLabel(path){
    const parts=String(path||'').replace(/\\/g,'/').split('/').filter(Boolean).slice(0,-1);
    const text=parts.join(' / ').toLowerCase();
    if(/possum|brush.?tail|trichosurus/.test(text))return 'Possum';
    if(/rat|kiore|rattus/.test(text))return 'Rat';
    if(/stoat|mustelid/.test(text))return 'Stoat';
    if(/cat|feral.?cat/.test(text))return 'Cat';
    if(/bird|native|manu|kereru|tui|weka|pigeon/.test(text))return 'Bird';
    if(/empty|no.?animal|blank|nothing|empty.?frame/.test(text))return 'Empty / No animal';
    if(/other/.test(text))return 'Other';
    if(/unclear|unknown/.test(text))return 'Unclear';
    return '';
  }

  function makePanel(){
    const host=document.getElementById('bulkTrainingPanel'); if(host)return host;
    const target=document.querySelector('#training')||document.querySelector('[data-view="training"]')||document.body;
    const panel=document.createElement('section');panel.id='bulkTrainingPanel';panel.className='card';
    panel.innerHTML=`<div class="card-head"><div><h2>Bulk Training Import</h2><p class="muted">Use your already-classified hard-drive folders. Folder names are proposed labels; you remain in control.</p></div><label class="btn primary" for="bulkTrainingFiles">Choose folder / images</label><input id="bulkTrainingFiles" type="file" accept="image/*" multiple webkitdirectory style="display:none"></div><div class="row" style="gap:8px;flex-wrap:wrap"><span id="bulkTrainingStatus" class="muted">No images loaded.</span><button id="bulkVerifyProposed" class="btn" type="button" disabled>Verify all proposed</button><button id="bulkVerifyVisible" class="btn" type="button" disabled>Verify selected</button><button id="bulkNextBatch" class="btn" type="button" disabled>Next 250</button></div><div id="bulkTrainingCounts" class="muted" style="margin:10px 0"></div><div id="bulkTrainingGrid" class="training-list"></div>`;
    target.appendChild(panel);return panel;
  }

  function render(){
    const grid=document.getElementById('bulkTrainingGrid'),status=document.getElementById('bulkTrainingStatus'),btn=document.getElementById('bulkVerifyVisible'),all=document.getElementById('bulkVerifyProposed'),next=document.getElementById('bulkNextBatch'),counts=document.getElementById('bulkTrainingCounts');
    if(!grid)return;
    const data=read();
    const start=page*BATCH,end=Math.min(start+BATCH,queue.length),visible=queue.slice(start,end);
    status.textContent=`${queue.length.toLocaleString()} images loaded · ${data.length.toLocaleString()} verified bulk training records`;
    btn.disabled=!visible.length; all.disabled=!queue.length; next.disabled=end>=queue.length;
    const summary={};queue.forEach(x=>{const l=x.proposedLabel||'Needs classification';summary[l]=(summary[l]||0)+1});
    counts.innerHTML=Object.entries(summary).map(([k,v])=>`<b>${v.toLocaleString()}</b> ${esc(k)}`).join(' · ');
    grid.innerHTML=visible.map((x,i)=>{const idx=start+i;return `<article class="training-item" data-i="${idx}"><img src="${x.url}" alt="${esc(x.name)}"><div class="training-item-main"><b>${esc(x.name)}</b><span>${esc(x.path||'')}</span><select class="bulk-label" data-i="${idx}"><option value="">Choose classification…</option>${labels.map(l=>`<option ${x.proposedLabel===l?'selected':''}>${esc(l)}</option>`).join('')}</select><label><input type="checkbox" class="bulk-verify" data-i="${idx}"> Verified training data</label></div></article>`}).join('');
  }

  function importFiles(files){
    queue.forEach(x=>URL.revokeObjectURL(x.url));
    queue=Array.from(files).filter(f=>f.type.startsWith('image/')).map((f,i)=>({file:f,name:f.name,path:f.webkitRelativePath||f.name,url:URL.createObjectURL(f),proposedLabel:proposedLabel(f.webkitRelativePath||f.name),i}));
    page=0;render();
  }

  function addRecords(items){
    const data=read(),now=new Date().toISOString();let added=0;
    items.forEach(({x,label})=>{if(!x||!label)return;data.push({id:'BULK-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),source:'hard-drive-bulk-import',originalFileName:x.name,sourcePath:x.path,label,verifiedAt:now});added++});
    if(added){try{write(data)}catch{alert('Training dataset storage is full. No original files were changed.');return 0}}
    return added;
  }

  function verifyVisible(){
    const items=[];document.querySelectorAll('.bulk-verify:checked').forEach(cb=>{const i=Number(cb.dataset.i),label=document.querySelector(`.bulk-label[data-i="${i}"]`)?.value,x=queue[i];if(x&&label)items.push({x,label});});
    const added=addRecords(items);if(added)alert(`${added} image${added===1?'':'s'} added to the separate training dataset.`);render();
  }

  function verifyAllProposed(){
    const items=queue.filter(x=>x.proposedLabel).map(x=>({x,label:x.proposedLabel}));
    if(!items.length){alert('No folder-based classifications were found. Choose a classified folder or classify the images manually.');return}
    const ok=confirm(`Verify ${items.length.toLocaleString()} images using their folder-based proposed classifications?\n\nThis is a human confirmation step. The original hard-drive files will not be changed.`);
    if(!ok)return;
    const added=addRecords(items);if(added)alert(`${added.toLocaleString()} verified training records added.`);render();
  }

  function boot(){
    makePanel();
    document.getElementById('bulkTrainingFiles')?.addEventListener('change',e=>importFiles(e.target.files));
    document.getElementById('bulkVerifyVisible')?.addEventListener('click',verifyVisible);
    document.getElementById('bulkVerifyProposed')?.addEventListener('click',verifyAllProposed);
    document.getElementById('bulkNextBatch')?.addEventListener('click',()=>{page++;render();window.scrollTo({top:document.getElementById('bulkTrainingPanel')?.offsetTop||0,behavior:'smooth'})});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
