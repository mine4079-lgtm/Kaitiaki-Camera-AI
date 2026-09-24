/* Kaitiaki Next: private Gemini bridge. Never publish credentials in GitHub Pages.
 * Deploy separately. Set GEMINI_API_KEY and KAITIAKI_ACCESS_TOKEN as Worker secrets.
 * Image bytes are processed in memory only. Predictions are never human verification.
 */
const LABELS = ["Possum","Rat","Stoat","Mouse","Deer","Pig","Weka","Other wildlife","Empty image","Unsure"];
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024 * 1.5;
const MODEL = "gemini-2.5-flash-lite";
const GUIDE = "Classify this New Zealand trail camera photograph using exactly one label: " + LABELS.join(", ") + ". Identify only what is visibly present. Other wildlife includes birds (including kereru and kiwi), cats, dogs, and all non-target animals; never call animals an empty image. Empty image is only when there is no visible animal. Unsure for ambiguous, obscured or indistinct images. Take care distinguishing rats and possums. Reply with a JSON object containing label, confidence (integer 0-100, subjective only, not a calibrated probability), and note (brief visible evidence). Do not invent animals.";
function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {status, headers:{
    "content-type":"application/json", "cache-control":"no-store",
    "access-control-allow-origin":origin, "vary":"Origin"
  }});
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const expected = env.ALLOWED_ORIGIN || "https://mine4079-lgtm.github.io";
    if (request.method === "OPTIONS") {
      return new Response(null, {status:204, headers:{
        "access-control-allow-origin": origin === expected ? origin : "",
        "access-control-allow-methods":"GET, POST, OPTIONS",
        "access-control-allow-headers":"authorization,content-type",
        "access-control-max-age":"600", "vary":"Origin"
      }});
    }
    if (origin !== expected) return reply({error:"Origin not allowed"},403,"");
    if (request.method === "GET") return reply({
      ready:!!(env.GEMINI_API_KEY && env.KAITIAKI_ACCESS_TOKEN),
      service:"kaitiaki-next-gemini", modelId:MODEL
    },200,origin);
    if (request.method !== "POST") return reply({error:"Use POST"},405,origin);
    if (!env.GEMINI_API_KEY || !env.KAITIAKI_ACCESS_TOKEN)
      return reply({error:"Server not configured"},503,origin);
    if (request.headers.get("Authorization") !== "Bearer " + env.KAITIAKI_ACCESS_TOKEN)
      return reply({error:"Not authorised"},401,origin);
    if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BASE64)
      return reply({error:"Image too large"},413,origin);
    let input;
    try { input = await request.json(); }
    catch { return reply({error:"Invalid JSON"},400,origin); }
    const image = input && input.image;
    const match = typeof image === "string" && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match || image.length > MAX_IMAGE_BASE64)
      return reply({error:"Invalid or oversized image"},400,origin);
    const requestBody = {
      contents:[{role:"user",parts:[
        {text:GUIDE},
        {inline_data:{mime_type:"image/" + match[1],data:match[2]}}
      ]}],
      generationConfig:{responseMimeType:"application/json",maxOutputTokens:256,temperature:0}
    };
    let upstream;
    try {
      upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",{
        method:"POST",
        headers:{"x-goog-api-key":env.GEMINI_API_KEY,"content-type":"application/json"},
        body:JSON.stringify(requestBody)
      });
    } catch { return reply({error:"Gemini service unavailable"},502,origin); }
    if (upstream.status === 429) return reply({error:"Gemini quota or rate limit reached. Check your project limits before retrying."},429,origin);
    if (!upstream.ok) return reply({error:"Gemini service returned " + upstream.status},502,origin);
    let result;
    try {
      const payload = await upstream.json();
      result = JSON.parse(payload.candidates[0].content.parts.map(p=>p.text||"").join(""));
    } catch { return reply({error:"Invalid Gemini response"},502,origin); }
    if (!result || !LABELS.includes(result.label) ||
      !Number.isInteger(result.confidence) || result.confidence < 0 ||
      result.confidence > 100 || typeof result.note !== "string")
      return reply({error:"Unexpected model classification"},502,origin);
    return reply({
      label:result.label,confidence:result.confidence,note:result.note.slice(0,240),
      modelId:MODEL,requiresHumanConfirmation:true,
      review:result.label === "Unsure" || result.confidence < 85
    },200,origin);
  }
};
