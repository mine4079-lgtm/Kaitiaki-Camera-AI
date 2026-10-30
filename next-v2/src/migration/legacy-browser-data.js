/* Kaitiaki V2 legacy browser-data bridge.
 * Read-only against the V1 browser stores. It never deletes or edits V1 data.
 * Load as a module in the V2 migration screen; do not load in the V1 app.
 */
const LEGACY_DB = "kaitiaki-next-v1";
const LEGACY_STORE = "image-records";
const LEGACY_LOCAL_KEYS = [
  "kaitiaki-team-name",
  "kaitiaki-staff-name",
  "kaitiaki-device-name",
  "kaitiaki-device-id",
  "kaitiaki-camera-register-v1",
  "kaitiaki-camera-checks-v1"
];

function openLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open legacy local database"));
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error("Legacy database does not exist on this device; refusing to create an empty one"));
    };
  });
}

function readAllRecords(db) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(LEGACY_STORE, "readonly");
    const request = tx.objectStore(LEGACY_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Could not read legacy records"));
    tx.onabort = () => reject(tx.error || new Error("Legacy read transaction aborted"));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read saved preview"));
    reader.readAsDataURL(blob);
  });
}

async function encodeRecord(record) {
  const copy = { ...record };
  if (copy.preview instanceof Blob) {
    copy.previewBlob = await blobToDataUrl(copy.preview);
    delete copy.preview;
  }
  return copy;
}

export async function inspectLegacyBrowserData() {
  let db;
  try {
    db = await openLegacyDatabase();
    const records = await readAllRecords(db);
    const counts = {
      records: records.length,
      withPreview: records.filter(r => r.preview instanceof Blob).length,
      withCaptureDate: records.filter(r => !!r.capturedAt).length,
      withCameraCheckId: records.filter(r => !!r.cameraCheckId).length,
      humanVerified: records.filter(r => !!r.verified).length,
      aiClassified: records.filter(r => !!r.aiPrediction).length
    };
    const localSettings = {};
    for (const key of LEGACY_LOCAL_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) localSettings[key] = value;
    }
    return {
      databaseFound: true,
      counts,
      localStorageKeys: Object.keys(localSettings),
      localSettings
    };
  } catch (error) {
    return {
      databaseFound: false,
      counts: null,
      localStorageKeys: LEGACY_LOCAL_KEYS.filter(k => localStorage.getItem(k) !== null),
      error: String(error?.message || error)
    };
  } finally {
    db?.close();
  }
}

export async function exportLegacyBrowserData() {
  const db = await openLegacyDatabase();
  try {
    const records = await readAllRecords(db);
    const encoded = [];
    for (const record of records) encoded.push(await encodeRecord(record));
    const localSettings = {};
    for (const key of LEGACY_LOCAL_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) localSettings[key] = value;
    }
    return {
      format: "kaitiaki-v1-browser-export",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      source: { database: LEGACY_DB, store: LEGACY_STORE },
      localSettings,
      records: encoded
    };
  } finally {
    db.close();
  }
}

export async function downloadLegacyBrowserExport() {
  const bundle = await exportLegacyBrowserData();
  const json = JSON.stringify(bundle);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kaitiaki-v1-device-export-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { records: bundle.records.length, bytes: blob.size, filename: anchor.download };
}
