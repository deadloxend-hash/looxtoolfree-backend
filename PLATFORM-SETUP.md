# LOOX Tools platform activation

The new routes fail closed until required services are configured. The legacy unauthenticated paid provider proxies have been retired. Browser utilities do not use these routes.

## Supabase

1. Use a dedicated LOOX Tools project. The connected Supabase account returned no projects during implementation.
2. Apply supabase/platform.sql once through the SQL editor as the database owner. It creates only loox_ tables and functions and the private loox-results bucket. Review against existing schemas before applying. The table policies allow users to read their own records. Only service_role can mutate wallets, credit transactions, jobs, subscriptions and payments or execute platform RPCs.
3. Copy the project URL, publishable key and backend service-role key to Vercel using the variables in .env.example. Only the URL and publishable key are returned by the public config endpoint.
4. Enable email confirmation and production SMTP. Set the site URL to https://deadloxend-hash.github.io/looxtoolsfree/ and explicitly allow https://deadloxend-hash.github.io/looxtoolsfree/account.html and the same URL with ?flow=recovery for redirect URLs.
5. Set the server Auth password policy to at least 12 characters with letters and numbers, enable available breached-password protection, and configure Auth rate limits and CAPTCHA before opening registration broadly. The custom form enforces the same password rules, but Auth must enforce them against direct API calls.
6. Generate a random 32-byte LOOX_IDENTITY_SECRET. Keep it stable. It binds checkout metadata and signup eligibility to a keyed normalized email fingerprint. Deleting and re-creating an account with the same email does not yield another bonus. Multiple separate emails remain separate eligible identities, so production signup abuse controls still matter.
7. Run Supabase security and performance advisors after applying the schema.

## Replicate

Set a newly rotated REPLICATE_API_TOKEN, REPLICATE_WEBHOOK_SIGNING_SECRET from the Replicate webhook signing-secret API, LOOX_BACKEND_URL, CRON_SECRET and a positive LOOX_DAILY_BUDGET_MILLICENTS. The token previously pasted in chat must be replaced by its owner.

Adapters use current documented official model schemas.

| Operation | Official model | Inputs |
| --- | --- | --- |
| Background | bria/remove-background | image, preserve_alpha |
| Upscale | google/upscaler | image, upscale_factor x2/x4, compression_quality |
| Erase | bria/eraser | image, mask |
| Generate | black-forest-labs/flux-schnell | prompt, aspect_ratio, optional seed, num_outputs 1, output_format png |

FLUX Schnell has no negative-prompt field in this adapter. Model choices and bounded settings are controlled by the backend. Prompts and media are absent from stored job records and application logs.

Inputs are decoded and normalized by Sharp, stored in a private bucket, and shared with Replicate through 20-minute signed URLs. Only an authenticated owner can request a five-minute output URL. Outputs are normalized to PNG. Limits are 2.4 MB per incoming image, a combined JSON body below Vercel's 4.5 MB cap, four megapixels generally and one megapixel for 4x input.

Replicate completion callbacks use standard webhook signatures, timestamp checks and an independent keyed job binding. The backend refetches the prediction from Replicate before settlement. Browser polling also reconciles completed jobs. A submission timeout is ambiguous and is never retried as a new paid request under the same request ID. If a prediction ID cannot be recovered by callback, reservations are released after 25 minutes when status or maintenance runs.

The scheduled maintenance route runs daily on a Hobby-compatible schedule. It processes up to 40 outstanding jobs, removes temporary inputs for up to 200 finished jobs per run and expires rate buckets. Monitor its status and use an external authenticated scheduler or a supported higher-frequency cron for faster recovery and higher traffic. Inputs can remain stored until this cleanup runs even after their signed URLs expire. Output files are retained until account deletion.

The SQL job reservation locks wallets and the global daily budget row. Current operation estimates intentionally exceed the documented per-image costs. These estimates are an application admission limit, not a provider billing guarantee. Recheck prices, configure the Replicate account spending limit and monitor actual invoices. Pricing and credit costs are edited in loox_plans and loox_operations. Estimates are charged to the daily budget for every submitted job including failures.

## Lemon Squeezy

This is the implemented hosted checkout adapter. Merchant approval and jurisdiction availability still need verification. All buttons remain disabled until required configuration exists.

Create USD variants matching loox_plans with no trials, quantity options or pay-what-you-want pricing. Pro is $9.99 monthly with 100 credits per paid initial/renewal invoice. Lifetime is $49 once with 50 credits granted once per paid order and no recurring free credit refill. Provider variants must match database prices.

Set LEMON_API_KEY, LEMON_STORE_ID, LEMON_PRO_VARIANT, LEMON_LIFETIME_VARIANT, LEMON_WEBHOOK_SECRET and LEMON_MODE. Test mode must use a separate Supabase project and deployment, since test credits are issued in that configured project.

Register /api/loox-payment for order_created, order_refunded, subscription_created, subscription_updated, subscription_cancelled, subscription_expired, subscription_payment_success, subscription_payment_failed, subscription_payment_recovered and subscription_payment_refunded. Keep retries enabled. Signature validation uses the raw request body. Initial Pro order events are ignored, and only subscription invoices grant Pro credits, preventing a double initial allowance. Updated/prorated invoices do not grant a second cycle allowance. Any refunded invoice/order revokes that grant conservatively. If some credits were consumed, the debt blocks AI processing until repaid by future grants. Old signed events cannot re-credit refunded purchases.

Checkout returns never grant credits. The dashboard shows payment states and allows portal access for cancellation. Hosted checkout payment errors stay in the provider UI. Recurring billing must be cancelled before deleting the account. A cancelled subscription remains usable through its paid ends_at date.

## Verification and release

Run npm ci and npm test. The tests execute the SQL in PGlite PostgreSQL WASM and cover idempotency, wallet safety, budget limits, refunds, RLS, repeat bonuses, decoded uploads, owner filters, missing configuration and webhook signatures. PGlite serializes client queries. Validate multi-connection concurrency and retry behavior against the target Supabase project before commercial activation.

Live SMTP, signup verification, recovery emails, real Replicate outputs and Lemon Squeezy checkout/webhooks cannot be verified without project and provider credentials. Complete a test-mode paid initial invoice, renewal, failure, cancellation, refund, webhook replay, missing callback recovery and account deletion before switching to live billing.

GitHub Pages shares an origin across repositories under this account. CORS cannot distinguish paths. Other scripts on that origin share the same browser trust boundary. Isolate LOOX Tools on a dedicated domain before commercial launch and include it in CORS, Supabase redirects and CSP. Existing editor pages retain their established script policies. Dedicated account and AI pages have restrictive CSP compatible with their flows.

The account UI refreshes after credit operations and when a tab becomes visible. The server remains authoritative. This implementation has automated checks, and still requires deployment-level security testing before a production security claim.
