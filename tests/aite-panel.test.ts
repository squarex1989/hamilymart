import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct } from '../src/data/catalog';
import { getHouseDoorways, getHouseRoomFloors } from '../src/lib/aite-panel';
import { getHouseDoorways as miniDoors, getHouseRoomFloors as miniRooms } from '../minitool/src/lib/aite-panel';
import { createInitialState, autoPlace } from '../src/lib/assembly';
import { getProductDetail } from '../src/lib/product-detail';
for(const [name,doors,rooms]of [['web',getHouseDoorways,getHouseRoomFloors],['mini',miniDoors,miniRooms]] as const){
 test(`${name}: Aite fixed variants have opposite front doors and inner-room priority`,()=>{
  assert.deepEqual(doors('milk-house-aite')[0].center,[250,0,0]);assert.deepEqual(doors('milk-house-aite-left')[0].center,[50,0,0]);
  const r=rooms('milk-house-aite'),l=rooms('milk-house-aite-left');assert.deepEqual(r.map(x=>x.bounds),l.map(x=>x.bounds));assert.deepEqual(l.map(x=>[x.id,x.depth]),[['entry',1],['inner',2]]);
  assert.deepEqual(getProduct('milk-house-aite').bottomMagnets.slice().sort(),getProduct('milk-house-aite-left').bottomMagnets.slice().sort());
 });
}
test('Aite detail uses the selected complete wall version, with two assembly parts',()=>{
 const p=autoPlace(createInitialState(),'milk-house-aite-left');assert(p.ok&&p.item);const d=getProductDetail(p.state,p.item.id)!;assert.equal(d.title,'奶糖二居室（艾特）（左开门）');assert.equal(d.parts.length,2);assert.equal(d.doorSide,undefined);
});
