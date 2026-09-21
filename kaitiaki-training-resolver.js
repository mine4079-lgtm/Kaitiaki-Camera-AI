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
function basename(key) { return key.slice(key.lastIndexOf('/') + 1); }
function makeLookup(files) {
  const byName = new Map();
  for (const path of files.keys()) {
    const name = basename(path);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(path);
  }
  return (key) => {
    if (files.has(key)) return { key, candidates: [key], method: 'exact' };
    const possibilities = (byName.get(basename(key)) || [])
      .filter(path => path === key || path.endsWith('/' + key));
    return { key, candidates: possibilities, method: possibilities.length === 1 ? 'unique suffix' :
      possibilities.length > 1 ? 'ambiguous' : 'missing' };
  };
}
export async function resolveTrainingImages({ directoryHandle, trainingRows, holdoutRows = [], independentRows = [] }) {
  const training = uniqueRows(trainingRows, 'training');
  const holdout = uniqueRows(holdoutRows, 'holdout');
  const independent = uniqueRows(independentRows, 'independent');
  const directCollisions = [...training].filter(k => holdout.has(k));
  if (directCollisions.length) throw new Error(`Refusing ${directCollisions.length} training/holdout path collision(s): ${directCollisions.slice(0, 5).join(', ')}`);
  const files = await scan(directoryHandle), lookup = makeLookup(files);
  const heldoutCandidates = new Set(), holdoutResolved = [], holdoutMissing = [], holdoutAmbiguous = [];
  for (const row of holdoutRows) {
    const key = pathOf(row), m = lookup(key);
    for (const path of m.candidates) heldoutCandidates.add(path);
    if (m.candidates.length === 1) holdoutResolved.push({ row, key, matchedPath: m.candidates[0], file: files.get(m.candidates[0]) });
    else if (m.candidates.length > 1) holdoutAmbiguous.push({ row, key, candidates: m.candidates.slice(0, 8) });
    else holdoutMissing.push({ row, key });
  }
  const resolved = [], missing = [], ambiguous = [];
  const usedPaths = new Set();
  let suffixMatched = 0, exactMatched = 0;
  const collisions = [], duplicateResolved = [];
  for (const row of trainingRows) {
    const key = pathOf(row), match = lookup(key);
    if (match.candidates.length > 1) {
      ambiguous.push({ row, key, candidates: match.candidates.slice(0, 8) });
      continue;
    }
    if (!match.candidates.length) { missing.push({ row, key }); continue; }
    const actualPath = match.candidates[0];
    if (heldoutCandidates.has(actualPath)) { collisions.push(key); continue; }
    if (usedPaths.has(actualPath)) { duplicateResolved.push(key); continue; }
    usedPaths.add(actualPath);
    if (match.method === 'exact') exactMatched++; else suffixMatched++;
    resolved.push({ row, key, matchedPath: actualPath, file: files.get(actualPath) });
  }
  if (collisions.length) throw new Error(`Refusing ${collisions.length} training/holdout image collision(s) after HDD matching: ${collisions.slice(0, 5).join(', ')}`);
  if (duplicateResolved.length) throw new Error(`Refusing ${duplicateResolved.length} training rows resolving to the same HDD image: ${duplicateResolved.slice(0, 5).join(', ')}`);
  const independentResolved = [];
  for (const row of independentRows) {
    const key = pathOf(row), m = lookup(key);
    if (m.candidates.length !== 1 || !labelOf(row)) continue;
    const actualPath = m.candidates[0];
    if (usedPaths.has(actualPath) || heldoutCandidates.has(actualPath)) continue;
    usedPaths.add(actualPath);
    independentResolved.push({ row, key, matchedPath: actualPath, file: files.get(actualPath) });
  }
  const counts = {};
  for (const item of resolved) { const label = labelOf(item.row); if (label) counts[label] = (counts[label] || 0) + 1; }
  return { resolved, missing, ambiguous, independentResolved, holdoutResolved, holdoutMissing, holdoutAmbiguous, counts, scannedFiles: files.size,
    trainingCount: training.size, holdoutCount: holdout.size, independentCount: independent.size,
    holdoutOverlapCount: 0, exactMatched, suffixMatched };
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
