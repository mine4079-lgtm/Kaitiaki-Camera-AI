const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    assert.match(routeBlock[1], new RegExp(`"${route.replaceAll("/", "\/")}"`));
  }
});

test("team dispatcher does not default listed mutation routes to Team access", () => {
  assert.match(
    worker,
    /PROJECT_LEAD_MUTATION_ROUTES\.has\(url\.pathname\)\s*\?\s*\["project_lead"\]/
  );
});

test("camera-check report uses bounded SQLite window-function deduplication", () => {
  assert.match(worker, /ROW_NUMBER\(\) OVER \(\s*PARTITION BY CASE/s);
  assert.match(worker, /UPPER\(TRIM\(camera_no\)\)/);
  assert.match(worker, /SUBSTR\(TRIM\(checked_date\), 1, 10\)/);
  assert.match(worker, /ELSE 'incomplete\|' \| id/);
  const dedupeSql = worker.match(/WITH ranked =[\s\S]*?LIMIT \?/);
  assert.ok(dedupeSql, "camera-check query should place a parameterized LIMIT in the ranked query");
  assert.match(dedupeSql[0], /WHERE row_number = 1/);
  assert.ok(dedupeSql[0].indexOf("WHERE row_number = 1") < dedupeSql[0].indexOf("LIMIT ?"), "LIMIT must follow the row_number filter");
});

function faithfulCameraCheckQuery(rows, limit) {
  const ranked = new Map();
  for (const row of rows) {
    const camera = String(row.camera_no ?? "").trim().toUpperCase();
    const checkNo = Number(row.check_no) || 0;
    const checkedDate = String(row.checked_date ?? "").trim().slice(0, 10);
    const key = camera && checkNo > 0 && checkedDate
      ? `${camera}|${Math.trunc(checkNo)}|${checkedDate}`
      : `incomplete|${row.id}`;
    const current = ranked.get(key);
    const order = [row.updated_at ?? "", row.created_at ?? "", row.id ?? ""];
    const currentOrder = current
      ? [current.updated_at ?? "", current.created_at ?? "", current.id ?? ""]
      : null;
    if (!current || order.join("\0") > currentOrder.join("\0")) ranked.set(key, row);
  }
  return [...ranked.values()]
    .sort((a, b) => {
      const av = String(a.checked_date ?? "").trim().slice(0, 10);
      const bv = String(b.checked_date ?? "").trim().slice(0, 10);
      return [bv, b.updated_at ?? "", b.created_at ?? "", b.id ?? ""]
        .join("\0").localeCompare([av, a.updated_at ?? "", a.created_at ?? "", a.id ?? ""].join("\0"));
    })
    .slice(0, limit);
}

test("camera-check SQL semantics retain newest normalized duplicates, every incomplete row, and limit after dedupe", () => {
  const rows = [
    { id: "old", camera_no: " cam-1 ", check_no: 2, checked_date: "2026-10-01T23:59:00Z", updated_at: "2026-10-02T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
    { id: "new", camera_no: "CAM-1", check_no: 2, checked_date: "2026-10-01", updated_at: "2026-10-02T09:00:00Z", created_at: "2026-10-01T09:00:00Z" },
    { id: "unique", camera_no: "CAM-2", check_no: 1, checked_date: "2026-10-03", updated_at: "2026-10-03T08:00:00Z", created_at: "2026-10-03T08:00:00Z" },
    { id: "incomplete-a", camera_no: "CAM-3", check_no: 0, checked_date: "2026-10-04", updated_at: "2026-10-04T08:00:00Z" },
    { id: "incomplete-b", camera_no: "CAM-3", check_no: 0, checked_date: "2026-10-04", updated_at: "2026-10-04T09:00:00Z" }
  ];

  assert.deepEqual(
    faithfulCameraCheckQuery(rows, 3).map(row => row.id),
    ["incomplete-b", "incomplete-a", "unique"]
  );
  assert.deepEqual(
    faithfulCameraCheckQuery(rows, 10).map(row => row.id),
    ["incomplete-b", "incomplete-a", "unique", "new"]
  );
});
