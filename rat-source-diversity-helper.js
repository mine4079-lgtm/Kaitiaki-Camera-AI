// Kaitiaki Camera AI — source-diverse Rat split helper
(function(){
  'use strict';

  function groupKey(entry){
    const parts=String(entry?.path||'').replace(/\\/g,'/').split('/').filter(Boolean);
    return parts.length>2?parts[1]:(parts[0]||'External Rat');
  }

  function prepare(){
    const ds=window.kaitiakiExternalRatDataset;
    if(!ds?.entries?.length)return null;
    const groups={};
    ds.entries.forEach(e=>(groups[groupKey(e)]??=[]).push(e));
    const usable=Object.entries(groups).filter(([,rows])=>rows.length>=20);
    if(usable.length<2)return null;
    usable.sort((a,b)=>a[1].length-b[1].length||a[0].localeCompare(b[0]));
    const [holdName,holdRows]=usable[0];
    const holdSet=new Set(holdRows);
    const training=ds.entries.filter(e=>!holdSet.has(e));
    window.kaitiakiRatSourceHoldout={name:holdName,entries:holdRows,total:holdRows.length,preparedAt:new Date().toISOString()};
    window.kaitiakiExternalRatDataset={...ds,entries:training,sourceHoldoutName:holdName,sourceHoldoutImages:holdRows.length};
    return {holdName,holdRows,training};
  }

  function show(result){
    let el=document.getElementById('ratSourceDiversityStatus');
    const counts=document.getElementById('bulkTrainingCounts');
    if(!el&&counts){el=document.createElement('div');el.id='ratSourceDiversityStatus';el.className='muted';el.style.margin='6px 0';counts.insertAdjacentElement('afterend',el)}
    if(!el)return;
    el.textContent=result?'Source-diverse Rat split ready · held out entire folder group: '+result.holdName+' ('+result.holdRows.length.toLocaleString()+' images) · '+result.training.length.toLocaleString()+' external Rat images remain available for training':'Source-diverse Rat split: needs at least 2 Rat subfolders with 20+ images each.';
  }

  function boot(){
    const train=document.getElementById('trainAiModel');
    if(train)train.addEventListener('click',()=>show(prepare()),true);
    show(null);
  }

  window.KaitiakiRatSourceSplit={prepare};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
