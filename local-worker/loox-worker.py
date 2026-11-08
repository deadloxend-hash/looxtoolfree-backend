"""LOOX Tools private Windows ComfyUI worker. Python 3.10+, standard library only.
Run run-loox-worker.bat. ComfyUI must already be running at localhost:8188.
NEVER commit worker.env to GitHub.
"""
import copy
import hashlib
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
FACE_JSON = HERE / "faceswap-api.json"
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

def upload_face_image(url, job_id, role):
    # Only fetch private, short-lived HTTPS storage URLs sent by the LOOX backend.
    parsed = urllib.parse.urlparse(url)
    allowed_supabase = parsed.path.startswith("/storage/v1/object/sign/loox-results/")
    allowed_r2 = parsed.hostname and parsed.hostname.endswith(".r2.cloudflarestorage.com") and "/users/" in parsed.path and "/inputs/" in parsed.path
    if parsed.scheme != "https" or not (allowed_supabase or allowed_r2):
        raise ValueError("Unexpected input image URL.")
    data = request(url, timeout=35)
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > 8_000_000:
        raise ValueError("The private input image must be a PNG under 8 MB.")
    name = "loox_" + job_id.replace("-", "") + "_" + role + ".png"
    boundary = "LOOXBoundary" + job_id.replace("-", "")
    body = (
        ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"" + name +
         "\"\r\nContent-Type: image/png\r\n\r\n").encode() + data +
        ("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--" + boundary + "--\r\n").encode()
    )
    uploaded = request(COMFY + "/upload/image", "POST", body,
                       {"Content-Type": "multipart/form-data; boundary=" + boundary}, 60)
    if not isinstance(uploaded, dict) or uploaded.get("name") != name:
        raise ValueError("ComfyUI did not confirm the face-swap upload.")
    return name

def build_prompt(job):
    video = job["operation"] == "generate_video"
    swap = job["operation"] == "face_swap"
    path = FACE_JSON if swap else (VIDEO_JSON if video else IMAGE_JSON)
    graph = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(graph, dict) or not all(isinstance(x, dict) and "class_type" in x for x in graph.values()):
        raise ValueError("Please export an API-format ComfyUI workflow, not the normal workflow.")
    if swap:
        if graph.get("2", {}).get("class_type") != "ReActorFaceSwap" or (
            graph.get("4", {}).get("class_type") != "LoadImage" or
            graph.get("5", {}).get("class_type") != "LoadImage" or
            graph.get("3", {}).get("class_type") != "SaveImage"):
            raise ValueError("A complete ReActor API workflow with two LoadImage inputs is required.")
        graph["4"]["inputs"]["image"] = upload_face_image(job["input"]["target_image"], job["id"], "target")
        graph["5"]["inputs"]["image"] = upload_face_image(job["input"]["swap_image"], job["id"], "source")
        graph["2"]["inputs"]["input_image"] = ["4", 0]
        graph["2"]["inputs"]["source_image"] = ["5", 0]
        graph["3"]["inputs"]["filename_prefix"] = "LOOXFaceSwap_" + job["id"][:8]
        return graph
    prompt = job["input"]["prompt"]
    seed = job["input"].get("seed")
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    if video:
        # Wan 2.1 T2V 1.3B — exact nodes from the owner's exported workflow.
        text_node = os.getenv("LOOX_VIDEO_PROMPT_NODE", "6")
        if text_node not in graph or graph[text_node].get("class_type") != "CLIPTextEncode":
            raise ValueError("Wan video prompt node is missing. Expected node 6.")
        if graph.get("3", {}).get("class_type") != "KSampler" or graph.get("40", {}).get("class_type") != "EmptyHunyuanLatentVideo":
            raise ValueError("Wan video sampler / latent nodes are missing.")
        if graph.get("50", {}).get("class_type") != "SaveVideo":
            raise ValueError("Wan video SaveVideo output node 50 is missing.")
        graph[text_node]["inputs"]["text"] = prompt
        graph["3"]["inputs"]["seed"] = seed
        # Keep near the 1.3B model's native 480p pixel count. Do not
        # expose unbounded resolutions or frame counts to website visitors.
        sizes = {"16:9": (832, 480), "9:16": (480, 832),
                 "1:1": (640, 640), "4:3": (768, 576),
                 "3:4": (576, 768)}
        width, height = sizes[job["input"].get("aspect_ratio", "16:9")]
        graph["40"]["inputs"].update(width=width, height=height, length=33, batch_size=1)
        graph["49"]["inputs"]["fps"] = 16
        graph["50"]["inputs"]["format"] = "mp4"
    else:
        # Exact API workflow exported by the owner: 77=positive, 67=negative.
        if "77" not in graph or "67" not in graph or "68" not in graph or "70" not in graph:
            raise ValueError("This FLUX workflow does not match the expected nodes.")
        graph["77"]["inputs"]["text"] = prompt
        graph["67"]["inputs"]["text"] = ""
        w, h = dimensions(job["input"].get("aspect_ratio"))
        graph["68"]["inputs"].update(width=w, height=h, batch_size=1)
        graph["70"]["inputs"]["seed"] = seed
        if job["input"].get("reference_image"):
            # FLUX.1 Schnell img2img using stock ComfyUI nodes. No additional
            # face-swap, Redux, or other model weights are required.
            if graph["73"].get("class_type") != "CheckpointLoaderSimple" or graph["70"].get("class_type") != "KSampler":
                raise ValueError("Unsupported FLUX API workflow: expected CheckpointLoaderSimple and KSampler.")
            strength = float(job["input"]["reference_strength"])
            if not 0.2 <= strength <= 0.8:
                raise ValueError("Reference strength must be between 20 and 80 percent.")
            filename = upload_face_image(job["input"]["reference_image"], job["id"], "reference")
            graph["800"] = {"class_type": "LoadImage",
                           "inputs": {"image": filename}}
            graph["801"] = {"class_type": "ImageScale",
                           "inputs": {"image": ["800", 0], "upscale_method": "lanczos",
                                      "width": w, "height": h, "crop": "center"}}
            graph["802"] = {"class_type": "VAEEncode",
                           "inputs": {"pixels": ["801", 0], "vae": ["73", 2]}}
            graph["70"]["inputs"]["latent_image"] = ["802", 0]
            # Schnell's original 4-step text-to-image workflow runs almost no
            # useful denoising at e.g. 65% similarity (1 - .65 = .35).
            # For img2img, use additional sampling steps and a non-linear
            # edit-strength range so the prompt can actually change the image.
            # Strong edits can change the subject; exact background-only edits
            # require a mask/inpainting workflow, not plain img2img.
            graph["70"]["inputs"]["steps"] = 8
            graph["70"]["inputs"]["denoise"] = round(0.95 - (strength - 0.2) * (0.35 / 0.6), 3)
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
                backend("ping", {"modes": supported_modes()})
            except Exception:
                pass
        entry = request(COMFY + "/history/" + urllib.parse.quote(pid, safe=""))
        history = entry.get(pid)
        if history:
            state = history.get("status", {})
            if state.get("status_str") == "error":
                raise RuntimeError("ComfyUI workflow failed. Check its console for node errors.")
            video = job["operation"] == "generate_video"
            keys = ("videos", "gifs", "images") if video else ("images",)
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
            "Content-Type": upload.get("content_type") or ("video/mp4" if job["operation"] == "generate_video" else "image/png")}, 120)
        # Once a result is uploaded, never treat an intermittent completion
        # request failure as a generation failure or refund the successful job.
        for attempt in range(5):
            try:
                backend("complete", {"id": name, "lease": job["lease"], "success": True,
                                      "sha256": hashlib.sha256(output).hexdigest()})
                print("Finished and delivered:", name)
                return
            except Exception as settle:
                print("Delivery confirmation retry", attempt + 1,
                      type(settle).__name__, str(settle)[:180])
                if attempt < 4:
                    time.sleep(min(30, 3 * (2 ** attempt)))
        print("Result saved in private storage; completion confirmation pending.")
        return
    except Exception as exc:
        print("Generation or upload failed:", type(exc).__name__, str(exc)[:300])
        try:
            backend("complete", {"id": name, "lease": job["lease"], "success": False})
        except Exception as settle:
            print("Failed to settle job; backend will expire it:", str(settle)[:200])

def supported_modes():
    return (["generate", "generate_reference"] if IMAGE_JSON.exists() else []) + (
        ["generate_video"] if VIDEO_JSON.exists() else []) + (
        ["face_swap"] if FACE_JSON.exists() else [])

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
            supported = supported_modes()
            if not supported:
                sys.exit("No usable API workflow found. Place flux-api.json, video-api.json or faceswap-api.json beside this script.")
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
