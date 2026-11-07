import {need,mac,equal} from './core.js';
export function viewChallenge(user,post,now=Date.now()){
 need(post&&post.media_type==='video',404,'Public video not found.');need(post.creator_id!==user.id,400,'Creators do not count as viewers of their own posts.');
 const issued=Math.floor(now/1000),threshold=post.model_id==='generate_video'?1:5;
 return {token:issued+'.'+threshold+'.'+mac(['view',user.id,post.id,issued,threshold].join('|')),minimum_seconds:threshold};
}
export function validateView(user,post,token,now=Date.now()){
 need(typeof token==='string'&&/^\d{10}\.[15]\.[a-f0-9]{64}$/.test(token),400,'Invalid playback session.');
 const [stamp,seconds,signature]=token.split('.'),issued=Number(stamp),threshold=Number(seconds),current=Math.floor(now/1000);
 need(current-issued>=threshold&&current-issued<=600,400,'Playback threshold not reached or session expired.');
 need(equal(signature,mac(['view',user.id,post.id,issued,threshold].join('|'))),400,'Invalid playback session.');return threshold;
}
