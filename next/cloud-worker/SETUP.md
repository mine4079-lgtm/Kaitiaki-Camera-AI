# Kaitiaki Next — private Gemini vision pilot

Only deploy this Worker when authorised to send project camera images to Google. The public frontend in /next/ is unchanged; existing original images remain untouched. This Worker sends one browser-resized image (up to 1280 px) per request to Gemini, and intentionally does not persist images. Provider data handling applies. Free-tier data may be used to improve provider products; assess your project's data policy before use.

## Secure deployment
1. In Google AI Studio, check the Gemini API project is on the intended free/paid tier and inspect its current rate limits. Do not enable paid billing just for this pilot.
2. Create a separate long random access token. It is not the Gemini API key.
3. Deploy from this directory with Wrangler (or import its source in Cloudflare Workers):
   `cd next/cloud-worker && npx wrangler deploy`
4. In Cloudflare Worker Settings → Variables and Secrets, securely add **GEMINI_API_KEY** and **KAITIAKI_ACCESS_TOKEN** as encrypted secrets. Do not commit them, paste them in chat, or send Gemini key to the browser.
5. Confirm allowed origin is `https://mine4079-lgtm.github.io`. The published app's Scan tab accepts the resulting HTTPS Worker URL plus only the separate access token.
6. Check connection, import five to ten authorised images, reconnect the same source images and select Identify. Check predicted labels in Results after refreshing. Human-verify all predictions and export CSV.

## Limits and cautions
- The Worker uses `gemini-2.5-flash-lite` and returns the existing `label`, `confidence`, `note` and `modelId` contract. Model confidence is subjective, not field accuracy. Predictions never replace verified labels.
- The Worker validates input, limits image payload, checks allowed origin and access token, and reports Google quota (429) errors. An origin restriction is not itself authentication. A shared access token is suitable only for a limited private pilot; it is not per-user authentication.
- This pilot does **not** provide server-enforced cumulative request or spend caps. Don't run big folders unattended. Monitor project quotas and billing. For multi-user or large-volume deployment add durable per-account limits, token rotation, error backoff and audit controls.
- This is online vision: no network, no new classification. Browser IndexedDB is local to browser/device, so export CSV backups. Re-select original folder to reattach images; do not clear website data.
- Google documentation: https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/rate-limits
