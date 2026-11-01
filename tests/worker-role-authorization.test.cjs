const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workerPath = path.join(__dirname, "..", "next", "cloud-worker", "src", "index.js");
const worker = fs.readFileSync(workerPath, "utf8");

test("data-fixing routes are explicitly Project Lead-only", () => {
  const routeBlock = worker.match(
    /const PROJECT_LEAD_MUTATION_ROUTES = new Set\(\[(.*?)\]\);/s
  );
  assert.ok(routeBlock, "Project Lead mutation route set should exist");

  for (const route of [
    "/team/mtc03-report-repair",
    "/team/tpac3a-check2-report-repair",
    "/team/review-resolve",
    "/team/camera-check-reconcile"
  ]) {
    assert.match(routeBlock[1], new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  }
});

test("team dispatcher does not default listed mutation routes to Team access", () => {
  assert.match(
    worker,
    /PROJECT_LEAD_MUTATION_ROUTES\.has\(url\.pathname\)\s*\?\s*\["project_lead"\]/
  );
});

test("camera-check deduplication keeps newest complete key and preserves incomplete rows", async () => {
  const { dedupeCameraCheckRows } = await import(
    pathToFileURL(workerPath).href
  );
  const rows = [
    { id: "old-duplicate", camera_no: " cam-1 ", check_no: 2, checked_date: "2026-10-01", updated_at: "2026-10-01T08:00:00Z" },
    { id: "unique-after-duplicate", camera_no: "CAM-2", check_no: 1, checked_date: "2026-10-02", updated_at: "2026-10-02T08:00:00Z" },
    { id: "new-duplicate", camera_no: "CAM-1", check_no: 2, checked_date: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z" },
    { id: "incomplete-a", camera_no: "CAM-3", check_no: 0, checked_date: "2026-10-03", updated_at: "2026-10-03T08:00:00Z" },
    { id: "incomplete-b", camera_no: "CAM-3", check_no: 0, checked_date: "2026-10-03", updated_at: "2026-10-03T09:00:00Z" }
  ];

  const result = dedupeCameraCheckRows(rows, 3);
  assert.deepEqual(result.map(row => row.id), [
    "old-duplicate",
    "unique-after-duplicate",
    "new-duplicate"
  ]);
  assert.deepEqual(
    dedupeCameraCheckRows(rows, 10).map(row => row.id),
    ["old-duplicate", "unique-after-duplicate", "new-duplicate", "incomplete-a", "incomplete-b"]
  );
});
