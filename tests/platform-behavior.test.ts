import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import {getProduct} from '../src/data/catalog';
import {INSPIRATION_LAYOUTS} from '../src/data/inspiration-layouts';
import {applyInspirationLayout} from '../src/lib/inspiration';
import {createNewUserState} from '../src/lib/starter-assembly';
import type {AssemblyState,ActionResult} from '../src/lib/assembly';
const stateOf=(result:ActionResult)=>{ assert(result.ok,result.ok?'':result.reason);return result.state; };
function inventory(api:typeof web,state:AssemblyState) {
  const items=state.items.map(item=>item.productId);
  for(const p of api.getPlatforms(state)) if(p.baseInsert==='pool')items.push('pool');
  return items.sort();
}
for(const [name,api] of [['web',web],['mini',mini]] as const){
 test(`${name}: deleting any platform in every official layout retains all purchased accessories, including pools and cross-platform bridges`,()=>{
  for(const layout of INSPIRATION_LAYOUTS){
   let state=api.createInitialState();for(let i=1;i<layout.platformCount;i++)state=stateOf(api.addPlatform(state));
   const result=applyInspirationLayout(state,0,layout.id);assert(result.ok,layout.id);state=result.state;
   const expected=inventory(api,state), ids=state.items.map(i=>i.id).sort();
   for(const platform of api.getPlatforms(state)){
    const removed=stateOf(api.removePlatform(state,platform.id));
    assert.deepEqual(inventory(api,removed),expected,`${layout.id}/${platform.id}`);
    assert.deepEqual(removed.items.filter(i=>i.productId!=='pool').map(i=>i.id).sort(),ids);
    for(const item of removed.items){const before=state.items.find(i=>i.id===item.id);if(before)assert.deepEqual(item.colors,before.colors);}
    assert.equal(api.getPlatforms(removed).length,layout.platformCount-1);
    api.validateAssembly(removed);
   }
   for(const platform of api.getPlatforms(state))state=stateOf(api.removePlatform(state,platform.id));
   assert.equal(api.getPlatforms(state).length,0);assert.deepEqual(inventory(api,state),expected);
  }
 });
 test(`${name}: independent platform heights preserve existing coordinates and charge each platform's actual legs`,()=>{
  let state=stateOf(api.addPlatform(api.createInitialState()));
  const left=api.getPlacements(state,'cube-house').find(p=>p.parentId==='base')!;
  state=stateOf(api.tryPlace(state,'cube-house',left));
  const right=api.getPlacements(state,'cube-house').find(p=>p.parentId==='base2')!;
  state=stateOf(api.tryPlace(state,'cube-house',right));
  const poses=state.items.map(({x,y,z,rotation})=>({x,y,z,rotation}));
  state=stateOf(api.setLegHeight(state,200,'base2'));
  assert.deepEqual(api.getPlatforms(state).map(p=>p.legHeight),[100,200]);
  assert.deepEqual(state.items.map(({x,y,z,rotation})=>({x,y,z,rotation})),poses);
  assert.deepEqual(state.items.map(item=>api.getItemDisplayElevation(state,item)),[0,100]);
  assert.match(api.getOrderLines(state).find(line=>line.id==='base2')!.name,/20 cm/);
  state=stateOf(api.setLegHeight(state,0,'base'));
  assert.deepEqual(api.getPlatforms(state).map(p=>p.legHeight),[0,200]);
  state=stateOf(api.setLegHeight(state,300,'base2',true));
  assert.deepEqual(api.getPlatforms(state).map(p=>p.legHeight),[300,300]);
 });
 test(`${name}: thick bedding raises each short positive platform independently and preserves zero legs and taller legs`,()=>{
  let state=stateOf(api.addPlatform(stateOf(api.addPlatform(api.createInitialState()))));
  state=stateOf(api.setLegHeight(state,0,'base2'));
  state=stateOf(api.setLegHeight(state,300,'base3'));
  state=stateOf(api.setBedding(state,{mode:'thick',depth:200}));
  assert.deepEqual(api.getPlatforms(state).map(p=>p.legHeight),[200,0,300]);
  assert.deepEqual(api.getPlatforms(state).map(p=>p.elevation),[100,100,200]);
  state=stateOf(api.setBedding(state,{mode:'thin',depth:50}));
  assert.deepEqual(api.getPlatforms(state).map(p=>p.legHeight),[200,0,300]);
  let legacy=stateOf(api.addPlatform(api.createInitialState()));
  assert.equal(legacy.extension!.legHeight,undefined);
  legacy=stateOf(api.setBedding(legacy,{mode:'thick',depth:200}));
  assert.deepEqual(api.getPlatforms(legacy).map(p=>p.legHeight),[200,200]);
  let sparse=stateOf(api.removePlatform(stateOf(api.addPlatform(api.createInitialState())),'base'));
  sparse=stateOf(api.setBedding(sparse,{mode:'thick',depth:300}));
  assert.equal(sparse.legHeight,100,'an absent base does not get modified');
  assert.equal(api.getPlatformLegHeight(sparse,'base2'),300);
 });
 test(`${name}: removal keeps stable platform slots and restores a compatible ground family on adding the platform back`,()=>{
  let state=stateOf(api.addPlatform(stateOf(api.addPlatform(api.createInitialState()))));
  const candidate=api.getPlacements(state,'milk-house-double').find(p=>p.parentId==='base2')!;
  const house=api.tryPlace(state,'milk-house-double',candidate);assert(house.ok);state=house.state;
  const upper=api.getPlacements(state,'cube-house').find(p=>p.parentId===house.item.id)!;
  state=stateOf(api.tryPlace(state,'cube-house',upper));
  const before=state.items.map(i=>[i.id,i.x,i.y,i.rotation]);
  state=stateOf(api.removePlatform(state,'base2'));
  assert.deepEqual(api.getPlatforms(state).map(p=>[p.id,p.x]),[['base',0],['base3',600]]);
  assert.deepEqual(state.items.map(i=>[i.id,i.x,i.y,i.rotation]),before);
  assert.equal(state.items.find(i=>i.id===house.item.id)!.parentId,'ground');
  assert.equal(state.items.find(i=>i.id!==house.item.id)!.z,100);
  state=stateOf(api.addPlatform(state));
  assert.equal(state.items.find(i=>i.id===house.item.id)!.parentId,'base2');
  assert.equal(state.items.find(i=>i.id!==house.item.id)!.z,210);
 });
 test(`${name}: an entirely platform-free design supports loose houses and pool and follows bedding height`,()=>{
  let state=stateOf(api.removePlatform(api.createInitialState(),'base'));
  state=stateOf(api.autoPlace(state,'milk-house-aite'));
  state=stateOf(api.autoPlace(state,'pool'));
  assert.equal(api.getPlatforms(state).length,0);assert(state.items.every(i=>i.parentId==='ground'));
  for(const depth of [0,50,200] as const){
   state=stateOf(api.setBedding(state,depth===0?{mode:'none',depth}:depth===50?{mode:'thin',depth}:{mode:'thick',depth}));
   for(const item of state.items){
    const min=Math.min(...api.getItemBounds(item).map(b=>b[2]));
    assert.equal(Math.round((min+api.getItemDisplayElevation(state,item))*1000)/1000,depth);
   }
  }
 });
 test(`${name}: a down pipe remains available on a 10 cm platform beside a taller platform`,()=>{
  let state=stateOf(api.addPlatform(api.createInitialState()));state=stateOf(api.setLegHeight(state,200,'base2'));
  const candidate=api.getPlacements(state,'pipe-down').find(p=>p.parentId==='base')!;assert(candidate);
  const placed=api.tryPlace(state,'pipe-down',candidate);assert(placed.ok);
  assert.equal(placed.item.z+api.getItemDisplayElevation(placed.state,placed.item),110);
  assert.equal(api.getPlatformLegHeight(placed.state,'base2'),200);
 });
 test(`${name}: a bridge requires equal actual support heights across separate platforms`,()=>{
  let state=stateOf(api.addPlatform(api.createInitialState()));const result=applyInspirationLayout(state,0,'2D');assert(result.ok);state=result.state;
  const bridge=state.items.find(item=>getProduct(item.productId).supportMode==='bridge')!;assert(bridge);
  const mixed={...state,extension:{...state.extension!,legHeight:200 as const}};
  assert.throws(()=>api.validateAssembly(mixed),/吊桥/);
  const removed=stateOf(api.removePlatform(state,'base2'));
  assert.equal(removed.items.find(item=>item.id===bridge.id)!.parentId,'ground');
 });
}
test('starter removal retains its inserted pool and both rooftop accessories',()=>{
 const state=createNewUserState(), removed=stateOf(web.removePlatform(state,'base'));
 assert.deepEqual(inventory(web,removed),inventory(web,state));
 assert.equal(removed.items.find(i=>i.productId==='roof-cottage')!.parentId,state.items.find(i=>i.productId==='villa')!.id);
});
