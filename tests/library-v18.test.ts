import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import { PRODUCTS, VISIBLE_PRODUCTS, getProduct, getProductColorParts } from '../src/data/catalog';
import { PRODUCTS as miniProducts } from '../minitool/src/data/catalog';
import index from '../src/data/model-index.json';
import { encodeConfig, decodeConfig } from '../src/lib/config-code';
import { getThumbnailDefinition } from '../src/lib/catalog-thumbnail-contract';
import { getProductStyleColors } from '../src/lib/color-styles';
const added=PRODUCTS.filter(p=>/^(stairs-|milk-house-|sag-bridge$|pokemon-center$)/.test(p.id));

test('approved library products, stable legacy indices, independent color controls and prices',()=>{
  assert.equal(added.length,13);
  assert.deepEqual(PRODUCTS,miniProducts);
  assert.equal(PRODUCTS[16].id,'pipe-tt2');
  assert.equal(added.filter(p=>p.id.startsWith('stairs-')).length,6);
  for(const product of added){
    const price=product.id.startsWith('stairs-')?1400:product.id==='milk-house-double'?3900:['milk-house-double-2x3','milk-house-aite'].includes(product.id)?4900:product.id.startsWith('milk-house-')?2900:product.id==='sag-bridge'?800:9900;
    assert.equal(product.price,price,product.id);
    for(const part of product.parts){
      assert.ok(index[part.id as keyof typeof index]);
      assert.ok(existsSync(`public/models/${part.id}.glb`));
    }
    for(let style=0;style<5;style++) assert.deepEqual(Object.keys(getProductStyleColors(product.id,style)),getProductColorParts(product.id).map(p=>p.id));
  }
  assert.equal(getProductColorParts('pokemon-center').length,7);
  assert.equal(getProductColorParts('milk-house-left').length,2);
  assert.deepEqual(getThumbnailDefinition('pokemon-center',0).materialColors,{
    PCW_white:'white',PCW_cyan:'sky',PCW_dark:'black',PCR_red:'red',PCR_white:'white',PCR_cyan:'sky',PCR_dark:'black',
  });
});

for (const [runtime,api] of [['website',web],['minitool',mini]] as const) {
  test(`${runtime}: all new floor products place in four directions and roundtrip`,()=>{
    for(const product of added.filter(p=>p.id!=='sag-bridge'))for(const rotation of [0,90,180,270] as const){
      const initial=api.createInitialState();
      const choice=api.getPlacements(initial,product.id,rotation)[0];
      assert.ok(choice,`${product.id} ${rotation}`);
      const result=api.tryPlace(initial,product.id,choice,rotation);
      assert.ok(result.ok,JSON.stringify(result));
      assert.equal(decodeConfig(encodeConfig(result.state)).items[0].productId,product.id);
    }
  });
  test(`${runtime}: bridge spans two real roofs; removal on either side removes dependent bridge`,()=>{
    let state=api.createInitialState();
    assert.equal(api.getPlacements(state,'sag-bridge').length,0);
    for(const x of [50,250]){
      const r=api.tryPlace(state,'cube-house',{x,y:150,z:110});assert.ok(r.ok);state=r.state;
      if(x===50)assert.equal(api.getPlacements(state,'sag-bridge').length,0);
    }
    const placement=api.getPlacements(state,'sag-bridge')[0];assert.ok(placement);assert.equal(placement.magnetCount,4);
    const r=api.tryPlace(state,'sag-bridge',placement);assert.ok(r.ok);state=r.state;
    const restored=decodeConfig(encodeConfig(state));assert.equal(restored.items.length,3);
    assert.deepEqual(api.validateAssembly({...state,items:[...state.items].reverse()}).items.map(i=>i.productId).sort(),state.items.map(i=>i.productId).sort());
    for(const support of state.items.filter(i=>i.productId==='cube-house')){
      assert.equal(api.removeItem(state,support.id).items.length,1);
      const moved=api.tryPlace(state,support.productId,{x:support.x,y:50,z:110},0,support.colors,support.id);
      assert.equal(moved.ok,false,'moving one support cannot leave the bridge hanging');
    }
    assert.equal(api.getPlacements(state,'sag-bridge').length,0,'occupied bridge must not overlap another');
  });
  test(`${runtime}: bridge rejects unequal roof heights and accepts a 90 degree span`,()=>{
    let state=api.createInitialState();
    for(const y of [50,250]){const r=api.tryPlace(state,'cube-house',{x:150,y,z:110});assert.ok(r.ok);state=r.state;}
    assert.ok(api.getPlacements(state,'sag-bridge',90).length);
    const wrong={...state,items:state.items.map((item,i)=>i?{...item,z:item.z+2.2}:item)};
    assert.equal(api.getPlacements(wrong,'sag-bridge',90).length,0);
  });
  test(`${runtime}: bridge sag cannot intersect its primary supporting roof`,()=>{
    let state=api.createInitialState();
    for(const [productId,x] of [['milk-house-left',100],['cube-house',250]] as const){
      const r=api.tryPlace(state,productId,{x,y:50,z:110});assert.ok(r.ok);state=r.state;
    }
    assert.equal(api.getPlacements(state,'sag-bridge').length,0);
  });
  test(`${runtime}: approved steel roofs support stacked milk houses`,()=>{
    let state=api.createInitialState();
    const lower=api.tryPlace(state,'milk-house-double',{x:100,y:100,z:110});assert.ok(lower.ok);state=lower.state;
    const upper=api.getPlacements(state,'milk-house-left').find(p=>p.parentId===lower.item.id);assert.ok(upper);
    const placed=api.tryPlace(state,'milk-house-left',upper);assert.ok(placed.ok);
    assert.equal(decodeConfig(encodeConfig(placed.state)).items.length,2);
  });
}

test('source archive records assembly poses, closed meshes, no print-orientation transform',()=>{
  const manifest=JSON.parse(readFileSync('model-sources/library-v18/manifest.json','utf8'));
  assert.deepEqual(manifest.BR01.bounds.slice(0,3),[0,0,-6]);
  for(const id of ['RS11','RS12','RS21','RS22','RS31','RS32']){
    const bounds=manifest[id].bounds;assert.ok(bounds[3]-bounds[0]<=96.1);assert.ok(bounds[4]-bounds[1]<=96.1);
  }
  assert.ok(manifest.PCW.bounds[5]<80);assert.ok(manifest.PCR.bounds[5]>150);
});

for (const [runtime,api] of [['website',web],['minitool',mini]] as const) {
  test(`${runtime}: a bridge uses one magnetic contact at each supported end, not necessarily all four`, () => {
    let state=api.createInitialState();
    for(const x of [50,250]){const r=api.tryPlace(state,'cube-house',{x,y:150,z:110});assert.ok(r.ok);state=r.state;}
    // The same supported roofs with one receiver row available still hold both ends.
    const oneRow=(id:string)=>{const p=getProduct(id);return id==='cube-house'?{...p,surfaces:p.surfaces!.map(s=>({...s,points:s.points.filter(v=>v[1]===10)}))}:p;};
    const poses=api.getPlacements(state,'sag-bridge',0,undefined,oneRow);
    assert.ok(poses.some(p=>p.magnetCount===2),'one contact on each end across one empty cell');
    const single={...state,items:state.items.slice(0,1)};
    assert.equal(api.getPlacements(single,'sag-bridge',0,undefined,oneRow).length,0,'a gap still needs support at both ends');
    const placed=api.autoPlace(state,'sag-bridge');assert.ok(placed.ok);
    assert.equal(api.removeItem(placed.state,state.items[1].id).items.length,1,'secondary support remains a real dependency');
  });
}

for (const [runtime,api] of [['website',web],['minitool',mini]] as const) {
  test(`${runtime}: two contacts on one end hold a bridge with a supported opposite end`, () => {
    let state=api.createInitialState();
    for(const x of [50,250]){const r=api.tryPlace(state,'cube-house',{x,y:150,z:110});assert.ok(r.ok);state=r.state;}
    // Both roofs expose only their right edge: the bridge's left end has two
    // contacts, while its right end rests on solid roof without a contact.
    const rightEdge=(id:string)=>{const p=getProduct(id);return id==='cube-house'?{...p,surfaces:p.surfaces!.map(s=>({...s,points:s.points.filter(v=>v[0]===90)}))}:p;};
    for (const rotation of [0,180] as const) {
      assert.ok(api.getPlacements(state,'sag-bridge',rotation,undefined,rightEdge).some(p=>p.magnetCount===2));
    }
    const oneContact=(id:string)=>{const p=rightEdge(id);return id==='cube-house'?{...p,surfaces:p.surfaces!.map(s=>({...s,points:s.points.filter(v=>v[1]===10)}))}:p;};
    assert.equal(api.getPlacements(state,'sag-bridge',0,undefined,oneContact).length,0);
  });
}

test('all flat house roofs expose four steel receivers per occupied 10 cm cell',()=>{
  const cells:Record<string,number[][]>={
    'l-house':[[0,0],[0,100],[100,100]],'cube-house':[[0,0]],
    'milk-house-left':[[0,0],[100,0]],'milk-house-right':[[0,0],[100,0]],
    'milk-house-double':[[0,0],[100,0],[0,100],[100,100]],
    'milk-house-double-2x3':[[0,0],[100,0],[0,100],[100,100],[0,200],[100,200]],
  };
  for(const [id,grid] of Object.entries(cells)){
    const receivers=new Set(getProduct(id).surfaces!.flatMap(s=>s.points.map(p=>p.slice(0,2).join(','))));
    const expected=new Set(grid.flatMap(([x,y])=>[10,90].flatMap(dx=>[10,90].map(dy=>[x+dx,y+dy].join(',')))));
    assert.deepEqual(receivers,expected,id);
  }
});


test('only the three 90 mm stairs are offered; retired catalog indices remain readable',()=>{
  assert.deepEqual(VISIBLE_PRODUCTS.filter(p=>p.id.startsWith('stairs-')).map(p=>p.id),['stairs-straight-1','stairs-right-1','stairs-left-1']);
  for(const p of VISIBLE_PRODUCTS.filter(p=>p.id.startsWith('stairs-'))) {
    assert(!p.name.includes('cm'));
    assert(Math.abs(p.collisionBoxes[0][5]-90)<.01);
  }
  for(const id of ['stairs-straight-2','stairs-right-2','stairs-left-2'])assert(getProduct(id));
});

for (const [runtime,api] of [['website',web],['minitool',mini]] as const) {
  test(`${runtime}: 2x3 milk house preserves existing IDs and supports roof accessories`,()=>{
    assert.equal(PRODUCTS[28].id,'pipe-down');
    assert.equal(PRODUCTS[29].id,'milk-house-double-2x3');
    assert.equal(getProduct('milk-house-double').name,'奶糖二居室（2×2）');
    const placed=api.autoPlace(api.createInitialState(),'milk-house-double-2x3');
    assert.ok(placed.ok);
    assert.equal(decodeConfig(encodeConfig(placed.state)).items[0].productId,'milk-house-double-2x3');
    assert.ok(placed.item);
    const parentId=placed.item.id;
    for (const id of ['food-bowl','planter','cube-house','roof-cottage','pipe-st1','stairs-straight-1']) {
      assert.ok([0,90,180,270].some(r=>api.getPlacements(placed.state,id,r as 0|90|180|270).some(p=>p.parentId===parentId)),id);
    }
  });
}
