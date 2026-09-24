/* Run: node next/ai-gate.test.cjs (no external packages required). */
"use strict";
const assert = require("node:assert/strict");
const gate = require("./ai-gate.js");
const manifest = {modelId:"kaitiaki-next-test-001",format:"onnx",testedForFieldUse:true,evaluationId:"independent-test-001",classes:gate.CLASSES.slice()};
const v = (idx, top) => {const rest=(1-top)/(gate.CLASSES.length-1);return gate.CLASSES.map((_,i)=>i===idx?top:rest)};
assert.equal(gate.evaluate(v(0,.95),manifest).disposition,"Target candidate");
assert.equal(gate.evaluate(v(7,.97),manifest).disposition,"No target wildlife");
assert.equal(gate.evaluate(v(8,.97),manifest).disposition,"Empty image");
assert.equal(gate.evaluate(v(0,.65),manifest).disposition,"Human Review");
assert.equal(gate.evaluate(v(3,.99),manifest).verified,false);
assert.equal(gate.evaluate(v(3,.99),manifest).requiresHumanConfirmation,true);
assert.throws(()=>gate.evaluate(v(3,.99),{...manifest,testedForFieldUse:false}),/not marked/);
assert.throws(()=>gate.evaluate([.99],manifest),/Invalid AI probability/);
assert.throws(()=>gate.evaluate(v(0,.95),{...manifest,classes:manifest.classes.slice().reverse()}),/class order/);
assert.throws(()=>gate.evaluate(v(0,.95),manifest,{minTargetScore:12}),/Invalid AI gate/);
// A model trained only for pests, without the unknown and empty classes, cannot be used.
assert.throws(()=>gate.evaluate([.9,.1],manifest),/Invalid AI probability/);
console.log("PASS: 10 AI-gate tests; no inference weights installed or production model modified");