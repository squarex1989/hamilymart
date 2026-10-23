import test from 'node:test';import assert from 'node:assert/strict';
import * as web from '../src/lib/assembly';import * as mini from '../minitool/src/lib/assembly';
import {getProduct} from '../src/data/catalog';import {encodeConfig,decodeConfig} from '../src/lib/config-code';
for(const [name,api] of [['web',web],['mini',mini]] as const){
 test(`${name}: hanging elbow uses the five holes, hides only occupied lids and roundtrips`,()=>{
  let s=api.createInitialState();assert.equal(getProduct('pipe-down').price,800);
  const points=([0,90,180,270] as const).flatMap(r=>api.getPlacements(s,'pipe-down',r));assert.equal(new Set(points.map(p=>`${p.x}:${p.y}`)).size,5);
  const chosen=points[0];const r=api.tryPlace(s,'pipe-down',chosen,chosen.rotation);assert.ok(r.ok);s=r.state;
  assert.equal(api.getPlatforms(s)[0].removedCovers.length,1);assert.equal(s.removedCovers.length,0);
  assert.equal(api.getPlacements(s,'pipe-down',chosen.rotation).some(p=>p.x===chosen.x&&p.y===chosen.y),false);
  assert.equal(api.setCoverRemoved(s,'base',api.getPlatforms(s)[0].removedCovers[0],false).ok,false);
  const decoded=decodeConfig(encodeConfig(s));assert.equal(decoded.items[0].productId,'pipe-down');assert.equal(api.getPlatforms(decoded)[0].removedCovers.length,1);
  assert.equal(api.getPlatforms(api.removeItem(s,r.item.id))[0].removedCovers.length,0);
  const rotated=api.rotateItem(s,r.item.id);assert.ok(rotated.ok);
 });
 test(`${name}: an explicitly opened cover stays open after removing the elbow`,()=>{
  let s=api.createInitialState();const opened=api.setCoverRemoved(s,'base','H01',true);assert.ok(opened.ok);s=opened.state;
  const r=api.tryPlace(s,'pipe-down',{x:50,y:250,z:110},0);assert.ok(r.ok);
  assert.deepEqual(api.getPlatforms(api.removeItem(r.state,r.item.id))[0].removedCovers,['H01']);
 });
 test(`${name}: downward entrances can sit inside empty rooms; extension covers remain independent`,()=>{
  let s=api.createInitialState();const house=api.tryPlace(s,'cube-house',{x:50,y:250,z:110});assert.ok(house.ok);
  assert.equal(api.getPlacements(house.state,'pipe-down').some(p=>p.x===50&&p.y===250),true);
  const extension=api.addPlatform(s);assert.ok(extension.ok);s=extension.state;
  const p=api.getPlacements(s,'pipe-down').find(p=>p.parentId==='base2')!;assert.ok(p);const r=api.tryPlace(s,'pipe-down',p);assert.ok(r.ok);
  assert.equal(api.getPlatforms(r.state)[0].removedCovers.length,0);assert.equal(api.getPlatforms(r.state)[1].removedCovers.length,1);
 });
}

import { getInteractionPlacements as webTargets } from '../src/lib/placement-targets';
import { getInteractionPlacements as miniTargets } from '../minitool/src/lib/placement-targets';
for(const [name,api,targets] of [['web',web,webTargets],['mini',mini,miniTargets]] as const){
 test(`${name}: dragging inserts reaches all five closed or open holes and restores manual cover state`,()=>{
  let s=api.createInitialState();
  const opened=api.setCoverRemoved(s,'base','H01',true);assert.ok(opened.ok);s=opened.state;
  const destinations=targets(s,'pipe-down',0);
  assert.equal(destinations.length,5);
  let itemId:string|undefined;
  for(const destination of destinations){
    const available=targets(s,'pipe-down',0,itemId).find(p=>p.x===destination.x&&p.y===destination.y)!;
    assert.ok(available,`hole ${destination.x}/${destination.y}`);
    const placed=api.tryPlace(s,'pipe-down',available,available.rotation,{},itemId);
    assert.ok(placed.ok,JSON.stringify(placed));s=placed.state;itemId=placed.item.id;
    assert.deepEqual(s.removedCovers,['H01'],'automatic removals never become manual edits');
    assert.ok(api.getPlatforms(s)[0].removedCovers.includes('H01'));
    assert.ok(api.getPlatforms(s)[0].removedCovers.length<=2,'previous automatic opening recovers after movement');
  }
  assert.deepEqual(api.getPlatforms(api.removeItem(s,itemId!))[0].removedCovers,['H01']);
 });
 test(`${name}: targets prefer current pipe orientation while providing one target per hole`,()=>{
  const s=api.createInitialState();
  for(const turn of [0,90,180,270] as const){
    const available=targets(s,'pipe-down',turn);
    const same=api.getPlacements(s,'pipe-down',turn);
    assert.equal(available.length,5);
    for(const p of same)assert.equal(available.find(c=>c.x===p.x&&c.y===p.y)!.rotation,turn);
  }
 });
}

for(const [name,api] of [['web',web],['mini',mini]] as const){
 test(`${name}: room placement is symmetric, respects walls, and round-trips indoor access`,()=>{
  const base=api.createInitialState();
  const pipe=api.tryPlace(base,'pipe-down',{x:150,y:250,z:110},0);assert.ok(pipe.ok);
  const house=api.tryPlace(pipe.state,'pokemon-center',{x:150,y:200,z:110},0);assert.ok(house.ok);
  const restored=decodeConfig(encodeConfig(house.state));assert.equal(restored.items.length,2);
  const houseFirst=api.tryPlace(base,'pokemon-center',{x:150,y:200,z:110},0);assert.ok(houseFirst.ok);
  for(const turn of [0,90,180,270] as const){
   const valid=api.getPlacements(houseFirst.state,'pipe-down',turn).find(p=>p.x===150&&p.y===250);
   if(valid)assert.ok(api.tryPlace(houseFirst.state,'pipe-down',valid,turn).ok);
  }
  const blocked={...houseFirst.state,items:houseFirst.state.items.map(i=>({...i,y:160}))};
  assert.equal(api.getPlacements(blocked,'pipe-down').some(p=>p.x===150&&p.y===250),false,'mouth cannot cut a rear wall');
  assert.equal(api.getPlacements(houseFirst.state,'pipe-st1').some(p=>p.x===150&&p.y===250),false,'ordinary pipe must not bypass house collision');
  const remove=api.removeItem(house.state,pipe.item.id);
  assert.equal(api.getPlatforms(remove)[0].removedCovers.length,0,'automatic cover restores inside the room');
 });
}
