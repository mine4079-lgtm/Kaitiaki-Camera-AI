const assert = require("node:assert/strict");
const fs = require("node:fs");

function extractFunction(source, name) {
  const marker = "function " + name + "(";
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

function loadDedupe(path, name) {
  const source = fs.readFileSync(path, "utf8");
  const normalizer = new Function("return (" + extractFunction(source, "normalizeCheckedDate") + ")")();
  const dedupe = new Function("normalizeCheckedDate", "return (" + extractFunction(source, name) + ")")(normalizer);
  return { normalizer, dedupe };
}

for (const [path, name] of [["next/camera-report.js", "dedupeCameraChecks"], ["next/project-lead.js", "dedupe"]]) {
  const { normalizer, dedupe } = loadDedupe(path, name);
  assert.equal(normalizer("2026-10-01T08:00:00Z"), "2026-10-01");
  assert.equal(normalizer("2026-10-01"), "2026-10-01");
  assert.equal(normalizer(""), "");
  assert.equal(normalizer("not-a-date"), "");

  const sameDay = dedupe([
    { id: "local", cameraNo: "cam-1", checkNo: 1, checkedDate: "2026-10-01", updatedAt: "2026-10-01T01:00:00Z" },
    { id: "iso", cameraNo: "CAM-1", checkNo: 1, checkedDate: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T02:00:00Z" }
  ]);
  const sameDayRows = sameDay.checks || sameDay;
  assert.equal(sameDayRows.length, 1, path + " dedupes date-only and ISO timestamp forms");

  const distinctDays = dedupe([
    { id: "day-1", cameraNo: "cam-1", checkNo: 1, checkedDate: "2026-10-01" },
    { id: "day-2", cameraNo: "cam-1", checkNo: 1, checkedDate: "2026-10-02" }
  ]);
  assert.equal((distinctDays.checks || distinctDays).length, 2, path + " preserves distinct days");

  const incomplete = dedupe([
    { id: "missing", cameraNo: "cam-1", checkNo: 1, checkedDate: "" },
    { id: "invalid", cameraNo: "cam-1", checkNo: 1, checkedDate: "not-a-date" }
  ]);
  assert.equal((incomplete.checks || incomplete).length, 2, path + " preserves incomplete rows");
}

console.log("camera check date dedupe regressions: ok");
