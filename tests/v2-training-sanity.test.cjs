const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const trainer=fs.readFileSync(path.join(root,'ai-v2-field-classifier.js'),'utf8');
const page=fs.readFileSync(path.join(root,'training-v2.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const tensorsSource=trainer.replace('window.KaitiakiFieldAIv2={VERSION,','window.KaitiakiFieldAIv2={_tensors:tensors,VERSION,');
const tf={
  tidy:fn=>fn(),
  tensor2d:(data,shape)=>({data,shape,dispose(){}}),
  tensor1d:(data)=>({data,dispose(){}}),
  oneHot:(idx,classes)=>({shape:[idx.data.length,classes],dispose(){}})
};
const sandbox={window:{},tf};
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
const pageVersion=page.match(/ai-v2-field-classifier\.js\?v=(\d+)/)?.[1];
const cacheVersion=worker.match(/ai-v2-field-classifier\.js\?v=(\d+)/)?.[1];
assert.ok(pageVersion,'V2 page should pin a classifier version');
assert.equal(cacheVersion,pageVersion,'service worker must precache the V2 page’s classifier version');
assert.match(worker,/kaitiaki-camera-v52/,'service worker cache should be invalidated for this release');
assert.match(trainer,/onBatchEnd:async/,'training should report progress during model.fit batches');
assert.match(trainer,/error\.trainingStage=stage/,'training errors should carry the exact failed stage');
assert.match(page,/p\.phase==='stage'/,'V2 UI should render exact setup stages');
assert.match(page,/visibilityState==='hidden'.*setTimeout/,'V2 should keep TensorFlow.js frame yields moving in a hidden tab');
for(const [,script] of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(script.trim())new Function(script);
console.log('PASS: V2 tensor shapes/disposal, cache version parity, background fit scheduling, progress, and staged errors');
