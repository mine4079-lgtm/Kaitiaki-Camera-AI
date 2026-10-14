/* Kaitiaki Camera AI — Gemini classifier + shared team sightings backend.
 * Required Worker secrets: GEMINI_API_KEY and KAITIAKI_ACCESS_TOKEN.
 * Optional role secret: KAITIAKI_PROJECT_LEAD_TOKEN (unlocks the read-only Project Lead dashboard).
 * Shared-team binding:
 *   KAITIAKI_DB -> Cloudflare D1 database
 * Small shared thumbnails are stored directly in D1; R2 is not required.
 */
const LABELS = [
  "Possum","Rat","Stoat","Mouse","Deer","Pig","Weka",
  "Other wildlife","Human","Empty image","Unsure"
];
const PEST_LABELS = ["Possum","Rat","Stoat","Mouse","Deer","Pig"];
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024 * 1.5;
const MAX_SYNC_BODY = 2 * 1024 * 1024;
const MODEL = "gemini-3.5-flash-lite";
let schemaReady = false;

const GUIDE =
  "Classify this New Zealand trail camera photograph using exactly one label: " +
  LABELS.join(", ") +
  ". Identify only what is visibly present. Use Human when a person is visible. Other wildlife includes birds " +
  "(including kereru and kiwi), cats, dogs, and all non-target animals; " +
  "never call animals or people an empty image. Empty image is only when the frame is clear enough " +
  "to rule out an animal or person and no animal, person, or animal-like shape is visible. Vegetation-only, wind-triggered, shadow-only, branch-only, and empty-ground frames are Empty image. If the image is " +
  "blurry, dark, partially obscured, motion-smeared, or contains an animal-like shape that " +
  "cannot be identified confidently, use Unsure rather than Empty image. Use Unsure only " +
  "when no single species label fits confidently. " +
  "\n\nDistinguishing features:\n" +
  "- Possum vs Rat: possums are larger (cat-sized), with a bushier tail, " +
  "rounder ears and a blunter face. Rats are smaller, with a thin scaly " +
  "tail and pointed snout.\n" +
  "- Stoat vs Weka: stoats are small, slender, low to the ground, with a " +
  "short-legged bounding posture and a black-tipped tail. Weka are birds " +
  "— upright stance, visible beak, no visible tail in the same way.\n" +
  "- If blurry or partially obscured, use body size and posture (upright " +
  "bird vs low mammal) as the primary cue over color or texture.\n\n" +
  "Reply with a JSON object containing: label, confidence (integer 0-100, " +
  "subjective only, not a calibrated probability), second_choice (the next " +
  "most likely label, or null if not applicable), and note (brief visible " +
  "evidence, and if second_choice is set, what made the top pick more " +
  "likely). Do not invent animals.";

function reply(body, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "vary": "Origin"
    }
  });
}

function accessRoleForToken(token, env) {
  if (env.KAITIAKI_PROJECT_LEAD_TOKEN && token === env.KAITIAKI_PROJECT_LEAD_TOKEN) return "project_lead";
  if (env.KAITIAKI_ACCESS_TOKEN && token === env.KAITIAKI_ACCESS_TOKEN) return "team";
  return "";
}

function authorised(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return !!accessRoleForToken(token, env);
}

async function teamPayload(request, env) {
  let input;
  try { input = JSON.parse(await request.text()); }
  catch { return { error: "Invalid team request" }; }
  const role = accessRoleForToken(input?.token, env);
  if (!role) return { error: "Not authorised" };
  return { input, role };
}

async function rolePayload(request, env, requiredRole = "") {
  let input;
  try { input = JSON.parse(await request.text()); }
  catch { return { error: "Invalid access request" }; }
  const role = accessRoleForToken(input?.token, env);
  if (!role || (requiredRole && role !== requiredRole)) return { error: "Not authorised" };
  return { input, role };
}

function clean(value, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function sharedConfigured(env) {
  return !!env.KAITIAKI_DB;
}

async function ensureSchema(env) {
  if (!env.KAITIAKI_DB) throw new Error("D1 binding missing");
  if (schemaReady) return;

  await env.KAITIAKI_DB.prepare(`
    CREATE TABLE IF NOT EXISTS sightings (
      id TEXT PRIMARY KEY,
      team_name TEXT,
      device_id TEXT,
      device_name TEXT,
      imported_by TEXT,
      reviewer_name TEXT,
      file_name TEXT NOT NULL,
      camera_no TEXT,
      camera_check_id TEXT,
      check_no INTEGER,
      checked_date TEXT,
      relative_path TEXT,
      ai_prediction TEXT,
      ai_confidence INTEGER,
      ai_second_choice TEXT,
      ai_note TEXT,
      confirmed_label TEXT,
      human_verified INTEGER NOT NULL DEFAULT 0,
      needs_extra_review INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      image_blob BLOB,
      image_type TEXT,
      captured_at TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  const columns = await env.KAITIAKI_DB.prepare("PRAGMA table_info(sightings)").all();
  const names = new Set((columns.results || []).map(row => row.name));
  if (!names.has("camera_no")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN camera_no TEXT").run();
  if (!names.has("camera_check_id")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN camera_check_id TEXT").run();
  if (!names.has("check_no")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN check_no INTEGER").run();
  if (!names.has("checked_date")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN checked_date TEXT").run();
  if (!names.has("image_blob")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN image_blob BLOB").run();
  if (!names.has("image_type")) await env.KAITIAKI_DB.prepare("ALTER TABLE sightings ADD COLUMN image_type TEXT").run();

  await env.KAITIAKI_DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_sightings_status_updated ON sightings(status, updated_at DESC)"
  ).run();
  await env.KAITIAKI_DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_sightings_team_status ON sightings(team_name, status, updated_at DESC)"
  ).run();
  await env.KAITIAKI_DB.prepare(
    "UPDATE sightings SET status='ignored', needs_extra_review=0 WHERE ai_prediction='Empty image' AND status='review'"
  ).run();

  await env.KAITIAKI_DB.prepare(`
    CREATE TABLE IF NOT EXISTS camera_checks (
      id TEXT PRIMARY KEY,
      team_name TEXT,
      device_id TEXT,
      device_name TEXT,
      camera_no TEXT NOT NULL,
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
      total_possum INTEGER NOT NULL DEFAULT 0,
      images_processed INTEGER NOT NULL DEFAULT 0,
      meaningful_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      human_count INTEGER NOT NULL DEFAULT 0,
      unsure_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      issues_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  const cameraColumns = await env.KAITIAKI_DB.prepare("PRAGMA table_info(camera_checks)").all();
  const cameraNames = new Set((cameraColumns.results || []).map(row => row.name));
  if (!cameraNames.has("latest_possum_date")) await env.KAITIAKI_DB.prepare("ALTER TABLE camera_checks ADD COLUMN latest_possum_date TEXT").run();
  await env.KAITIAKI_DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_camera_checks_camera_date ON camera_checks(camera_no, checked_date DESC)"
  ).run();
  await env.KAITIAKI_DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_camera_checks_updated ON camera_checks(updated_at DESC)"
  ).run();

  schemaReady = true;
}

function classifySharedStatus(r) {
  const confirmed = clean(r.label, 40);
  const ai = clean(r.aiPrediction, 40);
  const verified = !!r.verified;
  const confidence = int(r.aiConfidence);
  const flagged = !!r.aiNeedsExtraReview;

  if (verified) return PEST_LABELS.includes(confirmed) ? "sighting" : "resolved";
  if (ai === "Empty image") return "ignored";
  if (ai === "Unsure" || flagged || (ai && confidence < 95)) return "review";
  if (PEST_LABELS.includes(ai) && confidence >= 95) return "sighting";
  return "ignored";
}

async function hashId(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function decodeImageData(dataUrl) {
  const match = typeof dataUrl === "string" &&
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType: "image/" + match[1] };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function handleTeamSync(input, env, origin) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false }, 503, origin);
  }

  const r = input?.record || {};
  const sourceId = clean(r.syncId || r.key, 1000);
  const fileName = clean(r.name, 300);
  if (!sourceId || !fileName) return reply({ error: "Record id and file name are required" }, 400, origin);

  await ensureSchema(env);

  const id = await hashId(sourceId);
  const status = classifySharedStatus(r);
  let imageBytes = null;
  let imageType = null;

  if ((status === "sighting" || status === "review") && input.image) {
    const image = decodeImageData(input.image);
    if (!image || image.bytes.byteLength > 750 * 1024) {
      return reply({ error: "Invalid or oversized shared preview" }, 400, origin);
    }
    imageBytes = image.bytes;
    imageType = image.contentType;
  }

  const now = new Date().toISOString();
  await env.KAITIAKI_DB.prepare(`
    INSERT INTO sightings (
      id, team_name, device_id, device_name, imported_by, reviewer_name,
      file_name, camera_no, camera_check_id, check_no, checked_date, relative_path, ai_prediction, ai_confidence, ai_second_choice,
      ai_note, confirmed_label, human_verified, needs_extra_review, status,
      image_blob, image_type, captured_at, verified_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      team_name=excluded.team_name,
      device_id=excluded.device_id,
      device_name=excluded.device_name,
      imported_by=excluded.imported_by,
      reviewer_name=excluded.reviewer_name,
      file_name=excluded.file_name,
      camera_no=excluded.camera_no,
      camera_check_id=excluded.camera_check_id,
      check_no=excluded.check_no,
      checked_date=excluded.checked_date,
      relative_path=excluded.relative_path,
      ai_prediction=excluded.ai_prediction,
      ai_confidence=excluded.ai_confidence,
      ai_second_choice=excluded.ai_second_choice,
      ai_note=excluded.ai_note,
      confirmed_label=excluded.confirmed_label,
      human_verified=excluded.human_verified,
      needs_extra_review=excluded.needs_extra_review,
      status=excluded.status,
      image_blob=COALESCE(excluded.image_blob, sightings.image_blob),
      image_type=COALESCE(excluded.image_type, sightings.image_type),
      captured_at=COALESCE(NULLIF(excluded.captured_at,''), sightings.captured_at),
      verified_at=excluded.verified_at,
      updated_at=excluded.updated_at
  `).bind(
    id,
    clean(r.reviewedTeam || r.teamName, 120),
    clean(r.reviewedDeviceId || r.deviceId, 120),
    clean(r.reviewedDevice || r.deviceName, 120),
    clean(r.importedBy, 120),
    clean(r.reviewedBy, 120),
    fileName,
    clean(r.cameraNo, 80),
    clean(r.cameraCheckId, 160),
    Math.max(0, int(r.checkNo)),
    clean(r.checkedDate, 30),
    clean(r.path, 1000),
    clean(r.aiPrediction, 40),
    int(r.aiConfidence),
    clean(r.aiSecondChoice, 40),
    clean(r.aiNote, 300),
    clean(r.label, 40),
    r.verified ? 1 : 0,
    r.aiNeedsExtraReview ? 1 : 0,
    status,
    imageBytes,
    imageType,
    clean(r.capturedAt, 50),
    clean(r.verifiedAt, 50),
    clean(r.createdAt, 50) || now,
    clean(r.updatedAt, 50) || now
  ).run();

  return reply({ ok: true, id, status, sharedReady: true }, 200, origin);
}

async function handleTeamList(input, env, origin, status) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false, records: [] }, 503, origin);
  }
  await ensureSchema(env);

  if (status === "review") {
    await env.KAITIAKI_DB.prepare(`
      UPDATE sightings AS old
      SET status='resolved',
          needs_extra_review=0,
          updated_at=CASE
            WHEN old.updated_at IS NULL OR old.updated_at='' THEN datetime('now')
            ELSE old.updated_at
          END
      WHERE old.status='review'
        AND old.file_name<>''
        AND old.captured_at<>''
        AND EXISTS (
          SELECT 1
          FROM sightings AS newer
          WHERE newer.id<>old.id
            AND newer.human_verified=1
            AND newer.file_name=old.file_name
            AND (
              newer.captured_at=old.captured_at
              OR (
                COALESCE(newer.relative_path,'')<>''
                AND newer.relative_path=old.relative_path
              )
            )
        )
    `).run();
  }
  const limit = Math.max(1, Math.min(500, int(input?.limit, 100)));
  const team = clean(input?.team, 120);
  const cameraNo = clean(input?.cameraNo, 80);
  const cameraCheckId = clean(input?.cameraCheckId, 160);

  const select = `
      SELECT id, team_name, device_id, device_name, imported_by, reviewer_name,
        file_name, camera_no, camera_check_id, check_no, checked_date, relative_path, ai_prediction, ai_confidence, ai_second_choice,
        ai_note, confirmed_label, human_verified, needs_extra_review, status,
        CASE WHEN image_blob IS NULL THEN 0 ELSE 1 END AS has_image,
        captured_at, verified_at, created_at, updated_at
      FROM sightings`;
  let stmt;
  if (cameraCheckId) {
    stmt = env.KAITIAKI_DB.prepare(select + " WHERE status=? AND camera_check_id=? ORDER BY captured_at ASC, updated_at ASC LIMIT ?").bind(status, cameraCheckId, limit);
  } else if (team && cameraNo) {
    stmt = env.KAITIAKI_DB.prepare(select + " WHERE status=? AND team_name=? AND camera_no=? ORDER BY captured_at ASC, updated_at ASC LIMIT ?").bind(status, team, cameraNo, limit);
  } else if (team) {
    stmt = env.KAITIAKI_DB.prepare(select + " WHERE status=? AND team_name=? ORDER BY updated_at DESC LIMIT ?").bind(status, team, limit);
  } else if (cameraNo) {
    stmt = env.KAITIAKI_DB.prepare(select + " WHERE status=? AND camera_no=? ORDER BY captured_at ASC, updated_at ASC LIMIT ?").bind(status, cameraNo, limit);
  } else {
    stmt = env.KAITIAKI_DB.prepare(select + " WHERE status=? ORDER BY updated_at DESC LIMIT ?").bind(status, limit);
  }
  const result = await stmt.all();
  return reply({ sharedReady: true, records: result.results || [] }, 200, origin);
}

async function handleTeamReviewResolve(input, env, origin) {
  if (!sharedConfigured(env)) return reply({ error: "Shared database is not connected yet" }, 503, origin);
  await ensureSchema(env);
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids.map(v => clean(v, 100)).filter(Boolean))].slice(0, 500) : [];
  if (!ids.length) return reply({ error: "No review records supplied" }, 400, origin);
  let resolved = 0;
  for (const id of ids) {
    const result = await env.KAITIAKI_DB.prepare(
      "UPDATE sightings SET status='resolved', needs_extra_review=0, updated_at=? WHERE id=? AND status='review'"
    ).bind(new Date().toISOString(), id).run();
    resolved += Number(result?.meta?.changes || 0);
  }
  return reply({ ok: true, resolved, sharedReady: true }, 200, origin);
}

async function handleTeamImage(input, env, origin) {
  if (!sharedConfigured(env)) return reply({ error: "Shared database is not connected yet" }, 503, origin);
  await ensureSchema(env);
  const id = clean(input?.id, 100);
  if (!id) return reply({ error: "Missing image id" }, 400, origin);

  const row = await env.KAITIAKI_DB.prepare(
    "SELECT image_blob, image_type FROM sightings WHERE id=?"
  ).bind(id).first();
  if (!row?.image_blob) return reply({ error: "Image not found" }, 404, origin);

  const bytes = Array.isArray(row.image_blob)
    ? Uint8Array.from(row.image_blob)
    : row.image_blob instanceof Uint8Array
      ? row.image_blob
      : row.image_blob instanceof ArrayBuffer
        ? new Uint8Array(row.image_blob)
        : null;
  if (!bytes) return reply({ error: "Invalid stored image" }, 500, origin);

  const type = row.image_type || "image/jpeg";
  return reply({
    imageData: "data:" + type + ";base64," + bytesToBase64(bytes)
  }, 200, origin);
}

async function handleCameraCheckAudit(input, env, origin) {
  if (!sharedConfigured(env)) return reply({ error: "Shared team database is not connected yet", sharedReady: false }, 503, origin);
  // Strictly read-only: do not call ensureSchema here because it can alter existing sighting statuses.
  // If the tables/columns are missing, fail visibly rather than mutating the database during an audit.
  const cameraNos = [...new Set((Array.isArray(input?.cameraNos) ? input.cameraNos : [])
    .map(v => clean(v, 80).toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!cameraNos.length) return reply({ error: "Choose at least one camera to inspect" }, 400, origin);
  const placeholders = cameraNos.map(() => "?").join(",");
  const [checkResult, rowResult] = await Promise.all([
    env.KAITIAKI_DB.prepare(`
      SELECT id, camera_no, check_no, checked_date, report_year, total_possum
      FROM camera_checks WHERE UPPER(camera_no) IN (${placeholders})
      ORDER BY camera_no, checked_date, check_no
    `).bind(...cameraNos).all(),
    env.KAITIAKI_DB.prepare(`
      SELECT id, camera_no, camera_check_id, check_no, checked_date, file_name, relative_path,
        ai_prediction, confirmed_label, human_verified, status, captured_at, created_at, updated_at
      FROM sightings
      WHERE UPPER(COALESCE(camera_no,'')) IN (${placeholders})
         OR camera_check_id IN (SELECT id FROM camera_checks WHERE UPPER(camera_no) IN (${placeholders}))
    `).bind(...cameraNos, ...cameraNos).all()
  ]);
  const checks = checkResult.results || [], rows = rowResult.results || [];
  const checksById = new Map(checks.map(c => [String(c.id), c]));
  const groups = new Map();
  for (const c of checks) {
    const camera = String(c.camera_no || "").trim().toUpperCase();
    const year = Number(c.report_year) || Number(String(c.checked_date || "").slice(0,4));
    const key = camera + "|" + year;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const group of groups.values()) group.sort((a,b) =>
    String(a.checked_date || "").slice(0,10).localeCompare(String(b.checked_date || "").slice(0,10)) ||
    Number(a.check_no || 0)-Number(b.check_no || 0));
  const perCheck = new Map(checks.map(c => [String(c.id), {
    id:String(c.id), cameraNo:c.camera_no, checkNo:Number(c.check_no)||0, checkedDate:String(c.checked_date||"").slice(0,10),
    reportImages:Number(c.total_possum)||0, reportYear:Number(c.report_year)||Number(String(c.checked_date||"").slice(0,4)),
    linkedPossumRecords:0, datedPossumRecords:0, capturedInReportYear:0, capturedOutsideReportYear:0, uniqueFileTimeSignatures:0,
    exactDuplicateCandidates:0, missingCaptureDate:0, otherYear:0, noCheckLink:0, dateRuleWouldMove:0,
    samples:[], missingDateSamples:[], signatures:new Map()
  }]));
  const orphan = { totalPossum:0, missingCaptureDate:0, noCheckLink:0, dateRuleWouldMove:0, sample:[] };
  const oxic1LinkedRecordDetails = [];
  const signatureCounts = new Map();
  const possumRows = rows.filter(r => {
    const label = Number(r.human_verified) ? (r.confirmed_label || r.ai_prediction) : r.ai_prediction;
    return label === "Possum" && r.status !== "ignored";
  });
  // Read-only recovery hints: locate dated records from the same camera with matching
  // relative path or filename. These are suggestions only; no dates are copied.
  const datedByPath = new Map(), datedByFile = new Map();
  for (const row of rows) {
    if (!row.captured_at) continue;
    const camera = String(row.camera_no || checksById.get(String(row.camera_check_id||""))?.camera_no || "").trim().toUpperCase();
    const path = String(row.relative_path || "").trim().toLowerCase();
    const file = String(row.file_name || "").trim().toLowerCase();
    if (!camera) continue;
    if (path) {
      const key = camera+"|"+path;
      if (!datedByPath.has(key)) datedByPath.set(key, []);
      datedByPath.get(key).push(row);
    }
    if (file) {
      const key = camera+"|"+file;
      if (!datedByFile.has(key)) datedByFile.set(key, []);
      datedByFile.get(key).push(row);
    }
  }
  const recoveryCandidates = [];
  for (const row of possumRows) {
    if (row.captured_at) continue;
    const camera = String(row.camera_no || checksById.get(String(row.camera_check_id||""))?.camera_no || "").trim().toUpperCase();
    const path = String(row.relative_path || "").trim().toLowerCase();
    const file = String(row.file_name || "").trim().toLowerCase();
    // Require the same filename for every candidate. A path match alone can be
    // misleading when relative_path stores only a folder or was imported inconsistently.
    const sameFile = (file ? (datedByFile.get(camera+"|"+file)||[]) : [])
      .filter(m => String(m.id)!==String(row.id));
    const unique = [...new Map(sameFile.map(m=>[String(m.id),m])).values()];
    if (unique.length && recoveryCandidates.length < 100) recoveryCandidates.push({
      cameraNo:camera, fileName:row.file_name||"", relativePath:row.relative_path||"", recordId:row.id,
      recordStatus:row.status||"", recordLabel:Number(row.human_verified)?(row.confirmed_label||row.ai_prediction):row.ai_prediction||"",
      recordCheckNo:row.check_no??null, recordCheckedDate:row.checked_date||"",
      recordCameraCheckId:row.camera_check_id||"",
      recordCheckLinkValid:perCheck.has(String(row.camera_check_id||"")),
      recordCreatedAt:row.created_at||"", recordUpdatedAt:row.updated_at||"",
      matches:unique.slice(0,3).map(m=>({
        recordId:m.id,fileName:m.file_name||"",relativePath:m.relative_path||"",
        matchType: String(m.relative_path||"").trim().toLowerCase()===path && path ? "same filename + exact path" : "same filename only",
        capturedAt:m.captured_at||"",createdAt:m.created_at||"",
        creationGapSeconds: row.created_at && m.created_at
          ? Math.round((Date.parse(m.created_at)-Date.parse(row.created_at))/1000) : null,
        sameCreationBatch: Boolean(row.created_at && m.created_at &&
          Math.abs(Date.parse(m.created_at)-Date.parse(row.created_at)) <= 120000),
        label:Number(m.human_verified)?(m.confirmed_label||m.ai_prediction):m.ai_prediction||""
      }))
    });
  }

  // Compare exact stored image bytes for candidate pairs where blobs exist.
  // This is read-only and intentionally does not infer a match from filename/date alone.
  const candidateIds = [...new Set(recoveryCandidates.flatMap(c => [
    String(c.recordId), ...(c.matches||[]).map(m => String(m.recordId))
  ]))];
  const imageHashes = new Map();
  for (let offset=0; offset<candidateIds.length; offset+=80) {
    const ids = candidateIds.slice(offset, offset+80);
    const marks = ids.map(()=>"?").join(",");
    const blobRows = await env.KAITIAKI_DB.prepare(
      `SELECT id, image_blob FROM sightings WHERE id IN (${marks})`
    ).bind(...ids).all();
    for (const imageRow of (blobRows.results||[])) {
      if (!imageRow.image_blob) continue;
      const bytes = Array.isArray(imageRow.image_blob) ? Uint8Array.from(imageRow.image_blob)
        : imageRow.image_blob instanceof Uint8Array ? imageRow.image_blob
        : imageRow.image_blob instanceof ArrayBuffer ? new Uint8Array(imageRow.image_blob) : null;
      if (!bytes) continue;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
      imageHashes.set(String(imageRow.id), hex);
    }
  }
  for (const candidate of recoveryCandidates) {
    const missingHash = imageHashes.get(String(candidate.recordId)) || "";
    candidate.hasStoredImage = Boolean(missingHash);
    candidate.matches = (candidate.matches||[]).map(match => {
      const candidateHash = imageHashes.get(String(match.recordId)) || "";
      return {...match, hasStoredImage: Boolean(candidateHash),
        exactImageBytesMatch: Boolean(missingHash && candidateHash && missingHash===candidateHash),
        imageHashPrefix: candidateHash ? candidateHash.slice(0,12) : ""};
    });
  }

  for (const r of possumRows) {
    const camera = String(r.camera_no || checksById.get(String(r.camera_check_id||""))?.camera_no || "").trim().toUpperCase();
    const captured = String(r.captured_at || "").slice(0,10);
    const currentId = String(r.camera_check_id || "");
    const current = perCheck.get(currentId);
    const sig = camera+"|"+String(r.file_name||"").trim().toLowerCase()+"|"+String(r.captured_at||"").trim();
    if (sig !== "|") signatureCounts.set(sig,(signatureCounts.get(sig)||0)+1);
    if (current) {
      if (camera === "OXIC1" && oxic1LinkedRecordDetails.length < 300) oxic1LinkedRecordDetails.push({
        cameraNo: camera, recordId: r.id, cameraCheckId: currentId,
        checkNo: current.checkNo, checkedDate: current.checkedDate,
        capturedAt: r.captured_at || "", fileName: r.file_name || "",
        relativePath: r.relative_path || "", status: r.status || "",
        createdAt: r.created_at || "", updatedAt: r.updated_at || ""
      });
      current.linkedPossumRecords++;
      if (!captured) {
        current.missingCaptureDate++;
        if (current.missingDateSamples.length < 25) current.missingDateSamples.push({
          fileName:r.file_name||"", relativePath:r.relative_path||"", recordId:r.id,
          createdAt:r.created_at||"", updatedAt:r.updated_at||"", cameraCheckId:r.camera_check_id||""
        });
      } else {
        current.datedPossumRecords++;
        if (Number(captured.slice(0,4)) === current.reportYear) current.capturedInReportYear++;
        else current.capturedOutsideReportYear++;
        if (Number(captured.slice(0,4)) !== current.reportYear) current.otherYear++;
      }
      current.signatures.set(sig,(current.signatures.get(sig)||0)+1);
      if (current.samples.length<8) current.samples.push({fileName:r.file_name||"",capturedAt:r.captured_at||"",recordId:r.id,relativePath:r.relative_path||""});
    } else {
      orphan.totalPossum++;
      if (!captured) orphan.missingCaptureDate++;
      if (!currentId) orphan.noCheckLink++;
      if (orphan.sample.length<12) orphan.sample.push({cameraNo:camera,fileName:r.file_name||"",capturedAt:r.captured_at||"",recordId:r.id});
    }
    if (!captured || !camera) continue;
    const year=Number(captured.slice(0,4)),group=groups.get(camera+"|"+year);
    if (!group) continue;
    const target=group.find(c=>String(c.checked_date||"").slice(0,10)>=captured);
    if (target && String(target.id)!==currentId && current) current.dateRuleWouldMove++;
    if (target && String(target.id)!==currentId && !current) orphan.dateRuleWouldMove++;
  }
  const result = [...perCheck.values()].map(c=>{
    const dup=[...c.signatures.values()].reduce((n,v)=>n+Math.max(0,v-1),0);
    return {id:c.id,cameraNo:c.cameraNo,checkNo:c.checkNo,checkedDate:c.checkedDate,reportYear:c.reportYear,reportImages:c.reportImages,
      linkedPossumRecords:c.linkedPossumRecords,datedPossumRecords:c.datedPossumRecords,
      capturedInReportYear:c.capturedInReportYear,capturedOutsideReportYear:c.capturedOutsideReportYear,
      reportVsDatedDelta:c.reportImages-c.capturedInReportYear,uniqueFileTimeSignatures:c.signatures.size,
      exactDuplicateCandidates:dup,missingCaptureDate:c.missingCaptureDate,otherYear:c.otherYear,
      dateRuleWouldMove:c.dateRuleWouldMove,samples:c.samples,missingDateSamples:c.missingDateSamples};
  });
  return reply({sharedReady:true,checks:result,orphan,recordsInspected:rows.length,possumsInspected:possumRows.length,
    oxic1LinkedRecordDetails, oxic1LinkedRecordCount: oxic1LinkedRecordDetails.length,
    recoveryCandidates, recoveryCandidateCount:recoveryCandidates.length,
    exactDuplicateCandidates:[...signatureCounts.values()].reduce((n,v)=>n+Math.max(0,v-1),0)},200,origin);
}

async function handleCameraCheckReconcile(input, env, origin) {
  if (!sharedConfigured(env)) return reply({ error: "Shared team database is not connected yet", sharedReady: false }, 503, origin);
  await ensureSchema(env);
  const cameraNos = [...new Set((Array.isArray(input?.cameraNos) ? input.cameraNos : [])
    .map(v => clean(v, 80).toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!cameraNos.length) return reply({ error: "Choose at least one camera to reconcile" }, 400, origin);

  const checkResult = await env.KAITIAKI_DB.prepare(`
    SELECT id, camera_no, check_no, checked_date, report_year, total_possum,
      monthly_possum_json, latest_possum_date, approx_presence, updated_at, created_at
    FROM camera_checks
  `).all();
  const allChecks = checkResult.results || [];
  const byId = new Map(allChecks.map(c => [String(c.id), c]));
  const selectedChecks = allChecks.filter(c => cameraNos.includes(String(c.camera_no || "").trim().toUpperCase()));
  const canonical = new Map(), duplicateIdMap = new Map();
  for (const c of selectedChecks) {
    const camera = String(c.camera_no || "").trim().toUpperCase();
    const no = Number(c.check_no) || 0;
    const date = String(c.checked_date || "").slice(0, 10);
    if (!camera || !no || !date) continue;
    const key = camera + "|" + no + "|" + date;
    const old = canonical.get(key);
    if (!old) canonical.set(key, c);
    else {
      const keep = String(c.updated_at || c.created_at || "") > String(old.updated_at || old.created_at || "") ? c : old;
      const lose = keep === c ? old : c;
      canonical.set(key, keep);
      duplicateIdMap.set(String(lose.id), String(keep.id));
    }
  }
  const checks = [...canonical.values()];
  const checkById = new Map(allChecks.map(c => [String(c.id), c]));
  for (const [oldId, newId] of duplicateIdMap) {
    const old = checkById.get(oldId), keep = checkById.get(newId);
    if (old && keep) checkById.set(oldId, { ...old, camera_no: keep.camera_no, check_no: keep.check_no, checked_date: keep.checked_date, report_year: keep.report_year, canonical_id: newId });
  }

  const groups = new Map();
  for (const c of checks) {
    const camera = String(c.camera_no || "").trim().toUpperCase();
    const year = Number(c.report_year) || Number(String(c.checked_date || "").slice(0, 4));
    if (!camera || !year || !String(c.checked_date || "").slice(0, 10)) continue;
    const key = camera + "|" + year;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const ambiguous = new Set();
  for (const [key, group] of groups) {
    group.sort((a,b) => String(a.checked_date).localeCompare(String(b.checked_date)) || Number(a.check_no)-Number(b.check_no));
    const dates = new Map();
    for (const c of group) {
      const d = String(c.checked_date).slice(0,10);
      dates.set(d, (dates.get(d) || 0) + 1);
    }
    if ([...dates.values()].some(n => n > 1)) ambiguous.add(key);
  }

  const ids = checks.map(c => String(c.id));
  const placeholders = cameraNos.map(() => "?").join(",");
  const rowQuery = await env.KAITIAKI_DB.prepare(`
    SELECT id, camera_no, camera_check_id, check_no, checked_date, file_name, relative_path,
      ai_prediction, confirmed_label, human_verified, status, captured_at
    FROM sightings
    WHERE UPPER(COALESCE(camera_no,'')) IN (${placeholders})
       OR camera_check_id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"})
       OR camera_check_id IN (${duplicateIdMap.size ? [...duplicateIdMap.keys()].map(() => "?").join(",") : "NULL"})
  `).bind(...cameraNos, ...ids, ...duplicateIdMap.keys()).all();
  const rows = rowQuery.results || [];
  const now = new Date().toISOString();
  let moved = 0;
  let noCamera = 0, noCaptureDate = 0, noCheckGroup = 0, ambiguousSkipped = 0, noLaterCheck = 0, alreadyCorrect = 0;
  const changedRows = [];
  for (const r of rows) {
    const currentId = String(r.camera_check_id || "");
    const linkedCheck = checkById.get(currentId);
    const camera = String(r.camera_no || linkedCheck?.camera_no || "").trim().toUpperCase();
    if (!cameraNos.includes(camera)) { noCamera++; continue; }
    const captured = String(r.captured_at || "").slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(captured)) { noCaptureDate++; continue; }
    const year = Number(captured.slice(0,4));
    const key = camera + "|" + year;
    const group = groups.get(key);
    if (!group) { noCheckGroup++; continue; }
    if (ambiguous.has(key)) { ambiguousSkipped++; continue; }
    if (linkedCheck && String(linkedCheck.camera_no || "").trim().toUpperCase() !== camera) continue;
    const target = group.find(c => String(c.checked_date).slice(0,10) >= captured);
    if (!target) { noLaterCheck++; continue; }
    const canonicalTargetId = duplicateIdMap.get(String(target.id)) || String(target.id);
    if (currentId === canonicalTargetId &&
        Number(r.check_no) === Number(target.check_no) &&
        String(r.checked_date || "").slice(0,10) === String(target.checked_date).slice(0,10)) { alreadyCorrect++; continue; }
    await env.KAITIAKI_DB.prepare(`
      UPDATE sightings SET camera_no=?, camera_check_id=?, check_no=?, checked_date=?, updated_at=? WHERE id=?
    `).bind(camera, canonicalTargetId, Number(target.check_no)||0, String(target.checked_date).slice(0,10), now, r.id).run();
    moved++;
    changedRows.push({ id:r.id, camera, targetId:canonicalTargetId });
  }

  const freshResult = await env.KAITIAKI_DB.prepare(`
    SELECT id, camera_no, camera_check_id, file_name, ai_prediction, confirmed_label,
      human_verified, status, captured_at
    FROM sightings
    WHERE UPPER(COALESCE(camera_no,'')) IN (${placeholders})
       OR camera_check_id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"})
  `).bind(...cameraNos, ...ids).all();
  const freshRows = freshResult.results || [];
  let updatedChecks = 0;
  const details = [];
  for (const c of checks) {
    const camera = String(c.camera_no || "").trim().toUpperCase();
    const year = Number(c.report_year) || Number(String(c.checked_date || "").slice(0,4));
    const monthly = Array(12).fill(0), seen = new Set();
    let latest = "";
    for (const r of freshRows) {
      if (String(r.camera_check_id || "") !== String(c.id)) continue;
      const label = Number(r.human_verified) ? (r.confirmed_label || r.ai_prediction) : r.ai_prediction;
      if (label !== "Possum" || r.status === "ignored") continue;
      const captured = String(r.captured_at || "").slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(captured) || Number(captured.slice(0,4)) !== year) continue;
      const sig = String(r.file_name || r.id) + "|" + captured + "|" + String(r.captured_at || "");
      if (seen.has(sig)) continue;
      seen.add(sig);
      const month = Number(captured.slice(5,7))-1;
      if (month >= 0 && month < 12) monthly[month]++;
      if (captured > latest) latest = captured;
    }
    const total = monthly.reduce((sum,n)=>sum+n,0);
    const presence = total===0 ? "None" : total<=9 ? "Low" : total<=15 ? "Medium" : "High";
    const oldMonthly = (()=>{try{return JSON.parse(c.monthly_possum_json||"[]")}catch{return []}})();
    const sameMonthly = Array.from({length:12},(_,i)=>Number(oldMonthly[i]||0)).every((n,i)=>n===monthly[i]);
    const changed = Number(c.total_possum||0)!==total ||
      String(c.latest_possum_date||"")!==latest ||
      String(c.approx_presence||"")!==presence || !sameMonthly;
    if (changed) {
      await env.KAITIAKI_DB.prepare(`
        UPDATE camera_checks SET total_possum=?, monthly_possum_json=?, latest_possum_date=?,
          approx_presence=?, updated_at=? WHERE id=?
      `).bind(total, JSON.stringify(monthly), latest, presence, now, c.id).run();
      updatedChecks++;
    }
    details.push({ cameraNo:camera, checkNo:Number(c.check_no)||0, checkedDate:String(c.checked_date||"").slice(0,10), totalPossum:total, updated:changed });
  }
  return reply({
    ok:true, sharedReady:true, moved, updatedChecks,
    ambiguousCameras:ambiguous.size,
    diagnostics:{rowsFound:rows.length,noCamera,noCaptureDate,noCheckGroup,ambiguousSkipped,noLaterCheck,alreadyCorrect},
    message:"Links were matched to the next check date for the same camera. Ambiguous same-day runs were left unchanged.",
    checks:details
  }, 200, origin);
}

async function handleCameraCheckSync(input, env, origin) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false }, 503, origin);
  }
  const c = input?.check || {};
  const id = clean(c.id, 160);
  const cameraNo = clean(c.cameraNo, 80);
  if (!id || !cameraNo) return reply({ error: "Camera check id and camera number are required" }, 400, origin);

  await ensureSchema(env);
  const now = new Date().toISOString();
  const monthly = Array.isArray(c.monthlyPossum) ? c.monthlyPossum.slice(0, 12).map(v => Math.max(0, int(v))) : Array(12).fill(0);
  while (monthly.length < 12) monthly.push(0);
  const species = c.speciesCounts && typeof c.speciesCounts === "object" ? c.speciesCounts : {};

  await env.KAITIAKI_DB.prepare(`
    INSERT INTO camera_checks (
      id, team_name, device_id, device_name, camera_no, zone, block_name, camera_status,
      check_no, checked_date, serviced_by, classified_date, first_image_date, last_image_date, latest_possum_date,
      approx_presence, classified_by, report_year, monthly_possum_json, species_json,
      total_possum, images_processed, meaningful_count, skipped_count, human_count, unsure_count,
      notes, issues_notes, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      team_name=excluded.team_name,
      device_id=excluded.device_id,
      device_name=excluded.device_name,
      camera_no=excluded.camera_no,
      zone=excluded.zone,
      block_name=excluded.block_name,
      camera_status=excluded.camera_status,
      check_no=excluded.check_no,
      checked_date=excluded.checked_date,
      serviced_by=excluded.serviced_by,
      classified_date=excluded.classified_date,
      first_image_date=excluded.first_image_date,
      last_image_date=excluded.last_image_date,
      latest_possum_date=excluded.latest_possum_date,
      approx_presence=excluded.approx_presence,
      classified_by=excluded.classified_by,
      report_year=excluded.report_year,
      monthly_possum_json=excluded.monthly_possum_json,
      species_json=excluded.species_json,
      total_possum=excluded.total_possum,
      images_processed=excluded.images_processed,
      meaningful_count=excluded.meaningful_count,
      skipped_count=excluded.skipped_count,
      human_count=excluded.human_count,
      unsure_count=excluded.unsure_count,
      notes=excluded.notes,
      issues_notes=excluded.issues_notes,
      updated_at=excluded.updated_at
  `).bind(
    id,
    clean(c.teamName, 120),
    clean(c.deviceId, 120),
    clean(c.deviceName, 120),
    cameraNo,
    clean(c.zone, 120),
    clean(c.block, 120),
    clean(c.status, 40),
    Math.max(0, int(c.checkNo)),
    clean(c.checkedDate, 30),
    clean(c.servicedBy, 120),
    clean(c.classifiedDate, 30),
    clean(c.firstImageDate, 30),
    clean(c.lastImageDate, 30),
    clean(c.latestPossumDate, 30),
    clean(c.approxPresence, 40),
    clean(c.classifiedBy, 120),
    Math.max(2000, Math.min(2100, int(c.reportYear, new Date().getFullYear()))),
    JSON.stringify(monthly),
    JSON.stringify(species),
    Math.max(0, int(c.totalPossum)),
    Math.max(0, int(c.imagesProcessed)),
    Math.max(0, int(c.meaningfulCount)),
    Math.max(0, int(c.skippedCount)),
    Math.max(0, int(c.humanCount)),
    Math.max(0, int(c.unsureCount)),
    clean(c.notes, 1000),
    clean(c.issuesNotes, 1000),
    clean(c.createdAt, 50) || now,
    clean(c.updatedAt, 50) || now
  ).run();

  return reply({ ok: true, id, sharedReady: true }, 200, origin);
}

async function handleCameraChecks(input, env, origin) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false, checks: [] }, 503, origin);
  }
  await ensureSchema(env);
  const limit = Math.max(1, Math.min(1000, int(input?.limit, 500)));
  const result = await env.KAITIAKI_DB.prepare(`
    SELECT id, team_name, device_id, device_name, camera_no, zone, block_name, camera_status,
      check_no, checked_date, serviced_by, classified_date, first_image_date, last_image_date, latest_possum_date,
      approx_presence, classified_by, report_year, monthly_possum_json, species_json,
      total_possum, images_processed, meaningful_count, skipped_count, human_count, unsure_count,
      notes, issues_notes, created_at, updated_at
    FROM camera_checks
    ORDER BY checked_date DESC, updated_at DESC
    LIMIT ?
  `).bind(limit).all();

  const checks = (result.results || []).map(row => ({
    id: row.id,
    teamName: row.team_name || "",
    deviceId: row.device_id || "",
    deviceName: row.device_name || "",
    cameraNo: row.camera_no || "",
    zone: row.zone || "",
    block: row.block_name || "",
    status: row.camera_status || "",
    checkNo: row.check_no || 0,
    checkedDate: row.checked_date || "",
    servicedBy: row.serviced_by || "",
    classifiedDate: row.classified_date || "",
    firstImageDate: row.first_image_date || "",
    lastImageDate: row.last_image_date || "",
    latestPossumDate: row.latest_possum_date || "",
    approxPresence: row.approx_presence || "",
    classifiedBy: row.classified_by || "",
    reportYear: row.report_year || new Date().getFullYear(),
    monthlyPossum: (() => { try { return JSON.parse(row.monthly_possum_json || "[]"); } catch { return []; } })(),
    speciesCounts: (() => { try { return JSON.parse(row.species_json || "{}"); } catch { return {}; } })(),
    totalPossum: row.total_possum || 0,
    imagesProcessed: row.images_processed || 0,
    meaningfulCount: row.meaningful_count || 0,
    skippedCount: row.skipped_count || 0,
    humanCount: row.human_count || 0,
    unsureCount: row.unsure_count || 0,
    notes: row.notes || "",
    issuesNotes: row.issues_notes || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  }));
  return reply({ sharedReady: true, checks }, 200, origin);
}

async function handleProjectLeadDashboard(input, env, origin) {
  const response = await handleCameraChecks(input, env, origin);
  const data = await response.json();
  return reply({ ...data, role: "project_lead", readOnly: true }, response.status, origin);
}

async function handleClassification(request, env, origin) {
  if (!env.GEMINI_API_KEY || !env.KAITIAKI_ACCESS_TOKEN) {
    return reply({ error: "Server not configured" }, 503, origin);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BASE64) {
    return reply({ error: "Image too large" }, 413, origin);
  }

  let input;
  try { input = await request.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400, origin); }

  const image = input && input.image;
  const match = typeof image === "string" &&
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match || image.length > MAX_IMAGE_BASE64) {
    return reply({ error: "Invalid or oversized image" }, 400, origin);
  }

  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        { text: GUIDE },
        { inline_data: { mime_type: "image/" + match[1], data: match[2] } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING", enum: LABELS },
          confidence: { type: "INTEGER" },
          second_choice: { type: "STRING", enum: [...LABELS, "null"] },
          note: { type: "STRING" }
        },
        required: ["label", "confidence", "note"]
      },
      maxOutputTokens: 300,
      temperature: 0
    }
  };

  let upstream;
  try {
    upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );
  } catch {
    return reply({ error: "Gemini service unavailable" }, 502, origin);
  }

  if (upstream.status === 429) {
    return reply({ error: "Gemini quota or rate limit reached. Check your project limits before retrying." }, 429, origin);
  }
  if (!upstream.ok) return reply({ error: "Gemini service returned " + upstream.status }, 502, origin);

  let result;
  try {
    const payload = await upstream.json();
    result = JSON.parse(payload.candidates[0].content.parts.map(part => part.text || "").join(""));
  } catch {
    return reply({ error: "Invalid Gemini response" }, 502, origin);
  }

  const rawSecondChoice = result?.second_choice;
  const secondChoice =
    rawSecondChoice === null || rawSecondChoice === undefined ||
    rawSecondChoice === "" || rawSecondChoice === "null" ? null : rawSecondChoice;

  if (
    !result || !LABELS.includes(result.label) ||
    !Number.isInteger(result.confidence) ||
    result.confidence < 0 || result.confidence > 100 ||
    (secondChoice !== null && !LABELS.includes(secondChoice)) ||
    typeof result.note !== "string"
  ) return reply({ error: "Unexpected model classification" }, 502, origin);

  return reply({
    label: result.label,
    confidence: result.confidence,
    second_choice: secondChoice,
    note: result.note.slice(0, 300),
    modelId: MODEL,
    requiresHumanConfirmation: result.label === "Unsure" || result.confidence < 95,
    review: result.label === "Unsure" || result.confidence < 95
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const expected = env.ALLOWED_ORIGIN || "https://mine4079-lgtm.github.io";
    const url = new URL(request.url);
    try {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin === expected ? origin : "",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-max-age": "600",
          "vary": "Origin"
        }
      });
    }

    if (origin !== expected) return reply({ error: "Origin not allowed" }, 403, "");

    if (request.method === "GET" && url.pathname === "/") {
      return reply({
        ready: !!(env.GEMINI_API_KEY && env.KAITIAKI_ACCESS_TOKEN),
        sharedReady: sharedConfigured(env),
        service: "kaitiaki-next-gemini",
        modelId: MODEL
      }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/session") {
      const parsed = await rolePayload(request, env);
      if (parsed.error) return reply({ error: parsed.error }, parsed.error === "Not authorised" ? 401 : 400, origin);
      return reply({ ok: true, role: parsed.role }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/project-lead/dashboard") {
      if (Number(request.headers.get("content-length") || 0) > MAX_SYNC_BODY) {
        return reply({ error: "Project Lead request too large" }, 413, origin);
      }
      const parsed = await rolePayload(request, env, "project_lead");
      if (parsed.error) return reply({ error: parsed.error }, parsed.error === "Not authorised" ? 401 : 400, origin);
      return handleProjectLeadDashboard(parsed.input, env, origin);
    }

    if (request.method === "POST" && url.pathname.startsWith("/team/")) {
      if (Number(request.headers.get("content-length") || 0) > MAX_SYNC_BODY) {
        return reply({ error: "Team request too large" }, 413, origin);
      }
      const parsed = await teamPayload(request, env);
      if (parsed.error) return reply({ error: parsed.error }, parsed.error === "Not authorised" ? 401 : 400, origin);
      if (url.pathname === "/team/sync") return handleTeamSync(parsed.input, env, origin);
      if (url.pathname === "/team/sightings") return handleTeamList(parsed.input, env, origin, "sighting");
      if (url.pathname === "/team/review") return handleTeamList(parsed.input, env, origin, "review");
      if (url.pathname === "/team/review-resolve") return handleTeamReviewResolve(parsed.input, env, origin);
      if (url.pathname === "/team/image") return handleTeamImage(parsed.input, env, origin);
      if (url.pathname === "/team/camera-check-audit") return handleCameraCheckAudit(parsed.input, env, origin);
      if (url.pathname === "/team/camera-check-reconcile") return handleCameraCheckReconcile(parsed.input, env, origin);
      if (url.pathname === "/team/camera-check-sync") return handleCameraCheckSync(parsed.input, env, origin);
      if (url.pathname === "/team/camera-checks") return handleCameraChecks(parsed.input, env, origin);
      return reply({ error: "Not found" }, 404, origin);
    }

    if (!authorised(request, env)) return reply({ error: "Not authorised" }, 401, origin);

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/classify")) {
      return handleClassification(request, env, origin);
    }

    return reply({ error: "Not found" }, 404, origin);
    } catch (error) {
      return reply({
        error: "Worker error",
        detail: String(error?.message || error || "Unknown error"),
        path: url.pathname
      }, 500, origin === expected ? origin : "");
    }
  }
};
