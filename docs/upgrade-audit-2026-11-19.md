# LOOX platform upgrade audit — 2026-11-19

Implemented backend changes:
- Free-only Assistant requests; legacy conversations remain available through the existing history API. Daily abuse limits remain server-side. Rate-limit errors include the actual reset timestamp when known.
- Explicit adapter capability registry with source-schema URLs, supported inputs, configured output sizes, end-frame restrictions, audio behavior and reference limits. The interface advertises the implemented adapter subset, not every theoretical provider feature. Existing priced durations and costs are preserved.
- Five runnable workflow starters use the authenticated generation queue and existing ledger. Image workflows use FLUX; video workflows use configured video adapters. One generation step plus manual review/export is supported. Multi-generation pipelines, video editing and extra reference sets are not implemented.
- Additive, service-only quoted reservation function locks the wallet and operation price inside a transaction. Changed prices fail before deduction. Legacy reserve remains unchanged. The migration was applied and role permissions verified in production.
- Video output download cap now matches the existing 40 MB finalization limit, and failed finalization is handled explicitly.

Production read-only audit: plans are Basic 25 signup credits, Creator $12/500, Pro $29/1500, Business $69/4000. No negative wallets and no duplicate (user, reason, reference) credit entries were found. The configured reward remains 5 credits every 12 hours with balance cap 50. Authenticated clients cannot update wallets or insert credit entries; only service_role can execute the new quoted reservation.

Tests: all 50 backend tests passed before deployment, including current migration pricing, reward concurrency/replay, successful reservations, duplicate requests, altered-digest conflicts, failed-job refunds, competing insufficient-balance requests, forged quotes, billing replay/refunds, access control and runnable workflow dispatch. Tests run against isolated PostgreSQL WASM and mocks; no customer generation, subscription or payment was created.

Security advisor: server-only tables have RLS enabled without client policies (intentional deny-by-default); leaked-password protection remains disabled and needs owner review: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . No live payment activation or credential changes were made.

Verification limits: configured provider credentials and schema compatibility do not prove that every paid provider currently renders successfully. No paid production-generation matrix was run. Physical Android/iOS keyboard behavior and signed-in avatar/check-in interactions require device/account verification. Existing public image model availability remains behind its verification gates.
