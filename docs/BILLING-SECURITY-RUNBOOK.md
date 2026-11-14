# LOOX billing and security rollout — 14 November 2026

## Deployment boundaries

Only deadloxend-hash/looxtoolsfree and deadloxend-hash/looxtoolfree-backend are in scope. MediaGrab is excluded. Existing GitHub Pages URLs and Vercel API files are retained. New modules live in backend `src/config`, `src/billing`, `src/security`, `src/notifications`, frontend `platform/billing`, and reviewed SQL in `supabase/migrations`. Existing `lib` modules remain in place to avoid breaking imports. This is incremental organization, not a complete codebase reorganization or enterprise security certification.

## Disabled launch state

Production, preview and development: `ANNUAL_BILLING_ENABLED=false`, `PAYMENTS_ENABLED=false`, `CREDIT_TOPUPS_ENABLED=false`, `TOPUP_MARGIN_APPROVED=false`, `PAYMENT_PROVIDER=lemonsqueezy`. New annual checkout requests are rejected server-side. Existing annual records and billing event processing are preserved. These flags cannot invalidate a previously issued provider-hosted URL: once a merchant exists, disable annual provider variants and expire old checkouts in its dashboard too. No Lemon Squeezy environment credentials existed during this rollout; no checkout or real charge was created.

Monthly catalog: Basic $0 / 25 one-time verified-signup credits; Creator $12 / 500; Pro $29 / 1,500; Business $69 / 4,000. Existing manually claimed return rewards remain unchanged. All balances share the existing wallet: credits are fungible and debits follow transaction order, rather than separate subscription/purchased lots. Unused credits roll over and do not expire. No purchased-credit expiry job exists. Verified refunds reverse allocations; already spent refunds create debt and block generation.

Proposed recharges, all `approved=false` and without provider variant IDs: 100/$5; 300/$10; 750/$25; 1,500/$45. Backend database values feed the modal. No frontend balance, price, credit amount, or payment-success response authorizes a grant.

## Before any payment activation

1. Create and verify the Lemon Squeezy merchant, payout destination, tax/legal details and supported business eligibility in your own account. Do not provide credentials in chat.
2. Configure server-only `LEMON_API_KEY`, `LEMON_STORE_ID`, `LEMON_WEBHOOK_SECRET`, `LEMON_MODE`; monthly variant IDs for Creator, Pro and Business. Set matching recharge variants in `loox_recharge_packages` only after approving margins.
3. Use a separate test database and provider test store. Keep production purchase flags false. Test signed subscription lifecycle, renewals, failures, full and partial refunds, delayed/out-of-order events, one-time orders and billing portal ownership.
4. Webhook endpoint: `https://looxtoolfree-backend.vercel.app/api/loox-payment`. Raw HMAC-SHA256 `X-Signature`, fixed size ceiling, durable event hashes, retry leases and atomic credit settlement are implemented. The journal stores resource references and event names, not full sensitive payloads. A processed replay returns 204; an event still being processed returns a retryable failure.
5. Recharge orders are re-fetched from the provider and checked for store, mode, currency, variant, quantity, and server-signed catalog snapshot. Legacy subscription events retain their existing provider-timestamp and invoice-reference accounting. Partial **subscription** refund semantics still need provider acceptance testing: the existing subscription ledger reverses an entire grant on refund. Do not activate until this is resolved. Recharge partial refunds use cumulative proportional credit reversals, rounded upward, and never restore credits on stale paid events.
6. Chargeback reversal is supported by the backend-only settlement RPC, but no automatic Lemon Squeezy dispute/payout event feed is configured or verified. Use documented provider evidence and a reviewed admin workflow before invoking it. Refund initiation is not exposed; no real refunds are issued by this rollout.
7. Customer payment confirmation is separate from provider payout and bank receipt. The dashboard reports unknown payout/fee/bank amounts as unverified, never as received. The read-only provider comparison checks the latest 10 records of each payment type; exhaustive paginated reconciliation is still needed before scale.
8. Run `node scripts/recharge-margin.mjs <reviewed-costs.json>`. Required measured inputs: fee_rate, fee_fixed_cents, cost_per_credit_cents, refund_reserve_rate, target_margin. Include provider invoices, failures/refunds, local GPU power and depreciation, storage, egress and other overhead. The calculator does not certify the inputs or toggle purchases. No actual unit-cost margin was verified during this rollout.
9. Enable purchases only after the owner explicitly authorizes live billing. Flags and package approval are additional gates, not permission to charge people.

## Credit integrity and monitoring

Existing wallet/reservation/billing SQL remains responsible for atomic balances and generation failure releases. The additive recharge settlement uses wallet locks, a provider-reference advisory lock, a unique payment reference, owner consistency checks and cumulative reversal guards. Browser roles cannot execute it. A wallet trigger records before/after balance and debt, DB transaction ID and UTC timestamp. The original credit ledger records reasons and provider/job references. New finance/audit tables retain pseudonymous user UUIDs without cascading account deletion; review legal retention before launch.

Read-only production audit found one pre-existing wallet discrepancy: balance 188, ledger net -308, difference +496. No wallet or historical ledger was edited. Investigate historical administrator adjustments before correcting it through an explicit, auditable adjustment. Dashboard and daily maintenance health checks surface wallet/payment mismatches, failed/stuck webhooks and high generation failures. The new audit starts at rollout; it does not reconstruct missing past history.

Existing global daily estimated budget and job concurrency limits remain. New DB controls cap estimated per-user daily spending at $5 and a single operation at $10; `loox_cost_controls` permits suspending operation IDs. These are internal conservative estimates, not verified provider invoices. Updates to model prices must update estimates before enabling a model. Automatic invoice-based cost spike detection and model circuit breakers are not yet verified. No automatic switch to a more expensive provider was introduced.

## Authentication and worker protection

Supabase `/auth/v1/user` verifies bearer tokens server-side; backend additionally checks subject, issuer, authenticated audience, expiration and not-before. Admin roles use server-controlled `app_metadata`, never editable user metadata. New financial endpoints and legacy credit adjustments require `aal2`. Other legacy admin endpoints still need a full MFA enforcement rollout. Account menu / Account Settings provide authenticator enrollment and challenge. An actual administrator must scan the QR and enter their own TOTP code; enrollment was not performed on their behalf.

API responses use no-store, nosniff, no-referrer, frame-denial CSP and restricted browser capabilities. Existing explicit origin allowlist is retained; wildcard origins are rejected. Existing per-user DB rate limits, upload decoding/size restrictions, private-media ownership filters and signed R2 URLs are covered by regression tests. This is not a claim that every platform endpoint has completed OWASP ASVS verification. Supabase's audit warned that leaked-password protection is disabled; verify plan availability and enable it through authorized account settings.

The PC worker polls outbound HTTPS; ComfyUI stays on localhost. Updated `local-worker/loox-worker.py` signs action, timestamp, random nonce and exact body digest. Server rejects bad/expired signatures and atomically consumes nonces. `LOOX_WORKER_SIGNED_REQUESTS_REQUIRED=false` preserves compatibility with the currently installed PC client. Download/install and test the updated worker, then set true. Until then, legacy bearer requests remain accepted and their replay protection is incomplete. No existing worker secret was rotated and no PC port was exposed.

## Gmail alerts and external availability

Configure `SECURITY_ALERT_EMAIL` (your Gmail), `SECURITY_ALERT_FROM` (verified sender) and `RESEND_API_KEY` server-side. These were absent; real Gmail delivery is not configured or tested. Fixed incident templates exclude request bodies, tokens, passwords and raw errors. Durable incidents deduplicate for one hour; dispatch uses provider idempotency keys and retry leases. Safe mocked delivery tests pass. Use **Send safe test alert** in the MFA-protected financial dashboard after configuring mail; confirm inbox receipt.

Backend daily maintenance performs internal health checks and retries alert delivery. GitHub Actions `uptime-check.yml` performs external backend/database/frontend checks every 30 minutes; scheduled Actions may be delayed and are not an uptime SLA. Enable GitHub failure notifications to a verified address. A dedicated external uptime provider with confirmed Gmail delivery is still not configured. Configure one independently (e.g. HTTPS GET `/api/loox?action=health`, 5-minute interval) so backend downtime can alert without relying on the backend itself. No external paid monitor was purchased.

Dependency audit and tracked-file secret-pattern scans run in security CI; Dependabot configuration is added. Pattern scanning is not exhaustive and does not replace GitHub secret scanning/history review. CI does not have Resend credentials and does not email a custom alert. The sharp image dependency was upgraded from 0.34.5 to patched 0.35.5. Do not print secret findings or full environment values in logs.

## Backups, recovery and retention

Observed Supabase organization plan: Free. No configured downloadable database backup, PITR, verified external dump or R2 recovery copy was demonstrated. Do not assume a provider's internal disaster recovery is a user-restorable backup. Cloudflare R2 lifecycle/versioning/backup settings and actual account retention were not verified. No backups were deleted or altered.

Before billing: provision encrypted external database exports on a supported runner using secret-managed credentials, retain a reviewed daily/weekly/monthly schedule, and restore to an isolated database. Verify table/row counts, wallet/credit totals, payment-reference uniqueness, grants and RLS using read-only checks. Never restore over production as a test. For media, inventory object keys/sizes/hashes and maintain an independent private copy with least-privilege credentials; test recovery of a sample to a separate prefix/bucket. Lifecycle cleanup must exclude published posts, paid records and referenced generations. Define legally reviewed billing and security retention and data-erasure handling before monetization. This procedure is prepared, not a claim of a completed backup/restore drill.

## Rollback

Frontend/backend rollbacks use Git revert of the specific implementation commits or Vercel's previous production deployment after confirming the exact LOOX project. Keep all purchase flags false. Leave additive tables and audit records in place; do not drop them as rollback. Existing pre-rollout code can use the original tables. If new cost controls cause a verified false positive, adjust `loox_cost_controls` after reviewing estimates rather than bypassing credit reservations. Never rotate credentials, refund customers, cancel subscriptions or delete data as a routine deploy rollback.

## Official references

- https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- https://docs.lemonsqueezy.com/help/webhooks/event-types
- https://docs.lemonsqueezy.com/api/orders/the-order-object
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/platform/backups
- https://github.com/lovell/sharp/releases/tag/v0.35.5
