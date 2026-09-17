const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const trainer=fs.readFileSync(path.join(root,'ai-v2-field-classifier.js'),'utf8');
const page=fs.readFileSync(path.join(root,'training-v2.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const tensorsSource=trainer.replace('window.KaitiakiFieldAIv2={_wrapTrainingError:wrapTrainingError,VERSION,','window.KaitiakiFieldAIv2={_tensors:tensors,_features:features,_accuracy:accuracy,_imageDataError:imageDataError,_fitCallbacks:fitCallbacks,_wrapTrainingError:wrapTrainingError,VERSION,');
class MockCustomCallback{constructor(hooks){Object.assign(this,hooks)}setParams(params){this.params=params}}
const tf={
  tidy:fn=>fn(),
  tensor2d:(data,shape)=>({data,shape,dispose(){}}),
  tensor1d:(data)=>({data,dispose(){}}),
  oneHot:(idx,classes)=>({shape:[idx.data.length,classes],dispose(){}}),
  CustomCallback:MockCustomCallback,
  callbacks:{earlyStopping:()=>({setParams(params){this.params=params}})}
};
const sandbox={window:{},tf,setTimeout};
vm.createContext(sandbox);
vm.runInContext(tensorsSource,sandbox);
const input={xs:[new Float32Array([1,2]),new Float32Array([3,4])],ys:[0,4]};
const packed=sandbox.window.KaitiakiFieldAIv2._tensors(input);
assert.deepEqual(Array.from(packed.x.shape),[2,2]);
assert.deepEqual(Array.from(packed.x.data),[1,2,3,4]);
assert.deepEqual(Array.from(packed.y.shape),[2,5]);
assert.equal(packed.size,2);
assert.equal(packed.rows,2);
assert.equal(input.xs.length,0,'temporary feature vectors should be released after tensor creation');
assert.equal(input.ys.length,0,'temporary labels should be released after tensor creation');
assert.throws(()=>sandbox.window.KaitiakiFieldAIv2._tensors({xs:[],ys:[]}),/empty or has mismatched labels/);
assert.throws(()=>sandbox.window.KaitiakiFieldAIv2._tensors({xs:[new Float32Array([1]),new Float32Array([1,2])],ys:[0,1]}),/inconsistent shapes/);
const callbacks=sandbox.window.KaitiakiFieldAIv2._fitCallbacks(()=>{},14);
assert.equal(callbacks.length,2);
for(const callback of callbacks){assert.equal(typeof callback.setParams,'function','every TFJS callback must expose setParams');callback.setParams({epochs:14})}
assert.equal(typeof callbacks[1].onBatchEnd,'function');
const runtimeError=new Error('placeholder');
Object.defineProperty(runtimeError,'message',{get:()=> 'original model.fit failure'});
const wrapped=sandbox.window.KaitiakiFieldAIv2._wrapTrainingError(runtimeError,'Starting model.fit');
assert.equal(Object.prototype.toString.call(wrapped),'[object Error]');
assert.equal(wrapped.message,'Starting model.fit: original model.fit failure');
assert.equal(wrapped.cause,runtimeError,'original error and its stack should remain available as cause');
assert.equal(runtimeError.message,'original model.fit failure','original getter-only message must not be modified');
const pageVersion=page.match(/ai-v2-field-classifier\.js\?v=(\d+)/)?.[1];
const cacheVersion=worker.match(/ai-v2-field-classifier\.js\?v=(\d+)/)?.[1];
assert.ok(pageVersion,'V2 page should pin a classifier version');
assert.equal(cacheVersion,pageVersion,'service worker must precache the V2 page’s classifier version');
assert.match(worker,/kaitiaki-camera-v54/,'service worker cache should be invalidated for this release');
assert.match(trainer,/new tf\.CustomCallback\(\{onEpochBegin/,'custom progress hooks must use the TFJS 4.22 callback wrapper');
assert.match(trainer,/onBatchEnd:async/,'training should report progress during model.fit batches');
assert.match(trainer,/throw wrapTrainingError\(e,stage\)/,'training errors should be wrapped without mutating the original error');
assert.match(page,/p\.phase==='stage'/,'V2 UI should render exact setup stages');
assert.match(page,/visibilityState==='hidden'.*setTimeout/,'V2 should keep TensorFlow.js frame yields moving in a hidden tab');
assert.match(page,/SKIPPED UNREADABLE/,'Field Test Results should report skipped unreadable images');
assert.match(trainer,/fieldTestSkippedImages:field\.skipped/,'field test skipped-image count should be saved in model metadata');
assert.ok(trainer.indexOf('await model.save(MODEL_KEY)')<trainer.indexOf("accuracy(model,testEntries"),'the trained model must be saved before protected field evaluation');
for(const [,script] of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(script.trim())new Function(script);
console.log('PASS: V2 tensor shapes/disposal, cache version parity, background fit scheduling, progress, staged errors, and field-test reporting');
(async()=>{
  const api=sandbox.window.KaitiakiFieldAIv2;
  const broken={name:'broken.jpg',path:'Possum/broken.jpg',label:'Possum'};
  const recoverable=api._imageDataError(new Error('The source image could not be decoded.'),broken,'Image decode');
  const possum={name:'good-possum.jpg',label:'Possum'},stoat={name:'good-stoat.jpg',label:'Stoat'};
  const getVector=async entry=>{if(entry===broken)throw recoverable;return new Float32Array([entry===possum?0:1])};
  const extracted=await api._features([possum,broken,stoat],null,'training',getVector);
  assert.equal(extracted.xs.length,2,'feature extraction should keep readable images');
  assert.equal(extracted.ys.length,2);
  assert.equal(extracted.skipped,1);
  const unrelated=new Error('model programming failure');
  await assert.rejects(api._features([possum],null,'training',async()=>{throw unrelated}),e=>e===unrelated,'unrelated feature errors must propagate');
  const model={predict:t=>({argMax:()=>({dataSync:()=>[0]})})};
  const field=await api._accuracy(model,[possum,broken,stoat],null,'field-test',getVector);
  assert.equal(field.planned,3);
  assert.equal(field.total,2,'field denominator should include only decoded test images');
  assert.equal(field.skipped,1);
  assert.equal(field.accuracy,0.5);
  await assert.rejects(api._accuracy(model,[possum],null,'field-test',async()=>{throw unrelated}),e=>e===unrelated,'model/evaluation errors must propagate');
  console.log('PASS: corrupt image skipped in training/field evaluation; unrelated errors propagate');
})().catch(error=>{console.error(error);process.exitCode=1});
