# LOOX Unified AI Engine 2.0

Audit date: 24 November 2026. Published price estimates are not provider invoices. No billable predictions were run. All paid models remain disabled.

## Inventory and integration status

The registry contains 40 entries: 18 image entries (including a local-only Z-Image entry and a separate optional paid Schnell fallback) and 22 video entries. 35 exact catalog identifiers have prepared adapters; 33 entries have published rate evidence for a restricted subset. **Zero authenticated schema checks and zero live paid acceptance tests have been completed in this rollout. Zero models are activated for paid generation.** Catalog evidence alone is not a functional connection check.

Four requested local models remain in the existing ComfyUI queue: Schnell, Z-Image Turbo, Klein 4B Edit and Wan 2.1. Cloudflare Schnell retains its 100-request daily guard. Local reference editing never falls back to paid generation. The optional paid Schnell fallback has its own operation and both request and server approval gates. It cannot start for Basic users.

[Complete model table](model-audit.csv) · [Resolution, duration, quality and audio price variants](pricing-variants.csv) · [42 additional database operations and legacy aliases](additional-operations.csv) · [Authoritative pre-change credit snapshot](operations-snapshot.json). Database operation rows do not prove a model is connected. The additional operations remain inactive through this engine; exact Replicate identity, price and adapter review are still required.

Four requested exact cloud models remain unverified: Stable Image Ultra, Seedream 5.0 Flash, FLUX 3 Video and Sora 2. Seedream Lite is not silently substituted for Flash. P-Image is cataloged as prunaai/p-image-ideogram; the label does not establish an Ideogram-owned API. The existing generic GPT Image entry points to GPT Image 2.5 Flare; it is disabled pending an explicit supported-price matrix and schema review. Imagen 4 Fast, Veo Lite and Luma Ray 2 had inconsistent public-page retrieval; authenticated metadata must resolve their status. HiDream's exact slug contains lower-case l1, not i1.

## Financial analysis

Basic: $0 / 25 credits. The table uses the user's planned monthly subscriptions; no subscription price, allocation, wallet or customer credit charge was changed.

|Plan|Monthly price|Credits|Revenue per credit|Maximum provider-only exposure at published proposed variants*|
|---|---:|---:|---:|---:|
|Creator|$12|500|$0.02400000|$7.00|
|Pro|$29|1500|$0.01933333|$25.96|
|Business|$69|4000|$0.01725000|$69.23|

*Conservative fractional-credit envelope, before global/model/user budgets, per-generation limits, integer generation counts and fees; assumes all proposed variants become available and credits are fully used. **Current exposure through this engine is $0 because paid submission is disabled.** Existing Replicate limits remain $2/day, $30/month and $1/generation. The $100/month engine setting is a draft ceiling; the lower existing $30 ceiling still wins. Several expensive models therefore cannot be enabled under current caps even after schema review. No cap was increased.

Revenue per generation = current credits × plan revenue per credit. Provider-only gross profit = revenue − published provider cost; margin = profit ÷ revenue. Recommended credits = ceil(cost / (Business revenue per credit × 0.30)), targeting 70% provider-only margin. Break-even credits = ceil(cost / Business revenue per credit). These are recommendations only and have not been applied. See the variant CSV for every prepared resolution, duration and selectable audio variant and the corresponding cost per 100 and 1,000 outputs. Multi-reference, video-reference, batch and higher-resolution variants without complete adapters are blocked. These tables are not a complete catalog of every capability offered by the model vendor.

Loss-making proposed variants at Business pricing: Seedance 2.0 {"resolution":"1080p"} 5s: $2.25 cost vs $2.2425 revenue (-0.334448%); Seedance 2.0 {"resolution":"1080p"} 10s: $4.5 cost vs $4.485 revenue (-0.334448%). Keep them blocked or approve a separate credit schedule before launch.

Bonus credits have no subscription revenue. A 5-credit check-in every 12 hours permits up to 300 credits over 30 days, subject to the existing 50-credit wallet cap and actual eligibility. Basic users cannot spend them on paid cloud requests. If paid users become eligible as balances fall, those credits consume real budget with zero incremental revenue. Worst paid-model exposure must include bonus/redemption eligibility, not only subscription credits.

Payment-processing fees, tax, R2 requests/storage, bandwidth, Vercel, electricity and operational labor are not verified per output. They are excluded rather than assigned invented values. All reported margins are consequently upper bounds on final profit. H3 Lite has a published temporary half-price promotion through 31 December 2026; reservations and comparisons deliberately use regular list rates ($0.025/sec at 480P, $0.04/sec at 768P). FLUX Pro's image prices here assume no input references; input megapixel charges are not silently ignored in an edit mode. P-Image and GPT Image pricing remains unverified and blocked. No hardware runtime is converted to an invented fixed price. Actual bills remain null until an owner records an invoice-backed cost. Failed prediction liability is retained.

## Architecture and security

A single server-side REPLICATE_API_TOKEN supplies creation, GET status, cancellation, model-schema checks and webhook-secret retrieval. Legacy keys are retained for rollback. Gemini assistant and prompt enhancement are outside the image/video migration and retain their existing configuration. Creation is never automatically retried after a network timeout or ambiguous provider response. An atomic request ID and claim prevent duplicate submissions; uncertain requests retain liability and need signed callback or owner/provider investigation. Schema versions are pinned in prediction creation. No acceptance check runs automatically.

The database locks the wallet and shared provider row before checking daily/monthly/model/user/concurrency limits and reserving credits. It reserves the larger of the existing operation maximum and 120% of the published estimate. It counts the larger of estimated and actual costs, including failed work. Invoice overruns pause the provider and queue an owner spending alert. Threshold alerts use existing configured transactional mail, require the mail sender/recipient settings and are delivered by maintenance; budget enforcement itself is immediate in the transaction. Provider balance monitoring has no verified balance API and displays unavailable, not a fabricated zero.

Signed raw-body HMAC callbacks enforce five-minute timestamps, constant-time comparison, prediction binding and canonical status lookup. Downloads accept HTTPS replicate.delivery hosts only, reject redirects and enforce byte limits. Images are decoded and normalized; videos require MP4 headers. Results use existing private R2 storage and authenticated/expiring access. Service-only RLS and RPC privileges isolate engine config, models and jobs. Control Center requires current owner identity, MFA AAL2 and server-side session validation. Customer routes preserve existing auth and throttles.

## Database and rollback

Additive migration: supabase/migrations/20261124_unified_ai_engine.sql. It adds three service-only engine tables, reservation/claim/binding/completion/failure/invoice/stats/health RPCs, disabled model policies and Replicate mappings for the prepared operations. A separate paid Schnell operation copies the existing 3-credit charge without changing local generation. Existing prices, balances, accounts, history, storage and allocations remain untouched. Original direct adapters are archived as text under lib/legacy for review and rollback; they are not executable imports. Restore a prior code commit only with paid generation still disabled; do not remove historical cost records or roll back wallet transactions.

## Remaining acceptance and configuration

Owner nonbillable schema verification and adapter correction are required for each exact model; indexed catalog evidence is insufficient. Model-specific reference/negative prompt/seed/custom size/audio/batch support is deliberately limited to validated adapters. No model is advertised as ready based on token presence. Pricing must be reverified within 31 days. Each model also needs a separately authorized billable acceptance run, approved budgets, per-user/model limits and eligible plan before activation. Do not set the approval environment flag until that separate decision.

A process crash between provider acceptance and recording its prediction can require manual provider investigation if no signed callback arrives. Such jobs remain uncertain and retain credit/spending holds; automatic resubmission is prohibited. Daily maintenance is not a substitute for signed callbacks because provider result URLs expire. Individual private-admin provider connection tests, real owner/member sessions, a live ComfyUI worker run and real mobile hardware were not exercised here. No production data was deleted during tests.

## Validation and rollout

See [verification and modified-file record](VERIFICATION.md). Frontend, backend and private administration changes are committed and published; paid execution remains disabled.
