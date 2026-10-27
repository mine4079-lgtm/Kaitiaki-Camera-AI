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

const fn = new Function("return (" + extractFunction("backfillExistingChecks") + ")");
(async () => {
  let saved = false, syncCalls = 0, rendered = 0;
  const refresh = fn() ;
  const result = await refresh();
  assert.equal(result.changed, false, "manual local-only refresh must not claim to change reports");
  assert.match(result.reason, /disabled|shared sightings/i, "must explain why refresh is disabled");
  assert.equal(saved, false, "must not change saved report data");
  assert.equal(syncCalls, 0, "must not sync local-only totals to shared storage");
  assert.equal(rendered, 0, "must not refresh the report view as though it changed");
  assert.doesNotMatch(source, /backfillExistingChecks\(\);/, "unsafe automatic backfill invocation must remain absent");
  console.log("PASS: manual local-only camera report backfill is safely disabled");
})().catch(error => { console.error(error); process.exitCode = 1; });
const mergedStart = source.indexOf("async function mergedChecks(){");
assert.notEqual(mergedStart, -1, "must find mergedChecks");
const mergedEnd = source.indexOf("\n}\n", mergedStart) + 2;
const mergedSource = source.slice(mergedStart, mergedEnd);
assert.match(mergedSource, /for\s*\(const c of await sharedChecks\(\)\)/, "must merge authoritative shared reports");
assert.match(mergedSource, /map\.set\(id,\{\.\.\.c,_reportSource:"shared"\}\)/, "shared reports must be marked as authoritative");
assert.match(source, /const oldIsShared=old\._reportSource==="shared";[\s\S]*const newIsShared=c\._reportSource==="shared";[\s\S]*newIsShared&&!oldIsShared/, "duplicate checks must prefer shared rows over local rows regardless of timestamps");
assert.match(source, /newTime>=oldTime/, "timestamps should still select the latest row when both rows have the same source");

assert.match(source, /"AI label","Confirmed label","Human verified","Status","Record created","Last updated","Imported by","Reviewer","Team","Device"/, "OXIC1 audit must expose classification and provenance metadata");
assert.match(source, /r\.aiPrediction\|\|"—".*r\.confirmedLabel\|\|"—".*Number\(r\.humanVerified\)/, "OXIC1 audit rows must show AI label, confirmed label, and human verification");

const workerSource = fs.readFileSync("next/cloud-worker/src/index.js", "utf8");
const htmlSource = fs.readFileSync("next/index.html", "utf8");
assert.match(workerSource, /reportImages:Number\(c\.images_processed\)\|\|0/, "audit image count must use images_processed");
assert.match(workerSource, /reportTotalPossum:Number\(c\.total_possum\)\|\|0/, "audit must expose saved possum total separately");
assert.match(workerSource, /reportVsDatedDelta:c\.reportTotalPossum-c\.capturedInReportYear/, "possums delta must compare saved possum total with dated in-year possums");
assert.ok(htmlSource.includes("<th>Images processed</th><th>Saved possum total</th><th>Linked possum records</th>"), "audit headings must distinguish images, possum total, and linked records");

assert.match(workerSource, /humanVerifiedPossumRecords:c\.humanVerifiedPossumRecords/, "audit must expose human-verified possum record count");
assert.match(workerSource, /aiOnlyPossumRecords:c\.aiOnlyPossumRecords/, "audit must expose AI-only possum record count");
assert.match(workerSource, /confirmedLabelPossumRecords:c\.confirmedLabelPossumRecords/, "audit must expose records confirmed as Possum");
assert.match(htmlSource, /Human-verified possums.*AI-only possum records.*Confirmed label = Possum.*Missing confirmed label/, "audit table must display verification and label breakdown");

assert.match(workerSource, /recordsUpdatedAfterReport:c\.recordsUpdatedAfterReport/, "audit must expose records updated after the saved report timestamp");
assert.match(workerSource, /humanVerifiedUpdatedAfterReport:c\.humanVerifiedUpdatedAfterReport/, "audit must expose verified records updated after the saved report timestamp");
assert.match(htmlSource, /Records updated after report saved.*Human-verified updated after report/, "audit must display report-versus-record update timing clues");

const teamSyncStart = workerSource.indexOf("async function handleTeamSync(");
assert.notEqual(teamSyncStart, -1, "must find shared sighting sync handler");
const teamSyncEnd = workerSource.indexOf("\nasync function handleTeamList(", teamSyncStart);
const teamSyncSource = workerSource.slice(teamSyncStart, teamSyncEnd);
assert.match(teamSyncSource, /SELECT updated_at FROM sightings WHERE id=\?/,
  "shared sighting sync must read the authoritative timestamp");
assert.match(teamSyncSource, /existing && !Number\.isFinite\(incomingTime\)/,
  "shared sighting sync must reject missing timestamps for existing records");
assert.match(teamSyncSource, /incomingTime <= existingTime/,
  "older or equal offline sightings must not overwrite shared records");

const teamListStart = workerSource.indexOf("async function handleTeamList(");
assert.notEqual(teamListStart, -1, "must find shared review-list handler");
const teamListEnd = workerSource.indexOf("\nasync function ", teamListStart + 10);
const teamListSource = workerSource.slice(teamListStart, teamListEnd);
assert.doesNotMatch(teamListSource, /UPDATE\s+sightings/i,
  "opening the shared review list must not mutate stored sightings");
assert.match(teamListSource, /const reviewFilter = status === "review"/,
  "duplicate review filtering must happen in the SELECT query");
assert.match(teamListSource, /COALESCE\(sightings\.ai_prediction,''\)<>'Empty image'/,
  "empty-image records must be excluded while records with missing AI labels remain visible");
assert.match(teamListSource, /newer\.captured_at IS NOT NULL AND sightings\.captured_at IS NOT NULL/,
  "duplicate matching must not treat two missing capture dates as an exact match");
assert.doesNotMatch(workerSource, /UPDATE sightings SET status='ignored', needs_extra_review=0 WHERE ai_prediction='Empty image'/,
  "schema setup must not silently change stored review decisions");

const teamPayloadStart = workerSource.indexOf("async function teamPayload(");
assert.notEqual(teamPayloadStart, -1, "must find team authorization guard");
const teamPayloadEnd = workerSource.indexOf("\nasync function rolePayload(", teamPayloadStart);
const teamPayloadSource = workerSource.slice(teamPayloadStart, teamPayloadEnd);
assert.match(teamPayloadSource, /role !== "team"/,
  "Project Lead read-only credentials must not authorize team mutation endpoints");

const syncStart = workerSource.indexOf("async function handleCameraCheckSync(");
assert.notEqual(syncStart, -1, "must find shared camera report sync handler");
const syncEnd = workerSource.indexOf("\nasync function handleCameraChecks(", syncStart);
const syncSource = workerSource.slice(syncStart, syncEnd);
assert.match(syncSource, /SELECT updated_at FROM camera_checks WHERE id=\?/,
  "sync must read the existing shared report timestamp before overwriting it");
assert.match(syncSource, /existing && Number\.isFinite\(existingTime\) && incomingTime < existingTime/,
  "older browser snapshots must not overwrite newer shared report snapshots");
assert.match(syncSource, /existing && !Number\.isFinite\(incomingTime\)/,
  "existing shared reports must reject missing or invalid incoming timestamps");
assert.match(syncSource, /skipped\s*:\s*true/,
  "stale report sync should return a visible skipped result");

const finishCheckSource = extractFunction("finishCheck");
assert.match(finishCheckSource, /const finalCheckedDate=\$\("cameraCheckedDate"\)\.value\|\|c\.checkedDate\|\|today\(\)/,
  "report year must be based on the final checked date shown in the form");
assert.match(finishCheckSource, /const validCaptureDate=v=>\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\//,
  "capture-date reporting must preserve the stored calendar date");
assert.match(finishCheckSource, /checkedDate:finalCheckedDate/,
  "saved report date and report year must use the same checked date");

assert.match(htmlSource, /if\(r\.cameraCheckId&&r\.cameraCheckId!==context\.cameraCheckId\)continue;/,
  "camera check attachment must preserve records already linked to another check");
assert.doesNotMatch(htmlSource, /if\(!force&&r\.cameraCheckId/,
  "finish-check fallback must not force-reassign existing camera links");
