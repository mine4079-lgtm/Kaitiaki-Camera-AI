/* Read-only CSV/HDD matcher for Kaitiaki V4 preparation. It never writes to the selected directory. */
export function normalizeRelativePath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
    .split('/').filter(Boolean).join('/').toLocaleLowerCase();
}
function labelOf(row) { return String(row.confirmed_label ?? row.label ?? '').trim(); }
function pathOf(row) { return normalizeRelativePath(row.relative_path ?? row.path ?? row.file_name); }
function uniqueRows(rows, name) {
  const seen = new Set();
  for (const row of rows) {
    const key = pathOf(row);
    if (!key) throw new Error(`${name} row is missing relative_path/path/file_name`);
    if (seen.has(key)) throw new Error(`${name} contains duplicate path: ${key}`);
    seen.add(key);
  }
  return seen;
}
async function scan(handle, prefix = '', out = new Map()) {
  if (!handle?.values) throw new TypeError('A readable directory handle is required');
  for await (const entry of handle.values()) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') out.set(normalizeRelativePath(relative), entry);
    else if (entry.kind === 'directory') await scan(entry, relative, out);
  }
  return out;
}
export async function resolveTrainingImages({ directoryHandle, trainingRows, holdoutRows = [], independentRows = [] }) {
  const training = uniqueRows(trainingRows, 'training');
  const holdout = uniqueRows(holdoutRows, 'holdout');
  const independent = uniqueRows(independentRows, 'independent');
  const collisions = [...training].filter(k => holdout.has(k));
  if (collisions.length) throw new Error(`Refusing ${collisions.length} training/holdout path collision(s): ${collisions.slice(0, 5).join(', ')}`);
  const files = await scan(directoryHandle);
  const resolved = [], missing = [];
  for (const row of trainingRows) {
    const key = pathOf(row), file = files.get(key);
    (file ? resolved : missing).push(file ? { row, key, file } : { row, key });
  }
  const independentResolved = independentRows.filter(row => {
    const key = pathOf(row);
    return key && !training.has(key) && !holdout.has(key) && files.has(key) && labelOf(row);
  }).map(row => ({ row, key: pathOf(row), file: files.get(pathOf(row)) }));
  const counts = {};
  for (const item of resolved) { const label = labelOf(item.row); if (label) counts[label] = (counts[label] || 0) + 1; }
  return { resolved, missing, independentResolved, counts, scannedFiles: files.size,
    trainingCount: training.size, holdoutCount: holdout.size, independentCount: independent.size,
    holdoutOverlapCount: collisions.length };
}
export function makeBalancedCandidate({ resolved, independentResolved = [], targetPerClass = null }) {
  const groups = new Map();
  for (const item of [...resolved, ...independentResolved]) {
    const label = labelOf(item.row); if (!label) continue;
    if (!groups.has(label)) groups.set(label, []); groups.get(label).push(item);
  }
  const available = Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.length]));
  const target = targetPerClass ?? (Object.keys(available).length ? Math.min(...Object.values(available)) : 0);
  const selected = [];
  for (const [label, items] of [...groups].sort(([a], [b]) => a.localeCompare(b)))
    selected.push(...items.slice(0, Math.min(target, items.length)).map(item => ({ ...item, label })));
  return { selected, available, targetPerClass: target, usable: target > 0 && selected.length > 0 };
}
