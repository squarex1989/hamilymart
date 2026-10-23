import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import { getProduct } from '../src/data/catalog';
import { decodeConfig,encodeConfig } from '../src/lib/config-code';
import { applyInspirationLayout } from '../src/lib/inspiration';
import { audit } from '../scripts/inspiration-audit';
import hardware from '../model-sources/library-v18/roof-accessory-hardware.json';

const runtimes: [string, typeof web][] = [['website',web],['minitool',mini]];
for(const [runtime,api] of runtimes){
 test(`${runtime}: roof accessories use real same-height receivers and survive import`,()=>{
  const house=api.autoPlace(api.createInitialState(),'milk-house-double');assert(house.ok);assert(house.item);const houseItem=house.item;
  for(const id of ['planter','food-bowl','seesaw','pipe-st1','pipe-st2','pipe-lt2','pipe-lt2n','pipe-tt1','pipe-tt2','stairs-straight-1','stairs-right-1','stairs-left-1'])for(const rotation of [0,90,180,270] as const){
   const p: web.Placement | undefined=api.getPlacements(house.state,id,rotation).find(p=>p.parentId===houseItem.id);assert(p,`${id}/${rotation}`);
   assert.equal(p.z,210);assert(p.magnetCount>=(getProduct(id).minimumMagnetMatches??2));
   const placed=api.tryPlace(house.state,id,p,rotation);assert(placed.ok);
   assert.equal(decodeConfig(encodeConfig(placed.state)).items.length,2);
   const removed=api.removeItem(placed.state,houseItem.id);assert.equal(removed.items.length,0);
  }
 });
 test(`${runtime}: hat attaches to the double house in four directions with two distinct steel contacts`,()=>{
  const house=api.autoPlace(api.createInitialState(),'milk-house-double');assert(house.ok);assert(house.item);const houseItem=house.item;
  for(const turn of [0,90,180,270] as const){
   const p: web.Placement | undefined=api.getPlacements(house.state,'roof-cottage',turn).find(p=>p.parentId===houseItem.id);assert(p);
   assert.equal(p.magnetCount,2);assert.equal(p.z,210);
   const result=api.tryPlace(house.state,'roof-cottage',p,turn);assert(result.ok);
   assert.equal(api.validateAssembly(result.state).items.length,2);
   assert(!api.getPlacements(result.state,'roof-cottage',turn).some(other=>other.key===p.key),'occupied contacts are reserved');
  }
 });
 test(`${runtime}: physical size and actual holes still constrain rooftop accessories`,()=>{
  const cube=api.autoPlace(api.createInitialState(),'cube-house');assert(cube.ok);assert(cube.item);const cubeItem=cube.item;
  assert(!api.getPlacements(cube.state,'seesaw',0).some(p=>p.parentId===cubeItem.id),'18 cm seesaw cannot fit a 10 cm roof');
  assert(!api.getPlacements(cube.state,'pipe-down',0).some(p=>p.parentId===cubeItem.id),'solid roofs have no down-pipe aperture');
 });
}
test('double-storey villa down pipe enters the interior upper-left hole and exits right',()=>{
 const result=applyInspirationLayout(web.createInitialState(),0,'1A');assert(result.ok);
 const pipe=result.state.items.find(i=>i.productId==='pipe-down')!;
 assert.deepEqual([pipe.x,pipe.y,pipe.z,pipe.rotation],[50,250,110,0]);
 assert.deepEqual(audit(result.state),[]);
});

test('courtyard second floor has a front-facing cube and a bowl without overhang or blocked access',()=>{
 const result=applyInspirationLayout(web.createInitialState(),0,'1C');assert(result.ok);
 const parent=result.state.items.find(i=>i.productId==='milk-house-double')!;
 const cube=result.state.items.find(i=>i.productId==='cube-house')!;
 const bowl=result.state.items.find(i=>i.productId==='food-bowl')!;
 assert.equal(cube.parentId,parent.id);assert.equal(bowl.parentId,parent.id);
 assert.equal(cube.z,210);assert.equal(bowl.z,210);assert.equal(cube.rotation,270);
 assert.deepEqual(audit(result.state),[]);
 const contact=web.transformPoint(hardware.O01.new_contact_mm as [number,number,number],getProduct('food-bowl'),bowl);
 assert.deepEqual(contact,[110,190,210]);
 for(const bounds of web.getVisualItemBounds(bowl)){
  assert(bounds[0]>=2&&bounds[1]>=102&&bounds[3]<=198&&bounds[4]<=298);
 }
 const code=encodeConfig(result.state);const decoded=decodeConfig(code);
 assert.equal(encodeConfig(decoded),code);
 const decodedBowl=decoded.items.find(i=>i.productId==='food-bowl')!;
 assert.deepEqual([decodedBowl.x,decodedBowl.y,decodedBowl.z],[bowl.x,bowl.y,bowl.z]);
 assert.equal(decoded.items.find(i=>i.id===decodedBowl.parentId)!.productId,'milk-house-double');
});

for(const [runtime,api] of runtimes){
 test(`${runtime}: bowl corner magnet uses the same grid contact on cube, courtyard and gift deck`,()=>{
  assert.deepEqual(getProduct('food-bowl').bottomMagnets,[ [280.5,264,200], hardware.O01.new_contact_mm ]);
  assert.deepEqual(hardware.O01.hardware_mm,[8,2]);assert.deepEqual(hardware.A02.hardware_mm,[12,2]);
  for(const id of ['cube-house','milk-house-double','villa']){
   const parent=api.autoPlace(api.createInitialState(),id);assert(parent.ok);assert(parent.item);const parentItem=parent.item;
   const product=getProduct(id);
   const local=(id==='villa'?[hardware.A02.new_contact_mm]:product.surfaces!.flatMap(s=>s.points)) as [number,number,number][];
   const expected=local.map(point=>api.transformPoint(point,product,parentItem));
   const positions=api.getPlacements(parent.state,'food-bowl',0).filter(p=>p.parentId===parentItem.id);
   const p=positions.find(p=>expected.some(point=>api.transformPoint(hardware.O01.new_contact_mm as [number,number,number],getProduct('food-bowl'),p).every((v,i)=>Math.abs(v-point[i])<.01)));
   assert(p,`${id} new corner contact`);
   const r=api.tryPlace(parent.state,'food-bowl',p,0);assert(r.ok);
   assert.equal(api.validateAssembly(r.state).items.length,2);
  }
 });
}
