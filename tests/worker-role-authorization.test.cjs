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
  assert.match(worker, /ELSE 'incomplete\|'\s*\|\|\s*id/);
  const dedupeSql = worker.match(/WITH ranked AS \([\s\S]*?LIMIT \?/);
  assert.ok(dedupeSql, "camera-check query should place a parameterized LIMIT in the ranked query");
  assert.match(dedupeSql[0], /WHERE row_number = 1/);
  assert.ok(dedupeSql[0].indexOf("WHERE row_number = 1") < dedupeSql[0].indexOf("LIMIT ?"), "LIMIT must follow the row_number filter");
});

test("camera-check query executes in SQLite and deduplicates before LIMIT", () => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (error) {
    assert.fail(`This integration test requires Node's built-in node:sqlite: ${error.message}`);
  }

  // Keep this test coupled to the production query: it executes the exact template
  // extracted from index.js, so SQL changes cannot silently leave the test stale.
  const handlerStart = worker.indexOf("async function handleCameraChecks");
  assert.ok(handlerStart >= 0, "camera-check production handler should remain extractable");
  const cameraChecksHandler = worker.slice(handlerStart);
  const queryStartMarker = "const result = await env.KAITIAKI_DB.prepare(`";
  const queryStart = cameraChecksHandler.indexOf(queryStartMarker);
  assert.ok(queryStart >= 0, "camera-check production query should remain extractable");
  const sqlStart = queryStart + queryStartMarker.length;
  const sqlEnd = cameraChecksHandler.indexOf("`).bind(limit).all();", sqlStart);
  assert.ok(sqlEnd >= sqlStart, "camera-check production query terminator should remain extractable");
  const query = cameraChecksHandler.slice(sqlStart, sqlEnd);

  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE camera_checks (
      id TEXT PRIMARY KEY,
      team_name TEXT,
      device_id TEXT,
      device_name TEXT,
      camera_no TEXT,
      zone TEXT,
      block_name TEXT,
      camera_status TEXT,
      check_no INTEGER,
      checked_date TEXT,
      serviced_by TEXT,
      classified_date TEXT,
      first_image_date TEXT,
      last_image_date TEXT,
      latest_possum_date TEXT,
      approx_presence TEXT,
      classified_by TEXT,
      report_year INTEGER,
      monthly_possum_json TEXT,
      species_json TEXT,
      total_possum INTEGER,
      images_processed INTEGER,
      meaningful_count INTEGER,
      skipped_count INTEGER,
      human_count INTEGER,
      unsure_count INTEGER,
      notes TEXT,
      issues_notes TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  const rows = [
    ["old", " cam-1 ", 2, "2026-10-01T23:59:00Z", "2026-10-02T08:00:00Z", "2026-10-01T08:00:00Z"],
    ["new", "CAM-1", 2, "2026-10-01", "2026-10-02T09:00:00Z", "2026-10-01T09:00:00Z"],
    ["unique", "CAM-2", 1, "2026-10-03", "2026-10-03T08:00:00Z", "2026-10-03T08:00:00Z"],
    ["incomplete-a", "CAM-3", 0, "2026-10-04", "2026-10-04T08:00:00Z", "2026-10-04T08:00:00Z"],
    ["incomplete-b", "CAM-3", 0, "2026-10-04", "2026-10-04T09:00:00Z", "2026-10-04T09:00:00Z"]
  ];
  const insert = db.prepare(
    "INSERT INTO camera_checks (id, camera_no, check_no, checked_date, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const row of rows) insert.run(...row);

  const run = limit => db.prepare(query).all(limit).map(row => row.id);
  assert.deepEqual(run(3), ["incomplete-b", "incomplete-a", "unique"]);
  assert.deepEqual(run(10), ["incomplete-b", "incomplete-a", "unique", "new"]);
  db.close();
});
