// Conservative review assist for difficult/unfamiliar rat images.
// This never auto-accepts a Rat classification; it only upgrades an uncertain
// review result to "Likely Rat — human review required" when Possum is very low.
(function(){
  'use strict';
  function parsePercent(text){
    const m=String(text||'').match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
    return m?Number(m[1]):NaN;
  }
  function update(box){
    if(!box)return;
    const header=box.querySelector('div:first-child b');
    if(!header||!/Uncertain/i.test(header.textContent||''))return;
    const rows=Array.from(box.querySelectorAll('div')).slice(1);
    const scores={};
    for(const row of rows){
      const b=row.querySelector('b'),span=row.querySelector('span');
      if(!b||!span)continue;
      const label=(b.textContent||'').replace(/^\s*\d+\.\s*/,'').trim();
      const p=parsePercent(span.textContent);
      if(label&&Number.isFinite(p))scores[label]=p;
    }
    const other=scores.Other,rat=scores.Rat,possum=scores.Possum;
    // Conservative rescue: only surface Rat when the classifier already gives it
    // meaningful support and the dangerous Possum confusion is very low.
    if(Number.isFinite(other)&&Number.isFinite(rat)&&Number.isFinite(possum)&&
       other>=rat&&rat>=30&&possum<=10&&(other-rat)<=20){
      header.textContent='AI decision: Likely Rat — human review required';
      let note=box.querySelector('[data-rat-review-assist]');
      if(!note){
        note=document.createElement('div');
        note.dataset.ratReviewAssist='1';
        note.className='muted';
        note.style.marginTop='8px';
        box.appendChild(note);
      }
      note.textContent='Rat review assist: Rat has meaningful support while Possum is very low. Keep human review; this is not an automatic Rat acceptance.';
    }
  }
  function boot(){
    const box=document.getElementById('aiTestResult');
    if(!box)return;
    const observer=new MutationObserver(()=>update(box));
    observer.observe(box,{childList:true,subtree:true,characterData:true});
    update(box);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
