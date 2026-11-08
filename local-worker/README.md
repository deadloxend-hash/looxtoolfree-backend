# LOOX private AI generation worker

This outbound-only worker sends **all image/video generation** to your own ComfyUI at `127.0.0.1:8188`. It never uses Replicate.

1. Download the `local-worker` folder from this repo, or clone the backend repository.
2. Get the private `worker.env` configuration from your setup download and place it beside `loox-worker.py`. **Never upload it to GitHub, a website, or chat.**
3. Start ComfyUI Desktop. Confirm `http://127.0.0.1:8188/system_stats` displays JSON.
4. Double-click `run-loox-worker.bat` on your Windows PC (Python 3.10 or later required).
5. Keep your PC, ComfyUI, and the worker running to allow website generation. The worker uses HTTPS outbound and needs no inbound firewall ports.

The default `flux-api.json` is your FLUX Schnell checkpoint workflow (`flux1-schnell-fp8.safetensors`) with positive/negative prompts fixed, 4 steps and Euler sampler. You can replace it with an API-format export only if node IDs 77, 67, 68, 70 match.

## Video

The bundled `video-api.json` contains the owner's **Wan 2.1 T2V 1.3B** API workflow. The worker now automatically uses positive prompt node **6**, seed node **3**, latent dimensions node **40**, and MP4 output node **50**. Supported proportions are 16:9 (832×480), 9:16 (480×832), 1:1 (640×640), 4:3 (768×576), and 3:4 (576×768). Video length is fixed at **33 frames / 16 fps (about 2.06 seconds)** for this initial GPU-friendly release.

To enable website video generation on Windows:
1. Update your local `local-worker` folder to include the **new** `loox-worker.py` and `video-api.json`.
2. Keep your existing private `worker.env` file. Do **not** upload it. `LOOX_VIDEO_PROMPT_NODE=6` is optional because the exact bundled workflow uses node 6 by default.
3. Start ComfyUI and verify you can render your Wan workflow locally. Install the exact models named in `video-api.json` in ComfyUI's expected model directories.
4. Run `run-loox-worker.bat` and keep the worker running. The website detects both image and video modes separately.
5. In Vercel and Supabase, make sure the existing `LOOX_WORKER_SECRET`, authentication/credit variables, and `supabase/local-comfy-worker.sql` migration are configured. The video operation costs **8 credits** by default unless your database pricing was changed.

The worker connects over outbound HTTPS to Vercel, so no Cloudflare Tunnel, router port-forwarding or public ComfyUI API is necessary.

**Limitations:** The PC must stay online; MP4 files larger than 40 MB are rejected; there is no audio in this Wan T2V workflow. The site refuses new video jobs when the worker is offline, so credits are not reserved for those attempts.

All jobs require logged-in LOOX users, rate limits, credits, private result storage, and a running worker. Outputs are capped at 16MB for PNG and 40MB for MP4. Never publish `worker.env`, `LOOX_WORKER_SECRET`, or your Supabase service role key.

## R2 worker update

If this worker was installed before the R2 migration, stop it, replace only `loox-worker.py` with the current repository version, and run `run-loox-worker.bat` again. Keep your existing `worker.env` and ComfyUI workflow JSON files. The updated worker accepts private R2 input links, uploads large outputs directly to a short-lived single-object R2 URL, and sends a SHA-256 checksum when confirming completion. Older workers can process text-only jobs, but reference-image and checksum verification require this update.

## ReActor face swap (consent-only, licensed use)

The Face Swap page at `/faceswap.html` now sends two PNG inputs through the authenticated Vercel backend to the existing private ComfyUI worker. The workflow is based on the user's API-format ReActor export. The submitted export had no `source_image` connection; `faceswap-api.json` fixes that with a second `LoadImage` node.

1. Obtain the appropriate **commercial InSwapper license** from InsightFace before enabling this functionality for a public/commercial website. The `inswapper_128.onnx` model weights are **not** covered by the MIT code license. Details: https://www.insightface.ai/
2. On the Windows PC, install and verify **ComfyUI-ReActor** and the licensed `inswapper_128.onnx` model. The exported workflow uses `ReActorFaceSwap` and `retinaface_resnet50`; confirm they run inside ComfyUI first.
3. Update your existing local `loox-worker.py` and add `faceswap-api.json` from this repository beside `flux-api.json`, `video-api.json`, and your existing private `worker.env`. **Never upload or commit `worker.env`.**
4. After confirming licensing and testing ReActor locally, set **`LOOX_FACE_SWAP_LICENSED=true`** in Vercel **Production** environment, redeploy the backend and restart `run-loox-worker.bat`. Do not set this flag before licensing is confirmed.
5. Keep ComfyUI and the worker running. Open `faceswap.html`, sign in, upload the target photo and consenting source face, check both permission boxes, then process. The default credit cost is **6 credits**, billed on success (failed jobs release reserved credits).

Privacy: image uploads are normalized and stripped of EXIF on the backend, kept in private Cloudflare R2, and sent to the local worker only as expiring signed URLs. The worker uploads both images to local ComfyUI and sends the result directly to a short-lived, single-object R2 upload URL. The backend verifies size, file type and SHA-256 before settling credits. The maintenance job removes source input images after the job is settled. No direct public ComfyUI port or third-party face-swap API is needed. Your PC must remain online for jobs to finish.

## FLUX.1 Schnell reference-image (image-to-image)

The Image Generator now has an upload button and reference similarity control for FLUX.1 Schnell. It uses the **same** `generate` credit operation and existing `flux-api.json` checkpoint, with ComfyUI's native `LoadImage`, `ImageScale`, `VAEEncode` and `KSampler` nodes. **No additional model download is required** for basic image-to-image.

To activate it on the Windows machine:
1. Download the **latest** `local-worker/loox-worker.py` from this repository and replace your older local worker script. Keep `worker.env` private and unchanged. Keep `flux-api.json` beside the script.
2. Start ComfyUI on localhost:8188, then restart `run-loox-worker.bat`. Keep both running.
3. Wait for the worker's next ping/claim; `GET /api/loox?action=config` will then include `local.referenceAvailable: true` while the worker is online.
4. Refresh the Image Generator, select FLUX.1 Schnell, click **+**, upload a JPG/PNG/WebP under 2.4 MB and 4 megapixels, choose Reference similarity (20–80%), confirm image permission, and generate.
5. A stronger similarity value retains more of the uploaded picture; a lower value allows more changes. This is **basic img2img**, not FLUX Redux or an identity-preserving face tool.

Security: the backend validates and re-encodes the image into private storage and passes only a short-lived signed link to the local worker. The database queue contains no raw base64 image, input images are not published to Community, and the maintenance task deletes reference files after jobs settle. The image is not stored in the browser's saved session or posted publicly automatically.

Until the updated local worker is running, a reference request is rejected **before reserving credits**, while plain FLUX text-to-image remains available.
