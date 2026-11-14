import {rpc} from '../../lib/core.js';
import {incident} from '../notifications/security-alerts.js';
export async function monitorBilling(){
 const health=await rpc('billing_health',{});
 if(health.wallet_mismatches||health.payment_mismatches||health.pending_events)await incident('reconciliation');
 if(health.jobs_24h>=10&&health.failed_jobs_24h/health.jobs_24h>=0.5)await incident('generation_failure');
 return health;
}
