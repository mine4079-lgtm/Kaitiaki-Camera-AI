(function(){
  'use strict';
  const IMAGE_KEY='kaitiaki-camera-images-v2';
  const CAMERA_KEY='kaitiaki-camera-cameras-v2';
  const TRAINING_KEY='kaitiaki-camera-training-v1';
  const LABELS=['Empty / no animal','Possum','Rat','Stoat','Cat','Deer','Bird','Other animal','Human','Unclear'];

  function load(key,fallback){try{const x=JSON.parse(localStorage.getItem(key));return Array.isArray(x)?x:fallback}catch{return fallback}}
  function save(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function images(){return load(IMAGE_KEY,[])}
  function cameras(){return load(CAMERA_KEY,[])}
  function training(){return load(TRAINING_KEY,[])}
  function esc(s){return String(s??'').replace(/[&<>'\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[m]))}
  function cameraName(id){const c=cameras().find(x=>x.id===id);return c?c.name:id||'Unknown camera'}

  function addNav(){
    const nav=document.querySelector('.bottom-nav');
    if(!nav||document.getElementById('aiPrepNav'))return;
    const b=document.createElement('button');b.className='nav-btn';b.id='aiPrepNav';b.dataset.go='ai-prep';b.innerHTML='<strong>🤖</strong>AI Prep';nav.appendChild(b);
  }

  function addView(){
    if(document.getElementById('ai-prep'))return;
    const main=document.querySelector('main');if(!main)return;
    const s=document.createElement('section');s.id='ai-prep';s.className='view';
    s.innerHTML='<div class="eyebrow">Phase 2</div><h1 class="page-title">AI preparation</h1><div class="sub">Build the training dataset from human-reviewed camera images. No AI is making decisions yet.</div><div class="notice"><b>Human reviewer stays in control.</b> Only images you deliberately add here become training data. Ordinary monitoring records remain separate.</div><div class="stats"><div class="stat"><b id="aiReviewed">0</b><span>REVIEWED IMAGES</span></div><div class="stat"><b id="aiTraining">0</b><span>TRAINING IMAGES</span></div><div class="stat"><b id="aiPossum">0</b><span>POSSUM</span></div></div><div class="card"><h2>Training dataset</h2><p class="small">Select only images you are confident are correctly classified. You can remove an image from the training dataset at any time.</p><div id="trainingList"></div></div></section>';
    main.appendChild(s);
  }

  function render(){
    const list=document.getElementById('trainingList');if(!list)return;
    const imgs=images(), reviewed=imgs.filter(x=>x&&x.result!=null), tr=training();
    const ids=new Set(tr.map(x=>x.imageId));
    const a=document.getElementById('aiReviewed'),b=document.getElementById('aiTraining'),p=document.getElementById('aiPossum');
    if(a)a.textContent=reviewed.length;if(b)b.textContent=tr.length;if(p)p.textContent=tr.filter(x=>x.label==='Possum').length;
    if(!reviewed.length){list.innerHTML='<div class="empty"><h3>No reviewed images yet</h3><p class="muted">Review your camera images first. Then come here to choose the correctly classified images for training.</p></div>';return}
    list.innerHTML=reviewed.map(x=>{
      const on=ids.has(x.id), label=esc(x.result), name=esc(cameraName(x.cameraId));
      return '<div class="card image-item"><img class="thumb" src="'+x.src+'" alt="Reviewed camera image"><div class="image-main"><h3>'+name+'</h3><p><b>'+label+'</b> · '+new Date(x.created).toLocaleString('en-NZ')+'</p><p class="small">Human review: '+(x.reviewedAt?new Date(x.reviewedAt).toLocaleString('en-NZ'):'recorded')+'</p><div class="item-actions"><button class="btn '+(on?'secondary':'')+'" data-training="'+esc(x.id)+'">'+(on?'✓ In training dataset':'Add to training dataset')+'</button></div></div></div>';
    }).join('');
    list.querySelectorAll('[data-training]').forEach(btn=>btn.onclick=()=>toggle(btn.dataset.training));
  }

  function toggle(imageId){
    const imgs=images(),x=imgs.find(i=>i.id===imageId);if(!x||x.result==null)return;
    let tr=training();const existing=tr.findIndex(t=>t.imageId===imageId);
    if(existing>=0){tr.splice(existing,1)}else{tr.unshift({imageId:x.id,label:x.result,src:x.src,cameraId:x.cameraId,created:x.created,reviewedAt:x.reviewedAt,addedAt:new Date().toISOString()})}
    save(TRAINING_KEY,tr);render();
  }

  function boot(){addNav();addView();render();}
  document.addEventListener('click',e=>{const go=e.target.closest('[data-go="ai-prep"]');if(go){setTimeout(()=>{document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='ai-prep'));document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.go==='ai-prep'));window.scrollTo({top:0,behavior:'instant'});render()},20)}});
  window.addEventListener('storage',render);
  setTimeout(boot,100);
  setInterval(render,1500);
})();
