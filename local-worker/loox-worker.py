"""LOOX Tools private Windows ComfyUI worker. Python 3.10+, standard library only.
Run run-loox-worker.bat. ComfyUI must already be running at localhost:8188.
NEVER commit worker.env to GitHub.
"""
import copy
import json
import os
import pathlib
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
def load_env():
    f = HERE / "worker.env"
    if f.exists():
        for line in f.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
load_env()
BACKEND = os.getenv("LOOX_BACKEND_URL", "https://looxtoolfree-backend.vercel.app").rstrip("/")
COMFY = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
SECRET = os.getenv("LOOX_WORKER_SECRET", "")
IMAGE_JSON = HERE / "flux-api.json"
VIDEO_JSON = HERE / "video-api.json"
if not SECRET or len(SECRET) < 32:
    sys.exit("Set LOOX_WORKER_SECRET in worker.env (the private setup file).")
if not COMFY.startswith(("http://127.0.0.1:", "http://localhost:")):
    sys.exit("COMFYUI_URL must be localhost. Never expose ComfyUI publicly.")

def request(url, method="GET", data=None, headers=None, timeout=35):
    payload = None
    h = dict(headers or {})
    if isinstance(data, (dict, list)):
        payload = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    elif data is not None:
        payload = data
    req = urllib.request.Request(url, data=payload, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read(42_000_000)
            return json.loads(body) if "json" in response.headers.get("Content-Type", "") else body
    except urllib.error.HTTPError as exc:
        print("HTTP", exc.code, url.split("?")[0])
        raise

def backend(action, value):
    return request(BACKEND + "/api/local-worker?action=" + action, "POST", value,
                   {"Authorization": "Bearer " + SECRET}, 35)

def dimensions(ratio):
    return {"1:1": (1024, 1024), "16:9": (1024, 576),
            "9:16": (576, 1024), "4:3": (1024, 768),
            "3:4": (768, 1024)}.get(ratio, (1024, 1024))

def build_prompt(job):
    video = job["operation"] == "generate_video"
    path = VIDEO_JSON if video else IMAGE_JSON
    graph = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(graph, dict) or not all(isinstance(x, dict) and "class_type" in x for x in graph.values()):
        raise ValueError("Please export an API-format ComfyUI workflow, not the normal workflow.")
    prompt = job["input"]["prompt"]
    seed = job["input"].get("seed")
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    if video:
        # A video workflow differs by model. Set the prompt node in worker.env after exporting it.
        text_node = os.getenv("LOOX_VIDEO_PROMPT_NODE", "")
        if not text_node or text_node not in graph:
            raise ValueError("Set LOOX_VIDEO_PROMPT_NODE in worker.env to the text input node ID of video-api.json.")
        node_inputs = graph[text_node]["inputs"]
        key = next((k for k in ("text", "prompt", "positive_prompt") if isinstance(node_inputs.get(k), str)), None)
        if key is None:
            raise ValueError("The configured video prompt node has no supported text input.")
        node_inputs[key] = prompt
    else:
        # Exact API workflow exported by the owner: 77=positive, 67=negative.
        if "77" not in graph or "67" not in graph or "68" not in graph or "70" not in graph:
            raise ValueError("This FLUX workflow does not match the expected nodes.")
        graph["77"]["inputs"]["text"] = prompt
        graph["67"]["inputs"]["text"] = ""
        w, h = dimensions(job["input"].get("aspect_ratio"))
        graph["68"]["inputs"].update(width=w, height=h, batch_size=1)
        graph["70"]["inputs"]["seed"] = seed
    return graph

def generate(job):
    prompt = build_prompt(job)
    submission = request(COMFY + "/prompt", "POST", {"prompt": prompt})
    pid = submission.get("prompt_id")
    if not pid:
        raise RuntimeError("ComfyUI rejected the workflow: " + str(submission.get("error") or submission.get("node_errors") or "unknown")[:400])
    print("ComfyUI queued", pid)
    deadline = time.monotonic() + 105 * 60
    while time.monotonic() < deadline:
        time.sleep(4)
        if int(time.monotonic()) % 20 < 4:
            try:
                backend("ping", {"modes": ["generate", "generate_video"] if VIDEO_JSON.exists() and os.getenv("LOOX_VIDEO_PROMPT_NODE") else ["generate"]})
            except Exception:
                pass
        entry = request(COMFY + "/history/" + urllib.parse.quote(pid, safe=""))
        history = entry.get(pid)
        if history:
            state = history.get("status", {})
            if state.get("status_str") == "error":
                raise RuntimeError("ComfyUI workflow failed. Check its console for node errors.")
            video = job["operation"] == "generate_video"
            keys = ("videos", "gifs") if video else ("images",)
            for output in history.get("outputs", {}).values():
                for key in keys:
                    for item in output.get(key, []):
                        fn = item.get("filename", "")
                        if video and not fn.lower().endswith(".mp4"):
                            continue
                        if not video and not fn.lower().endswith(".png"):
                            continue
                        if "/" in fn or "\\" in fn or not fn:
                            continue
                        query = urllib.parse.urlencode({"filename": fn,
                                      "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")})
                        binary = request(COMFY + "/view?" + query, timeout=120)
                        if video and b"ftyp" not in binary[:64]:
                            raise RuntimeError("Video output must be an MP4 file.")
                        if not video and not binary.startswith(b"\x89PNG\r\n\x1a\n"):
                            raise RuntimeError("ComfyUI did not return a PNG image.")
                        return binary
            raise RuntimeError("ComfyUI finished without a supported " + ("MP4 video" if video else "PNG image") + " output.")
    raise TimeoutError("ComfyUI generation timed out.")

def run_job(job):
    name = job["id"]
    print("Processing", job["operation"], name)
    try:
        output = generate(job)
        upload = backend("upload", {"id": name, "lease": job["lease"]})
        if len(output) > upload["max_bytes"]:
            raise ValueError("Output is too large for the private storage limit.")
        result = request(upload["upload_url"], "PUT", output, {
            "Content-Type": "video/mp4" if job["operation"] == "generate_video" else "image/png",
            "x-upsert": "false"}, 120)
        backend("complete", {"id": name, "lease": job["lease"], "success": True})
        print("Finished:", name)
    except Exception as exc:
        print("Job failed:", type(exc).__name__, str(exc)[:300])
        try:
            backend("complete", {"id": name, "lease": job["lease"], "success": False})
        except Exception as settle:
            print("Failed to settle job; backend will expire it:", str(settle)[:200])

def main():
    print("LOOX Private GPU Worker | ComfyUI:", COMFY)
    delay = 3
    while True:
        try:
            request(COMFY + "/system_stats", timeout=8)
            break
        except Exception:
            print("ComfyUI not reachable. Start ComfyUI Desktop, then retrying...")
            time.sleep(8)
    print("Connected. Keep this terminal running. Press Ctrl+C to stop.")
    while True:
        try:
            supported = (["generate"] if IMAGE_JSON.exists() else []) + (
                         ["generate_video"] if VIDEO_JSON.exists() and os.getenv("LOOX_VIDEO_PROMPT_NODE") else [])
            if not supported:
                sys.exit("Missing flux-api.json. Put your ComfyUI API workflow next to this script.")
            response = backend("claim", {"modes": supported})
            job = response.get("job")
            if job:
                run_job(job)
            else:
                time.sleep(10)
        except KeyboardInterrupt:
            print("Worker stopped.")
            return
        except Exception as exc:
            print("Connection error:", type(exc).__name__, str(exc)[:150])
            time.sleep(12)

if __name__ == "__main__":
    main()
