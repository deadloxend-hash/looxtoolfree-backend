# LOOX premium image models

The image workspace reads the model catalog and costs from `GET /api/loox?action=config`. The server enables a choice only when its environment key exists and the matching `loox_operations` row is installed. Apply `supabase/cloud-image-models.sql` in the dedicated LOOX Tools database.

| Choice | Server environment | Credits per successful image |
| --- | --- | ---: |
| Replicate FLUX 1.1 Pro | `REPLICATE_API_TOKEN` | 6 |
| Google Gemini Flash Image | `GEMINI_API_KEY` | 5 |
| Black Forest Labs FLUX 1.1 Pro | `BFL_API_KEY` | 6 |
| Ideogram 3.0 | `IDEOGRAM_API_KEY` | 6 |
| Stability Stable Image Core | `STABILITY_API_KEY` | 5 |
| BytePlus Seedream | `BYTEPLUS_API_KEY`, `BYTEPLUS_MODEL_ID` | 6 |
| OpenAI GPT Image | `OPENAI_API_KEY` | 6 |

Configure keys as sensitive production environment variables in Vercel. Never put them in the GitHub Pages repository. A paid Pro or Lifetime plan is required for cloud choices. The free local FLUX.1 Schnell path remains 3 credits. The API reserves the fixed price before a provider call and refunds it if the request fails; successful results are normalized and stored in the account's private Supabase bucket. The daily image quota covers local and cloud generation together.

The provider balance and account-specific model activation cannot be inferred from the existence of a key. Run a paid end-to-end smoke test with an entitled account before treating a given provider as verified. Checkout is separately gated by merchant configuration. If a provider returns an authorization or funds error, the request shows a clear failure and releases the LOOX credits.
