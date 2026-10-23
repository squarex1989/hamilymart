import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FIXED_DOOR_PAIRS } from '../src/data/fixed-door-variants';
import { getProduct, VISIBLE_PRODUCTS } from '../src/data/catalog';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import { encodeConfig, decodeConfig, buildConfigPayload } from '../src/lib/config-code';
import { decodeConfig as miniDecode } from '../minitool/src/lib/config-code';
import { encodeCompactPayload } from '../src/lib/compact-config';
for (const pair of FIXED_DOOR_PAIRS) {
 for (const side of ['right','left'] as const) test(`${pair[side]} has a real fixed opening and no separate front panel`,async()=>{
  const p=getProduct(pair[side]);assert(VISIBLE_PRODUCTS.includes(p));assert.equal(p.parts.length,2);
  const bytes=readFileSync(new URL(`../public/models/${p.parts[0].id}.glb`,import.meta.url));
  const root=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;root.updateMatrixWorld(true);
  const hit=(position:number)=>new THREE.Raycaster(pair.axis===0?new THREE.Vector3(position,-10,30):new THREE.Vector3(220,position,30),pair.axis===0?new THREE.Vector3(0,1,0):new THREE.Vector3(-1,0,0),0,30).intersectObject(root,true).length>0;
  assert.equal(hit(side==='right'?pair.span-50:50),false);assert.equal(hit(side==='right'?50:pair.span-50),true);
  root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()});
 });
 for(const [name,api] of [['web',web],['mini',mini]] as const) test(`${name}: ${pair.right} old left-panel save becomes the left fixed-wall version`,()=>{
  const placed=api.autoPlace(api.createInitialState(),pair.right);assert(placed.ok&&placed.item,pair.right);
  const old=structuredClone(placed.state);old.items[0].doorSide='left';const copy=JSON.stringify(old);
  const next=api.validateAssembly(old);assert.equal(JSON.stringify(old),copy);assert.equal(next.items[0].productId,pair.left);assert.equal(next.items[0].doorSide,undefined);
  assert.deepEqual([next.items[0].x,next.items[0].y,next.items[0].z,next.items[0].parentId],[old.items[0].x,old.items[0].y,old.items[0].z,old.items[0].parentId]);
  const code=encodeConfig(next);assert.equal(decodeConfig(code).items[0].productId,pair.left);assert.deepEqual(miniDecode(code),decodeConfig(code));
 });
}
test('HM6 historical reversible-door bit imports into the fixed left variant',()=>{
 const p=web.autoPlace(web.createInitialState(),'milk-house-aite');assert(p.ok);
 const state=structuredClone(p.state);state.extension={direction:'right',baseInsert:'lid',baseColors:state.baseColors,removedCovers:[],legHeight:200};
 const payload=buildConfigPayload(state) as any[];assert.equal(payload[0],6);payload[5][0][7]=1;
 const code=encodeCompactPayload(payload);assert.equal(decodeConfig(code).items[0].productId,'milk-house-aite-left');assert.deepEqual(miniDecode(code),decodeConfig(code));
});
