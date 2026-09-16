// Kaitiaki Camera AI v2 — field-camera classifier
// Clean v2 foundation. Does not replace or modify the existing v1 model.
(function(){
  'use strict';

  const VERSION=1;
  const CLASSES=['Possum','Rat','Other'];
  const MODEL_KEY='indexeddb://kaitiaki-camera-ai-field-v2';
  const IMAGE_EXTENSIONS=/\.(jpe?g|png|gif|webp|bmp|avif|jfif|tif|tiff)$/i;

  const state={
    sources:[],
    entries:[],
    split:null,
    model:null,
    metadata:null
  };

  const normalise=s=>String(s||'').replace(/\\/g,'/');
  const imageFile=name=>IMAGE_EXTENSIONS.test(String(name||''));

  function classFromPath(path){
    const text=normalise(path).toLowerCase();
    if(/possum|brush.?tail|trichosurus/.test(text))return'Possum';
    if(/rat|kiore|rattus/.test(text))return'Rat';
    if(/other|empty|blank|no.?animal|non.?target|map|screenshot|irrelevant/.test(text))return'Other';
    return'';
  }

  // Keep related burst/sequence images together so they cannot leak across
  // training, validation and field-test sets.
  function sequenceStem(name){
    return String(name||'')
      .replace(/\.[^.]+$/,'')
      .replace(/(?:[_ -]?(?:img|image|pic|dsc))?[_ -]?\d{1,6}$/i,'')
      .replace(/[_ -]+$/,'') || String(name||'').replace(/\.[^.]+$/,'');
  }

  function groupKey(entry){
    const path=normalise(entry.path||entry.name);
    const parts=path.split('/').filter(Boolean);
    const file=parts.pop()||entry.name||'';
    const folder=parts.join('/');
    return [entry.sourceId||'source',folder,sequenceStem(file)].join('|');
  }

  function hash32(text){
    let h=2166136261;
    for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
    return h>>>0;
  }

  function buildFieldSplit(entries){
    const usable=entries.filter(e=>CLASSES.includes(e.label)&&e.handle&&!e.benchmarkOnly);
    const byClass=new Map(CLASSES.map(c=>[c,new Map()]));
    for(const e of usable){
      const groups=byClass.get(e.label),key=groupKey(e);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(e);
    }

    const train=[],validation=[],fieldTest=[],report={};
    for(const label of CLASSES){
      const groups=[...byClass.get(label).entries()]
        .sort((a,b)=>hash32(a[0])-hash32(b[0]));
      if(groups.length<3){
        // Do not pretend a tiny source set provides independent field testing.
        for(const [,items] of groups)train.push(...items);
        report[label]={groups:groups.length,trainGroups:groups.length,validationGroups:0,fieldTestGroups:0};
        continue;
      }
      const testN=Math.max(1,Math.floor(groups.length*0.15));
      const valN=Math.max(1,Math.floor(groups.length*0.10));
      const testGroups=groups.slice(0,testN);
      const valGroups=groups.slice(testN,testN+valN);
      const trainGroups=groups.slice(testN+valN);
      for(const [,items] of testGroups)fieldTest.push(...items);
      for(const [,items] of valGroups)validation.push(...items);
      for(const [,items] of trainGroups)train.push(...items);
      report[label]={groups:groups.length,trainGroups:trainGroups.length,validationGroups:valGroups.length,fieldTestGroups:testGroups.length};
    }
    return{train,validation,fieldTest,report,builtAt:new Date().toISOString()};
  }

  async function scanFolder(root,label){
    if(!CLASSES.includes(label))throw new Error('AI v2 accepts Possum, Rat or Other only.');
    const sourceId='src-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const entries=[];
    async function walk(dir,parts){
      for await(const [name,handle] of dir.entries()){
        if(handle.kind==='directory')await walk(handle,parts.concat(name));
        else if(imageFile(name)){
          const path=parts.concat(name).join('/');
          entries.push({name,path,label,handle,sourceId,sourceName:root.name,benchmarkOnly:false});
        }
      }
    }
    await walk(root,[root.name]);
    state.sources.push({id:sourceId,name:root.name,label,count:entries.length,root});
    state.entries.push(...entries);
    state.split=buildFieldSplit(state.entries);
    return{source:state.sources.at(-1),split:state.split};
  }

  async function chooseFieldFolder(label){
    if(!window.showDirectoryPicker)throw new Error('Use Microsoft Edge with folder access enabled.');
    const root=await window.showDirectoryPicker({mode:'read'});
    try{await root.requestPermission({mode:'read'})}catch{}
    return scanFolder(root,label);
  }

  function summary(){
    const counts=Object.fromEntries(CLASSES.map(c=>[c,state.entries.filter(e=>e.label===c).length]));
    const split=state.split||buildFieldSplit(state.entries);
    return{
      version:VERSION,
      classes:CLASSES.slice(),
      modelKey:MODEL_KEY,
      sources:state.sources.map(({id,name,label,count})=>({id,name,label,count})),
      counts,
      split:{train:split.train.length,validation:split.validation.length,fieldTest:split.fieldTest.length,groups:split.report}
    };
  }

  // Public v2 API for the new training UI. v1 globals/model are untouched.
  window.KaitiakiFieldAIv2={
    VERSION,CLASSES,MODEL_KEY,state,
    chooseFieldFolder,
    scanFolder,
    buildFieldSplit,
    classFromPath,
    groupKey,
    summary
  };
})();
