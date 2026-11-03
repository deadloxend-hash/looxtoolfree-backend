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
