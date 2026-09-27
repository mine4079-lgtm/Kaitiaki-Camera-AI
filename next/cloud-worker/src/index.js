/* Kaitiaki Camera AI — Gemini classifier + optional shared team sightings backend.
 * Required Worker secrets: GEMINI_API_KEY and KAITIAKI_ACCESS_TOKEN.
 * Optional shared-team bindings:
 *   KAITIAKI_DB     -> Cloudflare D1 database
 *   KAITIAKI_IMAGES -> Cloudflare R2 bucket
 */
const LABELS = [
  "Possum","Rat","Stoat","Mouse","Deer","Pig","Weka",
  "Other wildlife","Empty image","Unsure"
];
const PEST_LABELS = ["Possum","Rat","Stoat","Mouse","Deer","Pig"];
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024 * 1.5;
const MAX_SYNC_BODY = 2 * 1024 * 1024;
const MODEL = "gemini-3.5-flash-lite";
let schemaReady = false;

const GUIDE =
  "Classify this New Zealand trail camera photograph using exactly one label: " +
  LABELS.join(", ") +
  ". Identify only what is visibly present. Other wildlife includes birds " +
  "(including kereru and kiwi), cats, dogs, and all non-target animals; " +
  "never call animals an empty image. Empty image is only when the frame is clear enough " +
  "to rule out an animal and no animal or animal-like shape is visible. If the image is " +
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

function clean(value, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function sharedConfigured(env) {
  return !!(env.KAITIAKI_DB && env.KAITIAKI_IMAGES);
}

async function ensureSchema(env) {
  if (!env.KAITIAKI_DB) throw new Error("D1 binding missing");
  if (schemaReady) return;
  await env.KAITIAKI_DB.exec(`
    CREATE TABLE IF NOT EXISTS sightings (
      id TEXT PRIMARY KEY,
      team_name TEXT,
      device_id TEXT,
      device_name TEXT,
      imported_by TEXT,
      reviewer_name TEXT,
      file_name TEXT NOT NULL,
      relative_path TEXT,
      ai_prediction TEXT,
      ai_confidence INTEGER,
      ai_second_choice TEXT,
      ai_note TEXT,
      confirmed_label TEXT,
      human_verified INTEGER NOT NULL DEFAULT 0,
      needs_extra_review INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      image_key TEXT,
      captured_at TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sightings_status_updated
      ON sightings(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sightings_team_status
      ON sightings(team_name, status, updated_at DESC);
  `);
  schemaReady = true;
}

function classifySharedStatus(r) {
  const confirmed = clean(r.label, 40);
  const ai = clean(r.aiPrediction, 40);
  const verified = !!r.verified;
  const confidence = int(r.aiConfidence);
  const flagged = !!r.aiNeedsExtraReview;

  if (verified) return PEST_LABELS.includes(confirmed) ? "sighting" : "resolved";
  if (ai === "Unsure" || flagged || (ai && confidence < 85)) return "review";
  if (PEST_LABELS.includes(ai) && confidence >= 85) return "sighting";
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

async function handleTeamSync(request, env, origin) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false }, 503, origin);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_SYNC_BODY) {
    return reply({ error: "Shared record too large" }, 413, origin);
  }

  let input;
  try { input = await request.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400, origin); }

  const r = input?.record || {};
  const sourceId = clean(r.syncId || r.key, 1000);
  const fileName = clean(r.name, 300);
  if (!sourceId || !fileName) return reply({ error: "Record id and file name are required" }, 400, origin);

  await ensureSchema(env);

  const id = await hashId(sourceId);
  const status = classifySharedStatus(r);
  let imageKey = null;

  if ((status === "sighting" || status === "review") && input.image) {
    const image = decodeImageData(input.image);
    if (!image || image.bytes.byteLength > 750 * 1024) {
      return reply({ error: "Invalid or oversized shared preview" }, 400, origin);
    }
    imageKey = "team/" + id + ".jpg";
    await env.KAITIAKI_IMAGES.put(imageKey, image.bytes, {
      httpMetadata: { contentType: image.contentType }
    });
  }

  const now = new Date().toISOString();
  await env.KAITIAKI_DB.prepare(`
    INSERT INTO sightings (
      id, team_name, device_id, device_name, imported_by, reviewer_name,
      file_name, relative_path, ai_prediction, ai_confidence, ai_second_choice,
      ai_note, confirmed_label, human_verified, needs_extra_review, status,
      image_key, captured_at, verified_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      team_name=excluded.team_name,
      device_id=excluded.device_id,
      device_name=excluded.device_name,
      imported_by=excluded.imported_by,
      reviewer_name=excluded.reviewer_name,
      file_name=excluded.file_name,
      relative_path=excluded.relative_path,
      ai_prediction=excluded.ai_prediction,
      ai_confidence=excluded.ai_confidence,
      ai_second_choice=excluded.ai_second_choice,
      ai_note=excluded.ai_note,
      confirmed_label=excluded.confirmed_label,
      human_verified=excluded.human_verified,
      needs_extra_review=excluded.needs_extra_review,
      status=excluded.status,
      image_key=COALESCE(excluded.image_key, sightings.image_key),
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
    clean(r.path, 1000),
    clean(r.aiPrediction, 40),
    int(r.aiConfidence),
    clean(r.aiSecondChoice, 40),
    clean(r.aiNote, 300),
    clean(r.label, 40),
    r.verified ? 1 : 0,
    r.aiNeedsExtraReview ? 1 : 0,
    status,
    imageKey,
    clean(r.capturedAt, 50),
    clean(r.verifiedAt, 50),
    clean(r.createdAt, 50) || now,
    clean(r.updatedAt, 50) || now
  ).run();

  return reply({ ok: true, id, status, sharedReady: true }, 200, origin);
}

async function handleTeamList(request, env, origin, status) {
  if (!sharedConfigured(env)) {
    return reply({ error: "Shared team database is not connected yet", sharedReady: false, records: [] }, 503, origin);
  }
  await ensureSchema(env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, int(url.searchParams.get("limit"), 100)));
  const team = clean(url.searchParams.get("team"), 120);

  let stmt;
  if (team) {
    stmt = env.KAITIAKI_DB.prepare(`
      SELECT * FROM sightings
      WHERE status=? AND team_name=?
      ORDER BY updated_at DESC LIMIT ?
    `).bind(status, team, limit);
  } else {
    stmt = env.KAITIAKI_DB.prepare(`
      SELECT * FROM sightings
      WHERE status=?
      ORDER BY updated_at DESC LIMIT ?
    `).bind(status, limit);
  }
  const result = await stmt.all();
  return reply({ sharedReady: true, records: result.results || [] }, 200, origin);
}

async function handleTeamImage(request, env, origin) {
  if (!sharedConfigured(env)) return reply({ error: "Shared image store is not connected yet" }, 503, origin);
  await ensureSchema(env);
  const id = clean(new URL(request.url).searchParams.get("id"), 100);
  if (!id) return reply({ error: "Missing image id" }, 400, origin);

  const row = await env.KAITIAKI_DB.prepare(
    "SELECT image_key FROM sightings WHERE id=?"
  ).bind(id).first();
  if (!row?.image_key) return reply({ error: "Image not found" }, 404, origin);

  const object = await env.KAITIAKI_IMAGES.get(row.image_key);
  if (!object) return reply({ error: "Image not found" }, 404, origin);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=300");
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(object.body, { headers });
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
    requiresHumanConfirmation: true,
    review: result.label === "Unsure" || result.confidence < 85
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const expected = env.ALLOWED_ORIGIN || "https://mine4079-lgtm.github.io";
    const url = new URL(request.url);

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

    if (!authorised(request, env)) return reply({ error: "Not authorised" }, 401, origin);

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/classify")) {
      return handleClassification(request, env, origin);
    }
    if (request.method === "POST" && url.pathname === "/team/sync") {
      return handleTeamSync(request, env, origin);
    }
    if (request.method === "GET" && url.pathname === "/team/sightings") {
      return handleTeamList(request, env, origin, "sighting");
    }
    if (request.method === "GET" && url.pathname === "/team/review") {
      return handleTeamList(request, env, origin, "review");
    }
    if (request.method === "GET" && url.pathname === "/team/image") {
      return handleTeamImage(request, env, origin);
    }

    return reply({ error: "Not found" }, 404, origin);
  }
};
