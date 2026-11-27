import test from 'node:test';
import assert from 'node:assert/strict';
import {hosted} from '../lib/billing.js';
test('provider checkout and portal URLs reject lookalikes, credentials and unexpected ports',()=>{
 for(const value of ['https://store.lemonsqueezy.com/checkout/fixture','https://lemonsqueezy.com/my-orders'])assert.equal(hosted(value),value);
 for(const value of ['javascript:alert(1)','https://lemonsqueezy.com.attacker.invalid','https://fakelemonsqueezy.com','http://store.lemonsqueezy.com','https://user:password@store.lemonsqueezy.com','https://store.lemonsqueezy.com:8443','invalid',undefined])assert.throws(()=>hosted(value),e=>e.status===503);
});
