# LOOX image model activation

All 17 choices appear in the workspace, including local FLUX.1 Schnell (3 credits). The 16 cloud choices are initially Coming Soon. No key shared in chat may be reused. Create rotated image-only credentials in sensitive Vercel production environment variables named `LOOX_IMAGE_GOOGLE_API_KEY`, `LOOX_IMAGE_BFL_API_KEY`, `LOOX_IMAGE_IDEOGRAM_API_KEY`, `LOOX_IMAGE_STABILITY_API_KEY`, `LOOX_IMAGE_BYTEPLUS_API_KEY`, `LOOX_IMAGE_OPENAI_API_KEY`, and `LOOX_IMAGE_REPLICATE_API_TOKEN`.

Apply `supabase/image-model-catalog-2026.sql`. A matching operation row and a new key alone never activate a model. Fund provider billing, review unit economics, obtain approval for a paid smoke generation, and verify a successful result, storage, reserve/finalize and refund path. Only then add the exact model ID to `LOOX_IMAGE_VERIFIED_MODELS`. Leave unset otherwise. If the provider stops working, remove the model ID immediately and mark its status Temporarily Unavailable during investigation.

| Provider | Model | Verification ID | Draft credits per successful image |
| --- | --- | --- | ---: |
| Google AI | Nano Banana 2 | `google_nano_2` | 8 |
| Google AI | Nano Banana Pro | `google_nano_pro` | 18 |
| Black Forest Labs | FLUX.2 Pro | `bfl_flux2_pro` | 9 |
| Black Forest Labs | FLUX.2 Klein 4B | `bfl_klein_4b` | 5 |
| Ideogram | P-Image | `ideogram_p_image` | 7 |
| Ideogram | 4.5 | `ideogram_45` | 13 |
| Stability AI | Stable Diffusion 3.5 Large | `stability_sd35` | 10 |
| Stability AI | Stable Image Ultra | `stability_ultra` | 12 |
| BytePlus | Seedream 4.5 | `byteplus_45` | 8 |
| BytePlus | Seedream 5.0 Flash | `byteplus_50_flash` | 9 |
| OpenAI | GPT Image 2.5 Flare | `openai_gpt_image` | 16 |
| Replicate | Qwen Image 2 | `replicate_qwen2` | 7 |
| Replicate | HiDream-I1 Fast | `replicate_hidream` | 5 |
| Replicate | Imagen 4 Fast | `replicate_imagen4` | 6 |
| Replicate | Luma Photon | `replicate_photon` | 7 |
| Replicate | FLUX 1.1 Pro Ultra | `replicate_flux_ultra` | 9 |
| LOOX Studio | FLUX.1 Schnell | `flux` | 3 |

Cloud prices are provisional and cannot be called final until provider invoices and paid-plan economics are verified. One image per request. Google supports 1K/2K/4K, Ideogram P-Image supports 1K/2K and quality, and OpenAI supports quality. Reference images and multi-image output remain pending. Do not activate any model until its exposed settings and billing are verified. The server authenticates, checks entitlement and quota, reserves credit once for an idempotent request, processes the image, and finalizes or releases the reservation. A shared 30/day UTC image allowance covers cloud and local generation. Provider error bodies and private credentials are never returned to the browser.
