'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','ai-v3-field-classifier.js'),'utf8');
test('V3 has isolated model and folder database keys',()=>{assert.match(source,/field-v3-five-class/);assert.match(source,/v3-db-five-class/);assert.doesNotMatch(source,/KaitiakiFieldAIv2\s*=/)});
test('V3 selects a frozen feature head when MobileNet model internals are missing',()=>{assert.match(source,/Array\.isArray\(base\.layers\).*base\.inputs&&base\.outputs/);assert.match(source,/mode='frozen-feature-head'/);assert.match(source,/tensors\(tfTrain,false\)/);assert.match(source,/sparseCategoricalCrossentropy/);assert.match(source,/architectureMode/)});
test('V3 protects camera groups and uses balanced class sampling',()=>{assert.match(source,/buildFieldSplit\(state\.entries\)/);assert.match(source,/function balanced\(/);assert.match(source,/fieldTestGroups/)});
test('Frozen feature tensors use float32 labels required by TensorFlow.js sparse loss',()=>{
 const sandbox={window:{},localStorage:{getItem(){return null},setItem(){}},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;api.state.mobileNet={infer(){return{rank:2,dataSync(){return new Float32Array([1,2,3])}}}};
 let observed=null;sandbox.tf={tidy:fn=>fn(),tensor2d:(data,shape)=>({data,shape}),tensor1d:(data,dtype)=>{observed={data:[...data],dtype};return{}}};sandbox.tf.oneHot=()=>{throw Error('fallback must use integer labels')};
 const data={xs:[new Float32Array([1,2,3]),new Float32Array([4,5,6])],ys:[0,4]};const fn=source.slice(source.indexOf('function tensors('),source.indexOf('function emptyConfusion'));const tensors=vm.runInNewContext('('+fn.trim()+')',sandbox);
 const result=tensors(data,false);assert.equal(result.x.shape.join('x'),'2x3');assert.deepEqual(observed,{data:[0,4],dtype:'float32'});assert.equal(data.xs.length,0);
});

test('class thresholds route weak pest calls to Review and accept calls at or above threshold',()=>{
 const sandbox={window:{},indexedDB:{open(){throw Error('unexpected IndexedDB access')}},Date,Math,Map,Set,Object,Array,String,Number,Float32Array,Error};vm.runInNewContext(source,sandbox);const api=sandbox.window.KaitiakiFieldAIv3;
 api.saveThresholds({Possum:.8,Stoat:.85,Mouse:.75,Rat:.7});
 const weak=api._decide([.79,.05,.04,.03,.09]);assert.equal(weak.predicted,'Possum');assert.equal(weak.decision,'Review');assert.equal(weak.review,true);
 const accepted=api._decide([.82,.03,.03,.02,.10]);assert.equal(accepted.decision,'Possum');assert.equal(accepted.review,false);
});