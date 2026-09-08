(function(){
  const TRAINING_LABELS=['Empty / no animal','Possum','Rat','Stoat','Cat','Deer','Bird','Other animal','Human','Unclear'];
  function getImages(){try{const x=JSON.parse(localStorage.getItem('kaitiaki-camera-images-v2'));return Array.isArray(x)?x:[]}catch{return[]}}
  function getCameras(){try{const x=JSON.parse(localStorage.getItem('kaitiaki-camera-cameras-v2'));return Array.isArray(x)?x:[]}catch{return[]}}
  function addPanel(){
    if(document.getElementById('aiPrepPanel')) return;
    const review=document.getElementById('review');
    if(!review) return;
    const card=document.createElement('div'); card.id='aiPrepPanel'; card.className='card'; card.style.marginTop='14px';
    card.innerHTML='<h3>🤖 AI preparation</h3><div id="aiPrepText" class="small" style="line-height:1.5">AI will be added as an assistive layer after we build a labelled dataset from your real camera images. Your manual review remains the ground truth.</div><div id="aiPrepStats" class="summary-grid" style="margin-top:10px"></div>';
    review.appendChild(card); update();
  }
  function update(){
    const el=document.getElementById('aiPrepStats'); if(!el) return;
    const imgs=getImages(), done=imgs.filter(x=>x && x.result!=null), counts={}; TRAINING_LABELS.forEach(l=>counts[l]=0); done.forEach(x=>{if(Object.prototype.hasOwnProperty.call(counts,x.result)) counts[x.result]++});
    el.innerHTML=TRAINING_LABELS.map(l=>'<div class="summary-box"><b>'+counts[l]+'</b><span>'+l+'</span></div>').join('');
  }
  function boot(){addPanel();update();}
  document.addEventListener('click',function(e){if(e.target.closest('[data-go="review"]')) setTimeout(boot,50)});
  window.addEventListener('storage',update); setTimeout(boot,300);
})();
