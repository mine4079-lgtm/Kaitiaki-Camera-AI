/* Kaitiaki Camera AI — Gemini classifier + shared team sightings backend.
 * Required Worker secrets: GEMINI_API_KEY and KAITIAKI_ACCESS_TOKEN.
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

function authorised(request, env) {
  return !!env.KAITIAKI_ACCESS_TOKEN &&
    request.headers.get("Authorization") === "Bearer " + env.KAITIAKI_ACCESS_TOKEN;
}

async function teamPayload(request, env) {
  let input;
  try { input = JSON.parse(await request.text()); }
  catch { return { error: "Invalid team request" }; }
  if (!env.KAITIAKI_ACCESS_TOKEN || input?.token !== env.KAITIAKI_ACCESS_TOKEN) {
    return { error: "Not authorised" };
  }
  return { input };
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
      captured_at=excluded.captured_at,
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
            AND newer.captured_at=old.captured_at
            AND COALESCE(newer.updated_at,'')>=COALESCE(old.updated_at,'')
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

    if (request.method === "POST" && url.pathname.startsWith("/team/")) {
      if (Number(request.headers.get("content-length") || 0) > MAX_SYNC_BODY) {
        return reply({ error: "Team request too large" }, 413, origin);
      }
      const parsed = await teamPayload(request, env);
      if (parsed.error) return reply({ error: parsed.error }, parsed.error === "Not authorised" ? 401 : 400, origin);
      if (url.pathname === "/team/sync") return handleTeamSync(parsed.input, env, origin);
      if (url.pathname === "/team/sightings") return handleTeamList(parsed.input, env, origin, "sighting");
      if (url.pathname === "/team/review") return handleTeamList(parsed.input, env, origin, "review");
      if (url.pathname === "/team/image") return handleTeamImage(parsed.input, env, origin);
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
