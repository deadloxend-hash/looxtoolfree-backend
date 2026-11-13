# Membership release — 13 November 2026

| Plan | Monthly | Yearly | Credits monthly / yearly |
|---|---:|---:|---:|
| Basic | Free | Free | 10 once at verified signup |
| Creator | $12 | $120 | 100 / 1,200 |
| Pro | $29 | $290 | 250 / 3,000 |

Annual credits arrive together after the annual invoice is paid. Monthly credits arrive after each monthly payment. No new Lifetime purchases. Historical paid Lifetime entitlements and refunds remain supported.

The comparison page calculates alternatives from one shared credit balance. An image allowance and a video allowance are not separate pools. Local FLUX images cost 3 credits, yielding 33/83 images per monthly Creator/Pro balance when the GPU is online. Video estimates use selected model, duration and live database charges.

## Cost controls and contribution estimate

Every operation reserves a conservative compute ceiling. Its credit price is at least ceil(max_millicents/4000): at most $0.04 of reserved compute per purchased credit. The cheapest annual credit sells for about $0.09667. A 10% + $1 payment reserve is an illustrative allowance for fees, not a quotation from the payment processor.

| Cycle | Revenue | Max reserved compute | Illustrative payment reserve | Remaining before other costs |
|---|---:|---:|---:|---:|
| Creator month | $12 | $4 | $2.20 | $5.80 |
| Pro month | $29 | $10 | $3.90 | $15.10 |
| Creator year | $120 | $48 | $13 | $59 |
| Pro year | $290 | $120 | $30 | $140 |

These are contribution estimates, not guaranteed net profit. Hosting, storage, local electricity/hardware, refunds, taxes, fraud and changing provider tariffs still affect results. Free accounts have no subscription revenue: signup/rewards are acquisition spend. Global generation budgets remain enforced. Review live provider invoices regularly and update the database ceilings before enabling more expensive settings.

## Return reward

Basic accounts may manually collect 1 credit every 12 hours after their first signed-in visit. Balance must be below 10 and debt must be zero. Missed claims do not stack. Eligibility and time come from PostgreSQL. The keyed email cooldown survives account deletion; no raw email is stored in reward state. Wallet/identity row locks and unique ledger references prevent replay and simultaneous claims. The backend requires verified email and applies account and network rate limits. Distinct verified accounts can still be abused: no system can promise immunity to account farms.

## Models and launch boundaries

Added adapters: Kling 4.0/Flash, Seedance 2.5/2.0 Fast, Grok Imagine Video, Veo 3.1/Lite, MiniMax H3/Lite, Wan 3.0 and Luma Ray 2. Existing models remain. Outputs are pinned to the priced resolution and allowlisted durations. H3 uses 768P and undiscounted list-price ceilings. Reference video/editing, arbitrary durations and higher resolutions are rejected so inputs cannot inflate cost. First/last-frame conditioning is exposed only where mapped by the adapter.

FLUX 3 remains visible but disabled pending verified early-access billing and a successful provider test. Sora 2 is unavailable: Replicate's page carries a September 24, 2026 discontinuation notice. No fabricated live model or free generation promise.

Provider sources checked:
- https://replicate.com/kwaivgi/kling-v4.0/readme
- https://replicate.com/kwaivgi/kling-v4-flash/readme
- https://replicate.com/bytedance/seedance-2.5
- https://replicate.com/bytedance/seedance-2.0-fast
- https://replicate.com/xai/grok-imagine-video
- https://replicate.com/google/veo-3.1-lite/readme
- https://replicate.com/minimax/h3-lite
- https://replicate.com/blog/which-minimax-h3-model/
- https://replicate.com/alibaba/wan-3
- https://replicate.com/luma/ray-2-720p
- https://replicate.com/black-forest-labs/flux-3
- https://replicate.com/openai/sora-2

## Merchant configuration still required

Set server-only LEMON_API_KEY, LEMON_STORE_ID, LEMON_WEBHOOK_SECRET and LEMON_MODE. Create four subscription variants with the exact prices/intervals above and set LEMON_CREATOR_VARIANT, LEMON_CREATOR_YEARLY_VARIANT, LEMON_PRO_VARIANT, LEMON_PRO_YEARLY_VARIANT. Checkout verifies provider price, fixed quantity, subscription interval and signed account/plan binding. Webhooks verify signatures, store, mode and configured variant; invoice references grant credits only once. Payment flow must receive a real signed test invoice before accepting real customers. API changes cannot create an approved merchant account or its credentials.

## Validation and security limits

Backend tests cover reward replay/cooldown/deletion, RPC permissions, premium access, annual credit grants/refunds, signed quotes, owner filters, private R2 storage and provider input contracts. Frontend tests cover sheet scroll restoration, session persistence and social actions. No live paid generation or real payment was executed in this release.

Supabase's advisor reports leaked-password protection disabled. This connection does not expose Auth configuration updates; enable it in Supabase Auth settings if the project plan supports it. Backend-only tables deliberately have RLS and no client policies. No claim of a complete penetration test or an unhackable site is made.
