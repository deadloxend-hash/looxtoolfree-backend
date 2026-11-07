import test from 'node:test';
import assert from 'node:assert/strict';
import {videoQuote,validateVideoQuote,cloudVideoOperations} from '../lib/video-cloud.js';
test('video quote binds duration, account and backend price; forged prices cannot alter it',()=>{
 process.env.LOOX_IDENTITY_SECRET='test-quote-key';const u={id:'owner'},ops=[{id:'video_wan25_i2v_5',cost:35},{id:'video_wan25_i2v_10',cost:70}],b={model:'wan25_i2v',duration:5,ratio:'16:9',credits:1},now=1794052200000;
 const q=videoQuote(u,b,ops,now);assert.equal(q.credits,35);assert.equal(videoQuote(u,{...b,duration:10},ops,now).credits,70);assert.equal(validateVideoQuote(u,{...b,quoteToken:q.token},ops,now).credits,35);
 assert.throws(()=>validateVideoQuote({id:'another'},{...b,quoteToken:q.token},ops,now),/changed/);assert.throws(()=>validateVideoQuote(u,{...b,duration:10,quoteToken:q.token},ops,now),/changed/);assert.throws(()=>validateVideoQuote(u,{...b,quoteToken:q.token},[{...ops[0],cost:36}],now),/changed/);assert.throws(()=>validateVideoQuote(u,{...b,quoteToken:q.token},ops,now+301000),/expired/);
 assert.throws(()=>videoQuote(u,{...b,duration:15},ops,now),/supported duration/);assert.throws(()=>videoQuote(u,{...b,resolution:'4K'},ops,now),/configured output/);assert.ok(cloudVideoOperations.includes('video_wan25_i2v'));
});
