const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("next/camera-report.js", "utf8");
function extractFunction(name) {
  const marker = "async function " + name + "(";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "Could not find " + name);
  const open = source.indexOf("{", start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Could not parse " + name);
}

function makeCheck(monthlyPossum, totalPossum) {
  return { id: "tpac3a-check-2", cameraNo: "TPAC3A", checkNo: 2, checkedDate: "2026-10-07",
    reportYear: 2026, monthlyPossum, totalPossum, approxPresence: "High", latestPossumDate: "2026-10-01" };
}
function makeRows() {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ cameraCheckId: "tpac3a-check-2", verified: true, label: "Possum", aiPrediction: "", capturedAt: "2026-09-29T12:00:00Z", status: "sighting" });
  for (let i = 0; i < 12; i++) rows.push({ cameraCheckId: "tpac3a-check-2", verified: true, label: "Possum", aiPrediction: "", capturedAt: "2026-10-01T12:00:00Z", status: "sighting" });
  return rows;
}
async function runCase(check) {
  let saved = check, syncCalls = 0, rendered = 0;
  const rows = makeRows();
  const fn = new Function("localChecks","openDB","allRows","effectiveLabel","isSkipped","dateOnly","presenceFromCount","saveLocalCheck","syncCheck","renderReport",
    "return (" + extractFunction("backfillExistingChecks") + ")");
  const backfill = fn(() => [saved], async () => ({ close() {} }), async () => rows,
    r => r.verified ? r.label : (r.aiPrediction || ""), r => !!r.aiSkipped || r.aiPrediction === "Empty image",
    v => v ? String(v).slice(0,10) : "", n => n === 0 ? "None" : n <= 9 ? "Low" : n <= 15 ? "Medium" : "High",
    c => { saved = c; }, async () => { syncCalls++; return true; }, () => { rendered++; });
  await backfill();
  return { saved, syncCalls, rendered };
}
(async () => {
  const oldMonthly = Array(12).fill(0); oldMonthly[8] = 4; oldMonthly[9] = 6;
  const result = await runCase(makeCheck(oldMonthly, 10));
  assert.equal(result.saved.totalPossum, 16, "must count all 16 human-confirmed Possums despite blank AI labels");
  assert.equal(result.saved.monthlyPossum[8], 4, "September should have four Possums");
  assert.equal(result.saved.monthlyPossum[9], 12, "October should have twelve Possums");
  assert.equal(result.syncCalls, 1, "updated report should be synced once");
  assert.equal(result.rendered, 1, "changed report should refresh the report view");

  const sameTotalWrongMonths = Array(12).fill(0); sameTotalWrongMonths[8] = 10; sameTotalWrongMonths[9] = 6;
  const second = await runCase(makeCheck(sameTotalWrongMonths, 16));
  assert.equal(second.saved.totalPossum, 16);
  assert.equal(second.saved.monthlyPossum[8], 4, "month-only mismatch should be repaired");
  assert.equal(second.saved.monthlyPossum[9], 12, "month-only mismatch should be repaired");
  assert.equal(second.syncCalls, 1, "month-only mismatch should trigger sync");
  console.log("PASS: human-confirmed blank-AI records and monthly-only mismatch");
})().catch(error => { console.error(error); process.exitCode = 1; });
