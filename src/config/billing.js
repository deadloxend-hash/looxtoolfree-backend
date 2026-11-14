// All purchase gates are opt-in. Historic subscription events use a separate gate.
export const annualBillingEnabled=()=>process.env.ANNUAL_BILLING_ENABLED==='true';
export const paymentsEnabled=()=>process.env.PAYMENTS_ENABLED==='true'&&(process.env.PAYMENT_PROVIDER||'lemonsqueezy')==='lemonsqueezy';
export const topupsEnabled=()=>paymentsEnabled()&&process.env.CREDIT_TOPUPS_ENABLED==='true'&&process.env.TOPUP_MARGIN_APPROVED==='true';
export const flags=()=>({annualBillingEnabled:annualBillingEnabled(),paymentsEnabled:paymentsEnabled(),creditTopupsEnabled:topupsEnabled(),provider:'lemonsqueezy'});
export const creditPolicy={allocation:'Shared wallet; grants and deductions are recorded in transaction order.',spending:'Credits are fungible in the existing shared wallet; every generation reserves credits atomically.',expiration:'Existing and proposed purchased credits do not expire. Unused subscription credits roll over.',refunds:'Verified refunds reverse the corresponding allocation. Spent refunded credits create debt and block generation until settled.',starter:'25 credits once after verified signup. Existing manual return rewards remain separate.'};
// Draft server-side catalog only; no package may be purchased until explicitly approved.
export const draftPackages=[{id:'mini',name:'Mini Recharge',credits:100,price_cents:500},{id:'creator_boost',name:'Creator Boost',credits:300,price_cents:1000},{id:'power',name:'Power Pack',credits:750,price_cents:2500},{id:'pro_recharge',name:'Pro Recharge',credits:1500,price_cents:4500}];
