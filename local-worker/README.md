# LOOX private AI generation worker

This outbound-only worker sends **all image/video generation** to your own ComfyUI at `127.0.0.1:8188`. It never uses Replicate.

1. Download the `local-worker` folder from this repo, or clone the backend repository.
2. Get the private `worker.env` configuration from your setup download and place it beside `loox-worker.py`. **Never upload it to GitHub, a website, or chat.**
3. Start ComfyUI Desktop. Confirm `http://127.0.0.1:8188/system_stats` displays JSON.
4. Double-click `run-loox-worker.bat` on your Windows PC (Python 3.10 or later required).
5. Keep your PC, ComfyUI, and the worker running to allow website generation. The worker uses HTTPS outbound and needs no inbound firewall ports.

The default `flux-api.json` is your FLUX Schnell checkpoint workflow (`flux1-schnell-fp8.safetensors`) with positive/negative prompts fixed, 4 steps and Euler sampler. You can replace it with an API-format export only if node IDs 77, 67, 68, 70 match.

## Video

Image-generation workflows cannot produce video. Before offering video generation, install a ComfyUI video model appropriate for the available graphics memory, verify it can render MP4 locally, export its API workflow to `video-api.json`, and set `LOOX_VIDEO_PROMPT_NODE` to the node ID containing its text prompt. The worker advertises video availability only when both conditions are met. Until then, the backend rejects video requests; it does not send them to Replicate.

All jobs require logged-in LOOX users, rate limits, credits, private result storage, and a running worker. Outputs are capped at 16MB for PNG and 40MB for MP4. Never publish `worker.env`, `LOOX_WORKER_SECRET`, or your Supabase service role key.
