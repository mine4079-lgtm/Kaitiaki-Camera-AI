'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','ai-v3-field-classifier.js'),'utf8');
test('V3 has isolated model and folder database keys',()=>{assert.match(source,/field-v3-five-class/);assert.match(source,/v3-db-five-class/);assert.doesNotMatch(source,/KaitiakiFieldAIv2\s*=/)});
test('V3 uses partial MobileNet fine tuning and low learning rate',()=>{assert.match(source,/base\.layers\.length-20/);assert.match(source,/adam\(\.00008\)/)});
test('V3 protects camera groups and uses balanced class sampling',()=>{assert.match(source,/buildFieldSplit\(state\.entries\)/);assert.match(source,/function balanced\(/);assert.match(source,/fieldTestGroups/)});