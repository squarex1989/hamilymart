import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import { VISIBLE_PRODUCTS } from '../src/data/catalog';

for (const [runtime, api] of [['web',web],['mini',mini]] as const) {
  test(`${runtime}: Pokemon defaults face forward, retain four contacts, and keep the whole roof within the platform`, () => {
    let state = api.createInitialState();
    for (let i=0;i<3;i++) { const r=api.addPlatform(state);assert.ok(r.ok);state=r.state; }
    for (let i=0;i<4;i++) {
      const r=api.autoPlace(state,'pokemon-center');assert.ok(r.ok);assert.ok(r.item);
      assert.equal(r.item.rotation,0,'the -Y source door must face the front');
      assert.deepEqual([r.item.x,r.item.y,r.item.z],[150+i*300,200,110]);
      const placement=api.getPlacements(state,'pokemon-center',0).find(p=>p.x===r.item!.x&&p.y===r.item!.y)!;
      assert.equal(placement.magnetCount,4);
      assert.deepEqual(api.getAutomaticPlacementIssues(state,'pokemon-center',placement),[]);
      for(const b of api.getVisualItemBounds(r.item)){
        assert.ok(b[0]>=i*300 && b[3]<=i*300+300 && b[1]>=0 && b[4]<=300);
      }
      state=r.state;
    }
    assert.equal(api.autoPlace(state,'pokemon-center').ok,false);
  });

  test(`${runtime}: safe suggestions reject back-facing Pokemon and accept the trimmed rear roof`, () => {
    const state=api.createInitialState();
    const back=api.getPlacements(state,'pokemon-center',180)[0];
    assert.ok(api.getAutomaticPlacementIssues(state,'pokemon-center',back).includes('door-facing-away'));
    const rear=api.getPlacements(state,'pokemon-center',0).find(p=>p.y===200)!;
    assert.deepEqual(api.getAutomaticPlacementIssues(state,'pokemon-center',rear),[]);
    const front=api.getPlacements(state,'pokemon-center',0).find(p=>p.y===120)!;
    const obstructed={...state,items:[{id:'obstacle',productId:'cube-house',x:150,y:50,z:110,rotation:0 as const,parentId:'base',colors:{SHB:'pine' as const,SHR:'cream' as const}}]};
    assert.ok(api.getAutomaticPlacementIssues(obstructed,'pokemon-center',front).includes('door-blocked'));
  });

  test(`${runtime}: default floor products stay inside the platform, including single-magnet accessories`, () => {
    const state=api.createInitialState();
    for(const product of VISIBLE_PRODUCTS.filter(p=>p.id!=='pool'&&p.id!=='sag-bridge')){
      const r=api.autoPlace(state,product.id);assert.ok(r.ok,product.id);assert.ok(r.item,product.id);
      for(const bounds of api.getVisualItemBounds(r.item))assert.ok(bounds[0]>=-.015&&bounds[1]>=-.015&&bounds[3]<=300.015&&bounds[4]<=300.015,product.id);
    }
  });

  test(`${runtime}: four-platform reflow does not turn automatic pipe covers into manual removals`, () => {
    let state=api.createInitialState();
    for(let i=0;i<3;i++){const r=api.addPlatform(state);assert.ok(r.ok);state=r.state;}
    const target=api.getPlacements(state,'pipe-down').find(p=>p.parentId==='base4')!;
    const placed=api.tryPlace(state,'pipe-down',target);assert.ok(placed.ok);
    assert.equal(placed.state.fourthPlatform!.removedCovers.length,0);
    const removed=api.removePlatform(placed.state,'base2');assert.ok(removed.ok);
    assert.equal(removed.state.thirdPlatform!.removedCovers.length,0);
    const restored=api.removeItem(removed.state,placed.item.id);
    assert.deepEqual(api.getPlatforms(restored).map(p=>p.removedCovers),[[],[],[]]);
  });
}

import { getInteractionPlacements as webTargets } from '../src/lib/placement-targets';
import { getInteractionPlacements as miniTargets } from '../minitool/src/lib/placement-targets';
for (const [runtime,api,targets] of [['web',web,webTargets],['mini',mini,miniTargets]] as const) {
  test(`${runtime}: cross-platform pipe dragging and first-platform removal retain only manual cover edits`, () => {
    let state=api.createInitialState();
    for(let i=0;i<3;i++){const r=api.addPlatform(state);assert.ok(r.ok);state=r.state;}
    for(const id of ['base2','base4'] as const){const r=api.setCoverRemoved(state,id,'H01',true);assert.ok(r.ok);state=r.state;}
    let itemId:string|undefined;
    for(const id of ['base2','base4'] as const){
      const destination=targets(state,'pipe-down',0,itemId).find(p=>p.parentId===id&&p.y===50)!;
      assert.ok(destination);
      const r=api.tryPlace(state,'pipe-down',destination,destination.rotation,{},itemId);assert.ok(r.ok);state=r.state;itemId=r.item.id;
      assert.deepEqual(state.extension!.removedCovers,['H01']);
      assert.deepEqual(state.fourthPlatform!.removedCovers,['H01']);
    }
    assert.deepEqual(api.getPlatforms(state)[1].removedCovers,['H01'],'old automatic hole recovers before reflow');
    const removed=api.removePlatform(state,'base');assert.ok(removed.ok);state=removed.state;
    assert.deepEqual(state.removedCovers,['H01']);assert.deepEqual(state.thirdPlatform!.removedCovers,['H01']);
    state=api.removeItem(state,itemId!);
    assert.deepEqual(api.getPlatforms(state).map(p=>p.removedCovers),[['H01'],[],['H01']]);
  });

  test(`${runtime}: a free large hole accepts a pool even within a door's approach area`, () => {
    const villa=api.autoPlace(api.createInitialState(),'villa');assert.ok(villa.ok);
    const pool=api.autoPlace(villa.state,'pool');assert.ok(pool.ok);
    assert.equal(pool.state.baseInsert,'pool');
    const extended=api.addPlatform(pool.state);assert.ok(extended.ok);
    const second=api.autoPlace(extended.state,'pool');assert.ok(second.ok);
    assert.equal(second.state.extension!.baseInsert,'pool');
  });
}


for (const [runtime, api] of [['web',web],['mini',mini]] as const) {
  test(`${runtime}: villa pool access does not excuse uncovered side door holes`, () => {
    const installed=api.autoPlace(api.createInitialState(),'pool'); assert(installed.ok);
    const pose=api.getPlacements(installed.state,'villa',0).find(p=>p.x===150&&p.y===190)!;
    assert(pose);
    assert.deepEqual(api.getAutomaticPlacementIssues(installed.state,'villa',pose),[]);
    const open={...installed.state,removedCovers:['H03']};
    assert(api.getAutomaticPlacementIssues(open,'villa',pose).includes('door-over-opening'));
  });
}
