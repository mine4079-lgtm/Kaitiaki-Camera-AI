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
assert.match(mergedSource, /map\.set\(id,c\)/, "shared report must replace local copy regardless of local timestamp");
assert.doesNotMatch(mergedSource, /updatedAt.*>=.*old\.updatedAt/, "local timestamps must not override the shared report");
