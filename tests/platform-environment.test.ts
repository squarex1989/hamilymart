import test from 'node:test';
import assert from 'node:assert/strict';
import { getLayoutFootprint } from '../src/lib/layout-footprint';
import { getBeddingBounds } from '../src/lib/bedding-scene';
import { getCageBounds } from '../src/lib/cage-scene';
import { addPlatform, autoPlace, createInitialState, removePlatform, type ActionResult } from '../src/lib/assembly';
import { applyInspirationLayout, findInspirationLayout } from '../src/lib/inspiration';
const ok=(r:ActionResult)=>{assert(r.ok,r.ok?'':r.reason);return r.state};
test('empty and fully grounded scenes retain finite cage, bedding and camera footprints',()=>{
 let state=ok(removePlatform(createInitialState(),'base'));
 for(const current of [state,{...state,cage:null}]){
  assert(Object.values(getLayoutFootprint(current)).every(Number.isFinite));
  assert(Object.values(getBeddingBounds(current)).every(Number.isFinite));
 }
 state=ok(autoPlace(state,'milk-house-aite'));
 const bounds=getLayoutFootprint(state),cage=getCageBounds(state)!;
 assert.equal(cage.getCenter(cage.min.clone()).x,(bounds.minX+bounds.maxX)/2);
 assert.equal(cage.max.x-cage.min.x,state.cage!.width*10);
 const bedding=getBeddingBounds({...state,cage:null});
 assert.equal(bedding.minX,bounds.minX-50);assert.equal(bedding.maxX,bounds.maxX+50);
});
test('inspiration preserves independent heights and sparse slot positions',()=>{
 let state=ok(addPlatform(ok(addPlatform(createInitialState()))));
 state=ok(removePlatform(state,'base2'));
 state={...state,thirdPlatform:{...state.thirdPlatform!,legHeight:200}};
 // One of the authored two-platform designs with no bridging between decks.
 const result=applyInspirationLayout(state,0,'2A');assert(result.ok,result.ok?'':result.reason);
 assert.equal(result.state.extension,null);assert.equal(result.state.thirdPlatform?.legHeight,200);
 assert(result.state.items.some(item=>item.parentId==='base3'&&item.x>=600));
 assert.equal(findInspirationLayout(result.state)?.id,'2A');
});
