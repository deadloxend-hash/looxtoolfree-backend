import test from 'node:test';
import assert from 'node:assert/strict';
import {viewChallenge,validateView} from '../lib/video-views.js';
test('meaningful views need an account-bound playback session and elapsed watch threshold',()=>{
 process.env.LOOX_IDENTITY_SECRET='test-views';const u={id:'viewer'},p={id:'post',creator_id:'creator',media_type:'video',model_id:'video_wan25_i2v_5'},now=1794052200000;
 const q=viewChallenge(u,p,now);assert.equal(q.minimum_seconds,5);assert.throws(()=>validateView(u,p,q.token,now+4000),/threshold/);assert.equal(validateView(u,p,q.token,now+5000),5);assert.throws(()=>validateView({id:'other'},p,q.token,now+5000),/Invalid/);assert.throws(()=>validateView(u,{...p,id:'other'},q.token,now+5000),/Invalid/);assert.throws(()=>validateView(u,p,q.token,now+601000),/expired/);assert.throws(()=>viewChallenge({id:'creator'},p,now),/own posts/);assert.equal(viewChallenge(u,{...p,model_id:'generate_video'},now).minimum_seconds,1);
});
