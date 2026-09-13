// Kaitiaki Camera AI — external Rat source-diversity helper
// Loaded only when referenced by the trainer. Safe to keep standalone until integrated.
(function(){
  'use strict';

  function sourceName(root, existing){
    const base=(root?.name||'External Rat').trim()||'External Rat';
    const used=new Set((existing||[]).map(s=>s.name));
    if(!used.has(base))return base;
    let i=2;
    while(used.has(base+' '+i))i++;
    return base+' '+i;
  }

  function addSource(dataset, root, entries, skippedBenchmark){
    const sources=Array.isArray(dataset?.sources)?dataset.sources.slice():[];
    const name=sourceName(root,sources);
    sources.push({
      id:'rat-source-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
      name,
      root,
      entries:(entries||[]).map(e=>({...e,source:'external-rat',sourceName:name})),
      skippedBenchmark:skippedBenchmark||0,
      addedAt:new Date().toISOString()
    });
    return {sources,builtAt:new Date().toISOString()};
  }

  function flatten(dataset){
    return (dataset?.sources||[]).flatMap(s=>(s.entries||[]));
  }

  function counts(dataset){
    return (dataset?.sources||[]).map(s=>({name:s.name,count:(s.entries||[]).length}));
  }

  function chooseHeldOutSource(dataset){
    const sources=(dataset?.sources||[]).filter(s=>(s.entries||[]).length>=5);
    if(sources.length<2)return null;
    // Deterministic: hold out the smallest source, tie-break by source name.
    return sources.slice().sort((a,b)=>((a.entries?.length||0)-(b.entries?.length||0))||String(a.name).localeCompare(String(b.name)))[0];
  }

  window.KaitiakiRatSourceDiversity={addSource,flatten,counts,chooseHeldOutSource};
})();
