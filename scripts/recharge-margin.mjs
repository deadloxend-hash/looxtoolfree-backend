// Run with a reviewed JSON cost file: node scripts/recharge-margin.mjs /secure/path/costs.json
// No defaults: missing measured inputs must never be mistaken for zero cost.
import {readFileSync} from 'node:fs';
import {draftPackages} from '../src/config/billing.js';
const path=process.argv[2];if(!path){console.error('Provide reviewed JSON: fee_rate, fee_fixed_cents, cost_per_credit_cents, refund_reserve_rate, target_margin. cost_per_credit_cents must include provider bills, GPU electricity/depreciation, storage and failures.');process.exit(2);}
const c=JSON.parse(readFileSync(path,'utf8'));
for(const key of ['fee_rate','fee_fixed_cents','cost_per_credit_cents','refund_reserve_rate','target_margin'])if(!Number.isFinite(c[key])||c[key]<0)throw Error('Invalid or missing cost field: '+key);
if(c.fee_rate>=1||c.refund_reserve_rate>=1||c.target_margin>=1)throw Error('Rates must be below 1.');
const rows=draftPackages.map(p=>{const fees=p.price_cents*c.fee_rate+c.fee_fixed_cents,reserve=p.price_cents*c.refund_reserve_rate,cost=p.credits*c.cost_per_credit_cents,profit=p.price_cents-fees-reserve-cost,margin=profit/p.price_cents;return {package:p.id,price_usd:p.price_cents/100,credits:p.credits,cost_usd:cost/100,fees_usd:fees/100,refund_reserve_usd:reserve/100,profit_usd:profit/100,margin,target_pass:margin>=c.target_margin};});
console.log(JSON.stringify({source:path,proposals_only:true,packages:rows},null,2));
