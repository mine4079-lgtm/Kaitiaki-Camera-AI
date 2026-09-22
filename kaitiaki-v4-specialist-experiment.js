/* Experimental Possum/Rat/Weka specialist for Kaitiaki V4.
   Uses only human-verified matched images. Saves under a separate model key and never changes production V4. */
const CLASSES=['Possum','Rat','Weka'];
const MODEL_KEY='indexeddb://kaitiaki-v4-prw-specialist-experiment-v1';
function hash32(t){let h=2166136261;for(const ch of String(t)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function cameraHourKey(item){
  const n=String(item?.row?.file_name||item?.row?.relative_path||item?.key||'').toLowerCase().split('/').pop();
  const m=n.match(/^([^~]+)~(\d{4}-\d{2}-\d{2})t(\d{2})[-:]/);
  return m?m[1]+'|'+m[2]+'|'+m[3]:null;
}
function holdoutWithoutSharedHours(holdout,training){
  const hours=new Set(training.map(cameraHourKey).filter(Boolean));
  const independent=[],shared=[];
  for(const item of holdout){const hour=cameraHourKey(item);(hour&&hours.has(hour)?shared:independent).push(item)}
  return {independent,shared};
}
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
  return{x:tf.tensor2d(flat,[xs.length,size]),y:tf.tensor2d(ys.map(i=>CLASSES.map((_,j)=>i===j?1:0)).flat(),[ys.length,CLASSES.length],'float32'),items:kept,size};
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
  const model=tf.sequential();model.add(tf.layers.dense({inputShape:[tr.size],units:64,activation:'relu'}));model.add(tf.layers.dropout({rate:.25}));model.add(tf.layers.dense({units:CLASSES.length,activation:'softmax'}));model.compile({optimizer:tf.train.adam(.001),loss:'categoricalCrossentropy',metrics:['accuracy']});
  await model.fit(tr.x,tr.y,{epochs:14,batchSize:16,shuffle:true,validationData:[va.x,va.y],callbacks:{onEpochEnd:async(epoch,logs)=>onProgress?.({phase:'training',epoch:epoch+1,total:14,logs})}});
  tr.x.dispose();tr.y.dispose();va.x.dispose();va.y.dispose();
  const internal=await evaluate(net,model,split.test,onProgress,'internal-test');
  const allHoldout=holdoutResolved.map(x=>({...x,label:String(x.row?.confirmed_label||x.row?.label||'').trim()})).filter(x=>CLASSES.includes(x.label));
  const safeHoldout=holdoutWithoutSharedHours(allHoldout,selected);
  const holdoutItems=safeHoldout.independent;
  const heldout=holdoutItems.length?await evaluate(net,model,holdoutItems,onProgress,'heldout-test'):{total:0,correct:0,accuracy:null,confusion:{},rows:[]};
  await model.save(MODEL_KEY);
  const meta={createdAt:new Date().toISOString(),classes:CLASSES,productionModelUntouched:true,available,balancedPerClass:min,selected:counts(selected),split:{train:counts(split.train),validation:counts(split.validation),test:counts(split.test),groups:split.report},internal:{total:internal.total,correct:internal.correct,accuracy:internal.accuracy,confusion:internal.confusion},heldout:{total:heldout.total,correct:heldout.correct,accuracy:heldout.accuracy,confusion:heldout.confusion,excludedSharedCameraHour:safeHoldout.shared.length},modelKey:MODEL_KEY};
  localStorage.setItem('kaitiaki-v4-prw-specialist-experiment-v1-meta',JSON.stringify(meta));
  return meta;
}
/* Re-evaluate an EXISTING saved specialist without retraining. Only three human-confirmed
   species are scored; other classes are excluded explicitly. Original V4 suggestions
   are shown as descriptive comparison, not V4 auto-accept decisions. */
export async function compareSavedSpecialist({holdoutResolved=[],trainingResolved=[],onProgress}={}){
  if(!holdoutResolved.length)throw Error('Reconnect the HDD and supply your held-out evaluation CSV first.');
  const items=holdoutResolved.map(x=>({...x,label:String(x.row?.confirmed_label||x.row?.label||'').trim()}));
  const includedAll=items.filter(x=>CLASSES.includes(x.label));
  const safe=holdoutWithoutSharedHours(includedAll,trainingResolved);
  const included=safe.independent;
  if(!included.length)throw Error('No human-confirmed Possum, Rat or Weka examples found in held-out CSV.');
  const net=await loadLibs();
  let model;
  try{model=await tf.loadLayersModel(MODEL_KEY)}
  catch{throw Error('No saved specialist experiment found in this Edge browser. Do not clear site data.')}
  const result=await evaluate(net,model,included,onProgress,'saved-specialist-test');
  const rowByKey=new Map(included.map(x=>[x.key,x.row]));
  const details=result.rows.map(x=>{
    const row=rowByKey.get(x.key)||{};
    const baseline=String(row.ai_prediction||'').trim();
    const raw=String(row.ai_confidence||row.confidence||'').trim();
    const baselineConfidence=raw===''?null:Number(raw);
    return {...x,baselinePrediction:baseline,baselineConfidence:Number.isFinite(baselineConfidence)?baselineConfidence:null,
      baselineMatchesHuman:baseline?baseline===x.actual:null,specialistMatchesHuman:x.predicted===x.actual};
  });
  return { ...result, details, excluded:items.length-includedAll.length,excludedSharedCameraHour:safe.shared.length,
    missing:holdoutResolved.length-items.length,
    baselineComparable:details.filter(x=>x.baselinePrediction).length,
    baselineTopLabelCorrect:details.filter(x=>x.baselineMatchesHuman===true).length,
    note:'Baseline is original AI top suggestion, NOT the automatic decision after threshold/margin review.'};
}
/* Diagnostic ONLY: a 3-class softmax must choose Possum, Rat or Weka even for
   genuine Other/Deer/Stoat/etc. This measures that risk on personally verified
   negative controls. It does not estimate a field false-positive rate. */
export async function probeSavedSpecialistNonTargets({resolved=[],independentResolved=[],trainingResolved=[],onProgress}={}){
  const source=[...resolved,...independentResolved];
  const seen=new Set(),negative=[];
  for(const item of source){
    const row=item.row||{},label=String(row.confirmed_label??row.label??'').trim();
    const verified=String(row.human_verified??'Yes').trim().toLowerCase();
    if(!label||CLASSES.includes(label)||verified==='no'||verified==='false'||!item.file)continue;
    const path=String(item.matchedPath||item.key||'').toLowerCase();
    if(!path||seen.has(path))continue;
    seen.add(path);
    negative.push({...item,label});
  }
  const safe=holdoutWithoutSharedHours(negative,trainingResolved.filter(x=>CLASSES.includes(String(x.row?.confirmed_label??x.row?.label??'').trim())));
  if(!safe.independent.length)throw Error('No independently verified non-target images are available after session exclusions.');
  const net=await loadLibs();
  let model;
  try{model=await tf.loadLayersModel(MODEL_KEY)}
  catch{throw Error('Saved specialist not found in Edge; this probe does not retrain.')}
  const details=[],skipped=[];
  for(let i=0;i<safe.independent.length;i++){
    const item=safe.independent[i];
    try{
      const v=await feature(net,item);
      const scores=tf.tidy(()=>Array.from(model.predict(tf.tensor2d(v,[1,v.length])).dataSync()));
      const ix=scores.indexOf(Math.max(...scores));
      details.push({key:item.key,actual:item.label,predicted:CLASSES[ix],confidence:scores[ix]});
    }catch(e){skipped.push({key:item.key,error:String(e?.message||e)})}
    if(i%4===0||i===safe.independent.length-1){onProgress?.({phase:'negative-probe',current:i+1,total:safe.independent.length});await new Promise(r=>setTimeout(r,0))}
  }
  const counts=Object.fromEntries(CLASSES.map(label=>[label,details.filter(x=>x.predicted===label).length]));
  return {total:details.length,counts,highConfidence:details.filter(x=>x.confidence>=.9).length,
    excludedSharedCameraHour:safe.shared.length,skipped,details,
    warning:'Every 3-class specialist prediction on a non-target is necessarily a wrong species; confidence is NOT rejection or field reliability.'};
}
export const SPECIALIST_MODEL_KEY=MODEL_KEY;
