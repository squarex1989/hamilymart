import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntroductionDesigns, createMagnetDemonstration, createBeddingDemonstration, ONBOARDING_DURATIONS, hasSeenIntroduction, rememberIntroduction, ONBOARDING_KEY, introductionPhase } from '../src/lib/onboarding';
import { createInitialState, getPlatforms, validateAssembly } from '../src/lib/assembly';
import { createDraftStorage, type DraftStorage } from '../src/lib/storage';

test('intro demos use valid 1/2/3 platform designs, changing layouts and palettes without modifying a draft',()=>{
 const draft=createInitialState(),before=JSON.stringify(draft),designs=createIntroductionDesigns();
 assert.deepEqual(designs.map(d=>getPlatforms(d.state).length),[1,2,3]);
 assert.equal(new Set(designs.map(d=>d.layout)).size,3);
 assert.equal(new Set(designs.map(d=>JSON.stringify(d.state.baseColors))).size,3);
 for(const d of designs){assert.ok(d.state.items.length>0);assert.ok(validateAssembly(d.state));}
 assert.equal(JSON.stringify(draft),before);
});
test('magnet demo has components on the platform and a real matching roof attachment',()=>{
 const state=createMagnetDemonstration(),house=state.items.find(i=>i.productId==='l-house')!;
 assert.equal(state.items.find(i=>i.productId==='cube-house')!.parentId,house.id);
 assert.equal(state.items.find(i=>i.productId==='stairs-right-1')!.parentId,'base');
 assert.deepEqual(state.items.map(i=>i.productId),['l-house','cube-house','stairs-right-1']);
 assert.ok(validateAssembly(state));
});
test('intro dismissal flag persists independently through native storage',async()=>{
 const data=new Map<string,string>([['draft','unchanged']]);const writes:string[]=[];
 const store=await createDraftStorage({xhs:{launchOptions:{miniToolEnv:{buildVersion:9460000}},miniTool:{
  getStorage:async({key})=>({data:data.get(key)??null}),setStorage:async({key,data:value})=>{writes.push(key);data.set(key,value);}
 }},getBrowserStorage(){throw Error('native storage required');}});
 assert.equal(await hasSeenIntroduction(store),false);
 assert.equal(await rememberIntroduction(store),true);
 assert.equal(await hasSeenIntroduction(store),true);
 assert.deepEqual(writes,[ONBOARDING_KEY]);assert.equal(data.get('draft'),'unchanged');
});
test('unavailable storage does not throw or pretend dismissal was saved',async()=>{
 const store:DraftStorage={backend:'native',read:async()=>{throw Error('unavailable')},write:async()=>{throw Error('unavailable')}};
 assert.equal(await hasSeenIntroduction(store),false);assert.equal(await rememberIntroduction(store),false);
});
test('each page ends on its final step instead of accessing an absent layout',()=>{
 assert.deepEqual([0,1999,2000,4000,6000].map(t=>introductionPhase(0,t)),[0,0,1,2,2]);
 assert.deepEqual(ONBOARDING_DURATIONS,[6000,12000,8000,12000]);
 assert.equal(introductionPhase(1,12000),2);assert.equal(introductionPhase(2,8000),3);assert.equal(introductionPhase(3,12000),2);
});

test('bedding example connects the inside of the Christmas villa through its real removable hole',()=>{
 const state=createBeddingDemonstration(),pipe=state.items.find(i=>i.productId==='pipe-down')!;
 assert.equal(state.bedding.depth,100);assert.ok(state.items.some(i=>i.productId==='villa'));
 assert.deepEqual([pipe.x,pipe.y,pipe.z,pipe.rotation],[50,250,110,0]);
 assert.ok(getPlatforms(state)[0].removedCovers.includes('H01'));assert.ok(validateAssembly(state));
});
