# LOOX media AI configuration

Existing background-removal and face-swap endpoints are preserved. The new `/api/media-ai` bridge reuses `MAGIC_HOUR_API_KEY` for the documented AI Image Upscaler endpoint, and the AI Image Editor with Qwen Edit for prompt-based photo restoration and subtle portrait retouching. Restoration/retouch output is a model interpretation, up to a 1K longest edge, and may invent detail. No account credentials are exposed to the browser. Account credits and provider limits still apply. Jobs are submitted once, polled with an HMAC token, and downloaded through `/api/media-ai-status`.

For mask-enforced inpainting or generative outpainting, configure a GPU/model service implementing this contract. These tasks remain explicitly unavailable until configured; no ordinary canvas filter is advertised as a model result. The custom bridge can also override upscaling, restoration or retouching when explicitly enabled.

Set these variables in the backend deployment environment, then redeploy:

- `MEDIA_AI_URL`: your HTTPS model endpoint, fixed by the administrator.
- `MEDIA_AI_KEY`: its private bearer credential.
- `MEDIA_AI_TASKS`: comma-separated enabled tasks: `inpaint,outpaint,upscale,restore,retouch`. Enable only tasks that the service actually implements.
- `MEDIA_AI_ORIGINS`: optional comma-separated frontend origins. Defaults to `https://deadloxend-hash.github.io`. Add the actual custom domain when one is connected.

The endpoint receives a POST JSON body:

```json
{"task":"inpaint","image":"data:image/jpeg;base64,...","mask":"data:image/png;base64,...","prompt":"Remove the selected object","factor":2,"expandX":25,"expandY":25}
```

`image` is the source. The optional mask is source-sized, white/opaque where edits are allowed and transparent elsewhere. Inpainting must honor that mask. `factor` is 2 or 4 for model upscaling. Outpainting expands the canvas by the specified percentages and synthesizes the missing surroundings. Restoration and retouching should preserve identity and geometry. Return PNG, JPEG or WebP bytes with the corresponding Content-Type, within 55 seconds; a non-2xx response is surfaced as a failed operation. Long-running providers should be adapted behind this fixed service endpoint with an appropriate async job contract before being enabled.

GET `/api/media-ai` publishes enabled task names only. Source images are limited to about 2.2 MB because Vercel request-body limits also include base64 and masks. Frontend users must explicitly consent before upload. Configure provider retention and account-side rate/budget limits for your deployment; this public frontend does not provide user authentication or persistent rate limiting.

No live model calls or browser tests were performed during implementation.
