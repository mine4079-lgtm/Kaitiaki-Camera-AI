'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','ai-v3-field-classifier.js'),'utf8');
test('V3 has isolated model and folder database keys',()=>{assert.match(source,/field-v3-five-class/);assert.match(source,/v3-db-five-class/);assert.match(source,/\[VERSION,VERSION-1\]\.includes\(m.version\)/,'existing V5 saved models must remain loadable after the V3 metadata version bump');assert.doesNotMatch(source,/KaitiakiFieldAIv2\s*=/)});
test('V3 selects a frozen feature head when MobileNet model internals are missing',()=>{assert.match(source,/Array\.isArray\(base\.layers\).*base\.inputs&&base\.outputs/);assert.match(source,/mode='frozen-feature-head'/);assert.match(source,/tensors\(tfTrain,false\)/);assert.match(source,/sparseCategoricalCrossentropy/);assert.match(source,/architectureMode/)});
test('V3 protects camera groups and uses balanced class sampling',()=>{assert.match(source,/buildFieldSplit\(state\.entries\)/);assert.match(source,/function balanced\(/);assert.match(source,/fieldTestGroups/)});
test('Frozen feature tensors use float32 labels required by TensorFlow.js sparse loss',()=>{
 const sandbox={window:{},localStorage:{getItem(){return null},setItem(){}},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;api.state.mobileNet={infer(){return{rank:2,dataSync(){return new Float32Array([1,2,3])}}}};
 let observed=null;sandbox.tf={tidy:fn=>fn(),tensor2d:(data,shape)=>({data,shape}),tensor1d:(data,dtype)=>{observed={data:[...data],dtype};return{}}};sandbox.tf.oneHot=()=>{throw Error('fallback must use integer labels')};
 const data={xs:[new Float32Array([1,2,3]),new Float32Array([4,5,6])],ys:[0,4]};const fn=source.slice(source.indexOf('function tensors('),source.indexOf('function emptyConfusion'));const tensors=vm.runInNewContext('('+fn.trim()+')',sandbox);
 const result=tensors(data,false);assert.equal(result.x.shape.join('x'),'2x3');assert.deepEqual(observed,{data:[0,4],dtype:'float32'});assert.equal(data.xs.length,0);
});

test('class thresholds route weak pest calls to Review and accept calls at or above threshold',()=>{
 const sandbox={window:{},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},localStorage:{getItem(){return null},setItem(){}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;
 api.saveThresholds({Possum:.8,Stoat:.85,Mouse:.75,Rat:.7});
 const weak=api._decide([.79,.05,.04,.03,.09]);assert.equal(weak.predicted,'Possum');assert.equal(weak.decision,'Review');assert.equal(weak.review,true);
 const accepted=api._decide([.82,.03,.03,.02,.10]);assert.equal(accepted.decision,'Possum');assert.equal(accepted.review,false);
});
test('validation calibration selects the lowest threshold meeting 95% precision and reports recall',()=>{
 const sandbox={window:{},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},localStorage:{getItem(){return null},setItem(){}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};
 vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;
 const labels=api.CLASSES,poss=labels.indexOf('Possum'),other=labels.indexOf('Other');
 const rows=[{actual:poss,predicted:poss,score:.4},{actual:other,predicted:poss,score:.65},{actual:poss,predicted:poss,score:.7},{actual:poss,predicted:poss,score:.9}];
 const result=api._calibrateValidation(rows,.95);
 assert.equal(result.Possum.threshold,.7);assert.equal(result.Possum.precision,1);assert.equal(result.Possum.recall,2/3);assert.equal(result.Possum.acceptedCount,2);assert.equal(result.Possum.reviewCount,1);
 assert.equal(result.Stoat.possible,false,'No qualifying predicted examples should produce an explicit impossible result');
});
test('temperature scaling softens confidence and preserves a probability distribution',()=>{
 const sandbox={window:{},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},localStorage:{getItem(){return null},setItem(){}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;
 const scaled=api._applyTemperature([.8,.2],2);assert.ok(scaled[0]<.8&&scaled[0]>.5);assert.ok(Math.abs(scaled[0]+scaled[1]-1)<1e-12);
 const fit=api._fitTemperature([{actual:0,scores:[.8,.2]},{actual:1,scores:[.2,.8]}]);assert.ok(fit.temperature>0&&Number.isFinite(fit.nll));
});
test('temperature scaled saved-model decisions use thresholds and route sub-threshold pest calls to review',()=>{
 const sandbox={window:{},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},localStorage:{getItem(){return null},setItem(){}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;
 api.saveThresholds({Possum:.46,Stoat:.7,Mouse:.7,Rat:.7});api.state.metadata={probabilityCalibration:{temperature:2},thresholdCalibration:{targetPrecision:.95,perClass:{Possum:{possible:true}}}};
 const accepted=api._decide([.8,.05,.05,.05,.05]);assert.equal(accepted.predicted,'Possum');assert.equal(accepted.decision,'Possum','calibrated thresholds determine acceptance without a stale generic 70% gate');assert.ok(accepted.confidence<.8);
 api.saveThresholds({Possum:.55,Stoat:.7,Mouse:.7,Rat:.7});api.state.metadata={probabilityCalibration:{temperature:2},thresholdCalibration:{targetPrecision:.95,perClass:{Possum:{possible:true}}}};assert.equal(api._decide([.8,.05,.05,.05,.05]).decision,'Review','temperature-scaled scores below the selected class threshold go to review');
});
