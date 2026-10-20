const assert = require("node:assert/strict");

function summarize(rows, reportTotal) {
  const counts = { active: 0, resolved: 0, ignored: 0 };
  for (const row of rows) {
    if (row.label !== "Possum") continue;
    const status = String(row.status || "").toLowerCase();
    if (status === "ignored") counts.ignored++;
    else if (status === "resolved") counts.resolved++;
    else counts.active++;
  }
  return { reportTotal, ...counts };
}

const oxic3 = [
  { label: "Possum", status: "sighting" },
  { label: "Possum", status: "sighting" },
  { label: "Possum", status: "sighting" },
  { label: "Possum", status: "sighting" },
  { label: "Possum", status: "sighting" },
  { label: "Possum", status: "resolved" }
];

assert.deepEqual(summarize(oxic3, 5), { reportTotal: 5, active: 5, resolved: 1, ignored: 0 });
assert.deepEqual(summarize([...oxic3, { label: "Possum", status: "ignored" }], 5), { reportTotal: 5, active: 5, resolved: 1, ignored: 1 });
console.log("camera report audit fixtures: ok");
