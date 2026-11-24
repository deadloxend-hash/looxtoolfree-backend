# Verification record — 24 November 2026

- Backend `npm test`: 75 passed, 0 failed. Includes mocked prediction creation, pinned schema-version submission, no paid requests without approval, ambiguous submission handling, webhook authentication, SSRF/size rejection, price validation, PostgreSQL credit reservations/refunds/duplicate claims/budget rollback and service-only permissions.
- Frontend regression suite: 23 passed, 0 failed.
- Private Control Center gateway suite: 2 passed, 0 failed; module syntax checked.
- Static frontend audit: 640 pages, 18,512 references, 0 problems.
- Production additive migration applied successfully. All three engine tables have RLS enabled; anonymous RPC execution and authenticated config reads are denied. All 40 model policies and the global engine remain disabled. Existing wallet count, balance total and debt total match the pre-migration snapshot. Existing provider caps remain $2 daily / $30 monthly / $1 per generation.
- Preview: opened the image studio and model sheet through the supported browser. Without a preview-origin API configuration, catalog details degrade safely to unavailable; no invented live model availability. Mobile-width automated UI checks run in the repository's existing GitHub Actions workflow after push. This local preview is not a live provider or logged-in account test.
- Security advisor: new tables produce expected informational RLS-without-policy entries because access is intentionally service-only. Existing leaked-password-protection warning remains; enabling that Supabase Auth setting may require project-plan configuration. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . No auth protections were weakened.
- Billable generation tests: none. No API credit purchase, provider recharge, checkout activation or customer balance adjustment.

Production deployment and GitHub Actions results are reported separately after publishing. A model is not considered functional merely because a mock test or catalog lookup passes.

Modified backend areas: `src/ai/` registry/provider/engine/admin, `api/loox-engine-webhook.js`, `api/loox.js`, `api/loox-maintenance.js`, shared `lib/image-cloud.js`, `lib/video-cloud.js`, `lib/jobs.js`, `lib/control-center.js`, security-alert templates, `.env.example`, additive SQL, regression tests, rollback adapter archives and this reproducible audit.

Modified frontend areas: image/video generator modules, shared model picker, three studio entry HTML files and privacy policy. Modified private administration: gateway action allowlist, model-management UI and script cache version. MediaGrab was not modified.
