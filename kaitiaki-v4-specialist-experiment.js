/* Experimental Possum/Rat/Weka specialist for Kaitiaki V4.
   Uses only human-verified matched images. Saves under a separate model key and never changes production V4. */
const CLASSES=['Possum','Rat','Weka'];
const MODEL_KEY='indexeddb://kaitiaki-v4-prw-specialist-experiment-v1';
function hash32(t){let h=2166136261;for(const ch of String(t)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function groupKey(item){
  const n=String(item?.row?.file_name||item?.row?.relative_path||item?.key||'').toLowerCase();
  const m=n.match(/^([^~]+)~(\d{4}-\d{2}-\d{2}t\d{2}-\d{2})/);
  return m?m[1]+'|'+m[2]:n.replace(/~\d+~\d+\.[^.]+$/,'');
}
async function loadLibs(){
  if(!window.tf)await new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';s.onload=ok;s.onerror=()=>no(Error('Could not load TensorFlow.js'));document.head.appendChild(s)});
  if(!window.mobilenet)await new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';s.onload=ok;s.onerror=()=>no(Error('Could not load MobileNet'));document.head.appendChild(s)});
  for(const b of ['webgl','cpu']){try{if(await tf.setBackend(b))break}catch{}}
  await tf.ready();
  return mobilenet.load({version:2,alpha:.5,inputResolution:160});
}
function deterministicSplit(items){
  const train=[],validation=[],test=[],report={};
  for(const label of CLASSES){
    const groups=new Map();
    for(const item of items.filter(x=>x.label===label)){const k=groupKey(item);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item)}
    const ordered=[...groups.entries()].sort((a,b)=>hash32(a[0])-hash32(b[0]));
    report[label]={groups:ordered.length,trainGroups:0,validationGroups:0,testGroups:0};
    if(ordered.length<3)throw Error('Need at least 3 independent '+label+' groups for train, validation and test; found '+ordered.length+'.');
    const valCount=Math.max(1,Math.floor(ordered.length*.15)),testCount=Math.max(1,Math.floor(ordered.length*.15));
    const testGroups=ordered.slice(0,testCount),valGroups=ordered.slice(testCount,testCount+valCount),trainGroups=ordered.slice(testCount+valCount);
    for(const [,rows] of testGroups)test.push(...rows);
    for(const [,rows] of valGroups)validation.push(...rows);
    for(const [,rows] of trainGroups)train.push(...rows);
    report[label].testGroups=testGroups.length;report[label].validationGroups=valGroups.length;report[label].trainGroups=trainGroups.length;
  }
  return{train,validation,test,report,groups:Object.values(report).reduce((n,x)=>n+x.groups,0)};
}
function balanced(items,cap){
  const out=[];
  for(const label of CLASSES){
    const rows=items.filter(x=>x.label===label).sort((a,b)=>hash32(a.key)-hash32(b.key));
    out.push(...rows.slice(0,Math.min(cap,rows.length)));
  }
  return out;
}
async function feature(net,item){
  const file=await item.file.getFile(),bmp=await createImageBitmap(file,{resizeWidth:160,resizeHeight:160,resizeQuality:'low'});
  try{return tf.tidy(()=>{const p=tf.browser.fromPixels(bmp).toFloat(),v=net.infer(tf.expandDims(p,0),true),f=v.rank===4?tf.mean(v,[1,2]):v;return new Float32Array(f.dataSync())})}finally{bmp.close?.()}
}
async function matrix(net,items,onProgress,phase){
  const xs=[],ys=[],kept=[];
  for(let i=0;i<items.length;i++){
    try{xs.push(await feature(net,items[i]));ys.push(CLASSES.indexOf(items[i].label));kept.push(items[i])}catch{}
    if(i%8===0||i===items.length-1){onProgress?.({phase,current:i+1,total:items.length});await new Promise(r=>setTimeout(r,0))}
  }
  if(!xs.length)throw Error('No readable images in '+phase);
  const size=xs[0].length,flat=new Float32Array(xs.length*size);xs.forEach((v,i)=>flat.set(v,i*size));
  return{x:tf.tensor2d(flat,[xs.length,size]),y:tf.tensor1d(ys,'int32'),items:kept,size};
}
function counts(items){return Object.fromEntries(CLASSES.map(c=>[c,items.filter(x=>x.label===c).length]))}
async function evaluate(net,model,items,onProgress,phase){
  const confusion=Object.fromEntries(CLASSES.map(a=>[a,Object.fromEntries(CLASSES.map(b=>[b,0]))])),rows=[];
  for(let i=0;i<items.length;i++){
    const item=items[i];try{const v=await feature(net,item);const scores=tf.tidy(()=>Array.from(model.predict(tf.tensor2d(v,[1,v.length])).dataSync()));const pi=scores.indexOf(Math.max(...scores)),predicted=CLASSES[pi];confusion[item.label][predicted]++;rows.push({actual:item.label,predicted,confidence:scores[pi],key:item.key})}catch{}
    if(i%8===0||i===items.length-1){onProgress?.({phase,current:i+1,total:items.length});await new Promise(r=>setTimeout(r,0))}
  }
  const correct=rows.filter(r=>r.actual===r.predicted).length;
  return{total:rows.length,correct,accuracy:rows.length?correct/rows.length:null,confusion,rows};
}
export async function runSpecialistExperiment({resolved,holdoutResolved=[],onProgress}){
  const source=resolved.map(x=>({...x,label:String(x.row?.confirmed_label||x.row?.label||'').trim()})).filter(x=>CLASSES.includes(x.label));
  const available=counts(source),min=Math.min(...CLASSES.map(c=>available[c]||0));
  if(min<20)throw Error('Need at least 20 verified images each for Possum, Rat and Weka.');
  const selected=balanced(source,min),split=deterministicSplit(selected);
  for(const part of ['train','validation','test'])for(const c of CLASSES)if(!split[part].some(x=>x.label===c))throw Error('Not enough independent '+c+' groups for '+part+' split.');
  const net=await loadLibs(),tr=await matrix(net,split.train,onProgress,'features-train'),va=await matrix(net,split.validation,onProgress,'features-validation');
  const model=tf.sequential();model.add(tf.layers.dense({inputShape:[tr.size],units:64,activation:'relu'}));model.add(tf.layers.dropout({rate:.25}));model.add(tf.layers.dense({units:CLASSES.length,activation:'softmax'}));model.compile({optimizer:tf.train.adam(.001),loss:'sparseCategoricalCrossentropy',metrics:['accuracy']});
  await model.fit(tr.x,tr.y,{epochs:14,batchSize:16,shuffle:true,validationData:[va.x,va.y],callbacks:{onEpochEnd:async(epoch,logs)=>onProgress?.({phase:'training',epoch:epoch+1,total:14,logs})}});
  tr.x.dispose();tr.y.dispose();va.x.dispose();va.y.dispose();
  const internal=await evaluate(net,model,split.test,onProgress,'internal-test');
  const holdoutItems=holdoutResolved.map(x=>({...x,label:String(x.row?.confirmed_label||x.row?.label||'Possum').trim()})).filter(x=>CLASSES.includes(x.label));
  const heldout=holdoutItems.length?await evaluate(net,model,holdoutItems,onProgress,'heldout-test'):{total:0,correct:0,accuracy:null,confusion:{},rows:[]};
  await model.save(MODEL_KEY);
  const meta={createdAt:new Date().toISOString(),classes:CLASSES,productionModelUntouched:true,available,balancedPerClass:min,selected:counts(selected),split:{train:counts(split.train),validation:counts(split.validation),test:counts(split.test),groups:split.report},internal:{total:internal.total,correct:internal.correct,accuracy:internal.accuracy,confusion:internal.confusion},heldout:{total:heldout.total,correct:heldout.correct,accuracy:heldout.accuracy,confusion:heldout.confusion},modelKey:MODEL_KEY};
  localStorage.setItem('kaitiaki-v4-prw-specialist-experiment-v1-meta',JSON.stringify(meta));
  return meta;
}
export const SPECIALIST_MODEL_KEY=MODEL_KEY;
