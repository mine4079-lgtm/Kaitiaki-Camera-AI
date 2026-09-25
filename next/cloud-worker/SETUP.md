# Kaitiaki Next — private Gemini vision backend

The `/next/` app is a static GitHub Pages frontend. Gemini credentials must remain in the private Cloudflare Worker and must never be placed in GitHub Pages code.

## Current contract
The frontend POSTs one resized image at a time to the Worker. The Worker returns:
- `label`
- `confidence`
- `second_choice` (another allowed label or null)
- `note`
- `modelId`
- `requiresHumanConfirmation: true`

The browser stores the AI prediction separately from any human-confirmed label. AI never overwrites verification.

## Secrets
Configure these as Cloudflare encrypted secrets:
- `GEMINI_API_KEY`
- `KAITIAKI_ACCESS_TOKEN`

Keep `ALLOWED_ORIGIN` set to `https://mine4079-lgtm.github.io`.

## Model
The Worker code currently uses `gemini-3.5-flash-lite`, matching the working Cloudflare pilot.

## Important
- Source SD/HDD photos are never modified.
- Images are resized in the browser before classification.
- The Worker processes image data in memory and does not intentionally persist it.
- `confidence` is a model estimate, not validated field accuracy.
- `second_choice` is additional context for human review, not an automatic fallback label.
- Use human-confirmed labels for evaluation and learning.
