// Conservative review assist for difficult/unfamiliar rat images.
// Never auto-accepts a Rat; human review remains required.
(function(){
  'use strict';
  let attached=false;
  function pct(text){const m=String(text||'').match(/([0-9]+(?:\.[0-9]+)?)\s*%/);return m?Number(m[1]):NaN}
  function update(box){
    const header=box&&box.querySelector('div:first-child b');
    if(!header||!/Uncertain/i.test(header.textContent||''))return;
    const scores={};
    for(const row of Array.from(box.querySelectorAll('div')).slice(1)){
      const b=row.querySelector('b'),s=row.querySelector('span');
      if(!b||!s)continue;
      const label=(b.textContent||'').replace(/^\s*\d+\.\s*/,'').trim(),value=pct(s.textContent);
      if(label&&Number.isFinite(value))scores[label]=value;
    }
    const other=scores.Other,rat=scores.Rat,possum=scores.Possum;
    if(Number.isFinite(other)&&Number.isFinite(rat)&&Number.isFinite(possum)&&other>=rat&&rat>=30&&possum<=10&&(other-rat)<=20){
      header.textContent='AI decision: Likely Rat — human review required';
      if(!box.querySelector('[data-rat-assist]')){
        const note=document.createElement('div');note.dataset.ratAssist='1';note.className='muted';note.style.marginTop='8px';
        note.textContent='Rat review assist: Rat has meaningful support while Possum is very low. Human review is still required.';
        box.appendChild(note);
      }
    }
  }
  function attach(){
    if(attached)return true;
    const box=document.getElementById('aiTestResult');if(!box)return false;
    attached=true;new MutationObserver(()=>update(box)).observe(box,{childList:true,subtree:true,characterData:true});update(box);return true;
  }
  function boot(){if(attach())return;const o=new MutationObserver(()=>{if(attach())o.disconnect()});o.observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
