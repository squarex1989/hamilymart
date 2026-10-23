import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelIndex from '../src/data/model-index.json';
import { PRODUCTS,getProduct,getDefaultColors,getProductColorParts,type Rotation } from '../src/data/catalog';
import { autoPlace,createInitialState,getMagnetPoints,getOrderLines,getPlacements,getTotalPrice,validateAssembly,transformPoint,migrateAssembly } from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import { decodeConfig,encodeConfig } from '../src/lib/config-code';
import { getModelMaterialColor } from '../src/lib/model-colors';
import { getProductStyleColors } from '../src/lib/color-styles';
import { createCatalogStyleHint,restoreCatalogStyle } from '../src/lib/catalog-style';

async function load(){const bytes=readFileSync(new URL('../public/models/SS01.glb',import.meta.url));return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;}
test('V17 rocker requires the four 20x80mm contacts shown in the platform reference',()=>{
 const p=getProduct('seesaw');assert.equal(PRODUCTS[13].id,'seesaw');assert.deepEqual(p.origin,[100,250,110]);
 assert.deepEqual(p.bottomMagnets,[[90,210,110],[110,210,110],[90,290,110],[110,290,110]]);assert.equal(p.minimumMagnetMatches,4);
 assert.deepEqual(getProductColorParts(p.id).map(x=>x.id),['SS01','SS01-base']);
 assert.deepEqual(getDefaultColors(p.id),{SS01:'butter','SS01-base':'pine'});
 assert.deepEqual(p.collisionBoxes,[[9.3,200,110,190.7,300,210]]);
});
test('actual V17 GLB has a tilted 180x100mm ribbed board, four real pockets, and independent watertight source color bodies',async()=>{
 const model=await load();model.updateMatrixWorld(true);const index=modelIndex.SS01;
 assert.equal(index.components.length,2);assert.deepEqual(index.components.map(c=>c.id),['SS01_Gold','SS01_PineGreen']);
 const bounds=new THREE.Box3().setFromObject(model);assert.ok(bounds.max.z>207 && bounds.max.z<210);assert.ok(Math.abs(bounds.min.z-110)<.001);
 const bodies: Record<string,THREE.Mesh>={};model.traverse(o=>{if(o instanceof THREE.Mesh)bodies[o.userData.sourcePart]=o;});
 const board=bodies.SS01_Gold;const positions=board.geometry.getAttribute('position');
 const pivot=new THREE.Vector3(100,250,152.7049173596981);const leveled=new THREE.Box3();let ribs=0;
 for(let i=0;i<positions.count;i++){const v=new THREE.Vector3().fromBufferAttribute(positions,i).sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/6);leveled.expandByPoint(v);if(v.z>12.5)ribs++;}
 assert.ok(Math.abs(leveled.max.x-leveled.min.x-180)<.06);assert.ok(Math.abs(leveled.max.y-leveled.min.y-100)<.01);assert.ok(ribs>100,'actual raised rib geometry is present');
 const below=(x:number,y:number)=>new THREE.Raycaster(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,1)).intersectObject(bodies.SS01_PineGreen,true)[0]?.point.z;
 for(const [x,y] of [[90,210],[110,210],[90,290],[110,290]])assert.ok(Math.abs(below(x,y)!-114.2)<.02,'magnet pocket must be 4.2mm deep');
 assert.ok(Math.abs(below(100,250)!-110)<.02,'old central hole is absent');
 const b=getProduct('seesaw').collisionBoxes[0];assert.ok(bounds.min.x>=b[0]&&bounds.max.x<=b[3]&&bounds.min.y>=b[1]&&bounds.max.y<=b[4]&&bounds.max.z<=b[5]);
});
for(const [name,engine] of [['web', {createInitialState,getMagnetPoints,getPlacements,validateAssembly,migrateAssembly}],['mini',mini]] as const){
 test(`${name}: every advertised rocker position aligns all four contacts, never a single receiver`,()=>{
  const s=engine.createInitialState(),p=getProduct('seesaw');
  for(const r of [0,90,180,270] as Rotation[]){const candidates=engine.getPlacements(s,'seesaw',r);assert(candidates.length>0);assert(!candidates.some(c=>c.x===90&&c.y===90));
   for(const c of candidates){assert.equal(c.magnetCount,4);for(const point of p.bottomMagnets){const actual=transformPoint(point,p,c);assert(engine.getMagnetPoints(s).some(m=>m.parentId===c.parentId&&m.point.every((v,i)=>Math.abs(v-actual[i])<.01)));}}
  }
  assert(engine.getPlacements(s,'seesaw',0).some(c=>c.x===100&&c.y===250));
 });
 test(`${name}: historical single-magnet rockers relocate atomically and keep old custom color on both bodies`,()=>{
  const old={...engine.createInitialState(),catalogVersion:7,items:[{id:'old',productId:'seesaw',x:90,y:90,z:110,rotation:0,parentId:'base',colors:{SS01:'sky'}}]};const before=JSON.stringify(old);
  const result=engine.migrateAssembly(old);assert.equal(result.state.items.length,1);assert.deepEqual(result.state.items[0].colors,{SS01:'sky','SS01-base':'sky'});assert.match(result.messages.join(),/四点/);assert.notDeepEqual([result.state.items[0].x,result.state.items[0].y],[90,90]);assert.equal(JSON.stringify(old),before);
  assert.throws(()=>engine.migrateAssembly({...old,items:[{...old.items[0],x:91}]}),/磁吸/);
  assert.throws(()=>engine.validateAssembly({...result.state,items:[{...result.state.items[0],x:90,y:90}]}),/磁吸/);
 });
}
test('V17 independent colors survive HM3, order lines and all five material palettes',()=>{
 const first=createInitialState();const placed=autoPlace(first,'seesaw');assert(placed.ok);const state={...placed.state,items:placed.state.items.map(i=>({...i,colors:{SS01:'rose' as const,'SS01-base':'sky' as const}}))};
 assert.equal(getTotalPrice(state)-getTotalPrice(first),1400);assert.deepEqual(decodeConfig(encodeConfig(state)).items[0].colors,state.items[0].colors);
 assert.deepEqual(getOrderLines(state).find(l=>l.sku.startsWith('HM-TY-001'))!.colors,state.items[0].colors);
 const part=getProduct('seesaw').parts[0];
 for(let i=0;i<5;i++){const colors=getProductStyleColors('seesaw',i);assert.notEqual(colors.SS01,colors['SS01-base']);assert.equal(getModelMaterialColor(part,'SS01_Gold','Gold',colors),colors.SS01);assert.equal(getModelMaterialColor(part,'SS01_PineGreen','PineGreen',colors),colors['SS01-base']);}
});
test('catalog upgrades preserve a matching persisted palette hint, including manually recolored designs',()=>{
 const code='HM3.WzMsNywxMDAsWzAsWzE0LDEsMCwwLDAsMCwwLDAsMF0sW11dLG51bGwsW1syLDI1MCw1MCwxMTAsMCxbMTQsMTRdLC0xXSxbMiw1MCw1MCwxMTAsMCxbMywzXSwtMV1dLG51bGwsWzAsNTBdLG51bGxd.46E5DFD2';
 const migrated=decodeConfig(code);const updated=encodeConfig(migrated);assert.notEqual(updated,code);
 assert.equal(restoreCatalogStyle(migrated,updated,JSON.stringify(createCatalogStyleHint(3,code))),3);
 assert.notEqual(restoreCatalogStyle(createInitialState(),encodeConfig(createInitialState()),JSON.stringify(createCatalogStyleHint(3,code))),3);
});

test('all 15 existing official designs migrate without losing any component, pool, support or custom colors',()=>{
 const fixtures=JSON.parse(readFileSync(new URL('./fixtures/catalog-7-inspiration.json',import.meta.url),'utf8'));
 for(const engine of [{migrateAssembly},mini])for(const fixture of fixtures){
  const before=JSON.stringify(fixture.state);const migrated=engine.migrateAssembly(fixture.state).state;
  assert.equal(migrated.items.length,fixture.state.items.length,fixture.id);assert.equal(migrated.baseInsert,fixture.state.baseInsert);
  assert.equal(migrated.legHeight,fixture.state.legHeight);assert.deepEqual(migrated.bedding,fixture.state.bedding);
  for(const old of fixture.state.items){const updated=migrated.items.find((i:any)=>i.id===old.id)!;assert(updated);for(const [key,color] of Object.entries(old.colors))assert.equal(updated.colors[key],color);}
  assert.equal(JSON.stringify(fixture.state),before);
 }
});
