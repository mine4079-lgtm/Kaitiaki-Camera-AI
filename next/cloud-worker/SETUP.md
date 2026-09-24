# Kaitiaki Next — PestScan-style cloud vision setup

The new `/next/` app is a static GitHub Pages frontend. It cannot directly call Base44's private `InvokeLLM` function and **must never contain API keys**. The private Cloudflare Worker in this folder is a ready-to-deploy bridge to an already-trained OpenAI vision model. It is NOT claimed to be Base44's same automatically selected model, so accuracy/confidence will differ.

## What is implemented
- Scan/Results/Learning clean interface, human-confirmed labels and CSV export.
- Separate optional cloud connection and image upload after explicit consent.
- JPEG conversion in browser (max dimension 1280) to control transferred data size.
- One-image-at-a-time processing, result stored to IndexedDB after every success. Re-select same folder and press Identify to resume records with no AI result. Pause after current photo.
- Predictions are visible in results and the full-photo review dialog, and exported in CSV. **AI never overwrites verified human labels.**
- Separates seven target species from Other wildlife, Empty image and Unsure. The model's numeric confidence is subjective, not validated field accuracy.

## What is NOT ready
Cloud classification will remain disabled until a private Worker is deployed and two secrets are configured. No API account/key or deployed endpoint is connected by default. The current browser page must be refreshed after a cloud run to populate the existing Results view.

## Deployment (authorized work account only)
1. Obtain authorization for sending work camera photos to the provider. Unlike local Kaitiaki V4, this sends resized images to the OpenAI API. This Worker does **not** publish or permanently store photos, though the provider's data handling applies.
2. Create an OpenAI API project with billing and a suitable key. Do not paste API keys into GitHub, chat, HTML or screenshots.
3. Create a Cloudflare account and deploy this directory's Worker with Wrangler: `cd next/cloud-worker && npx wrangler deploy`.
4. Set secret `OPENAI_API_KEY` using `npx wrangler secret put OPENAI_API_KEY`.
5. Generate a separate long random **access token**, and set `KAITIAKI_ACCESS_TOKEN` using `npx wrangler secret put KAITIAKI_ACCESS_TOKEN`. Do not reuse your OpenAI key. Treat this token like a password; this simple design is for a private pilot, not an open public multi-user application.
6. Keep `ALLOWED_ORIGIN` set to `https://mine4079-lgtm.github.io` in wrangler.jsonc, and set model `OPENAI_MODEL` to a supported vision-capable model if needed.
7. On the Scan page, paste only the **Worker URL** and the **separate access token**, press Check connection, then import a few photos and Identify. Never put the OpenAI key in the browser. A correct classification on a small handful is not enough to establish field accuracy.

### Cost and scale safeguards
Every image is sent as a separate model request with associated API charges. Start with 5–10 authorized images before any large folder, examine species errors and costs, then set a provider spending limit. An 8GB laptop and 27k photos should not be one unmonitored cloud job. The first pilot runs sequentially and checkpoints after each success; batch cost controls, shared team authentication and independent held-out validation are future work.

### Operational limitation
GitHub Pages serves the frontend. Neither the GitHub integration nor the Base44 connector has deployed a Cloudflare Worker or configured the required secrets. **The cloud model is not live** until your organization connects a backend.

Reference: https://platform.openai.com/docs/guides/images-vision
