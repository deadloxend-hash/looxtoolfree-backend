# LOOX AI — Cloudflare R2 activation checklist

Verified bucket: `looxai`, Cloudflare account `f2a4219d5ff90f0d2808c747a9892ec9`.
Status: **backend adapter staged but NOT live** until secure S3 credentials are configured and an end-to-end signed-in test passes.

## Existing safeguards
- Existing Supabase authentication, jobs, storage references, public community feed and media URLs remain unchanged.
- `api/r2-media.js` is a separate signed-in-only image gateway; it does not receive video uploads or automatically create community posts.
- Only JPEG/PNG/WebP image uploads, maximum 2 MiB, decoded, resized and re-encoded as WebP. Maximum 5 attempts per hour per authenticated user.
- Read access requires the authenticated owner's own object prefix.
- No R2 keys are shipped in GitHub Pages or committed to GitHub.
- The R2 bucket must remain private.
- The project must implement whole-bucket storage accounting, garbage collection, reliable media metadata and public consent-controlled delivery **before** switching community media uploads at scale. An hourly rate limit is not a storage spending cap.

## To enable the adapter
Create an **R2 S3 API token**, restricted to the `looxai` bucket, via the Cloudflare R2 dashboard. The Cloudflare account connector does **not** expose R2 S3 credentials. Store these directly in Vercel > looxtoolfree-backend > Settings > Environment Variables (Production):
- `LOOX_R2_ACCESS_KEY_ID` — encrypted/sensitive
- `LOOX_R2_SECRET_ACCESS_KEY` — encrypted/sensitive

The following **non-secret** production variables have already been configured:
- `LOOX_R2_ACCOUNT_ID`
- `LOOX_R2_BUCKET=looxai`

Do not paste the secret into chat, source files, screenshots, or GitHub issues.
Redeploy Vercel after setting variables.

## Smoke test (no paid AI inference)
1. Verify `GET /api/loox?action=config` returns `r2Media.configured:true` without exposing keys.
2. Sign in with a verified LOOX account; upload a small test image via `POST /api/r2-media` with JSON `{ "image": "data:image/png;base64,..." }` and the normal bearer session token.
3. Verify the returned path is under `<user-id>/community/` and that a signed-in `GET /api/r2-media?path=<path>` returns a valid image.
4. Verify anonymous GET, another account's GET, oversized uploads and unsupported formats are rejected.
5. Verify only the intended private R2 bucket receives the test object.
6. Clean up the synthetic test file using privileged admin tooling after confirming the owner.
7. Continue to serve existing media from Supabase until reference-migration and signed public approved-post delivery pass full acceptance.

## Not done
- Connecting the existing generator, community publish, private history, admin media and deletion workflows to R2.
- Browser media and video upload flows with server-validated 5-minute limits.
- Full storage quotas, migration, cleanup and private/public delivery.
- End-to-end signed-in tests; no R2 S3 credentials were supplied.
