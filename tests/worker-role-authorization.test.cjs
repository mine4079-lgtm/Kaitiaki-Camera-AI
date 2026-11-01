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
    assert.match(routeBlock[1], new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  }
});

test("team dispatcher does not default listed mutation routes to Team access", () => {
  assert.match(
    worker,
    /PROJECT_LEAD_MUTATION_ROUTES\.has\(url\.pathname\)\s*\?\s*\["project_lead"\]/
  );
});
