import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import * as webCode from '../src/lib/config-code';
import * as miniCode from '../minitool/src/lib/config-code';
import {getProduct,PRODUCTS,VISIBLE_PRODUCTS} from '../src/data/catalog';
import {getInteractionPlacements} from '../src/lib/placement-targets';
import {getProductStyleColors,applyColorStyle,COLOR_STYLES} from '../src/lib/color-styles';
import {getProductDetail} from '../src/lib/product-detail';
import index from '../src/data/model-index.json';
const TRAY='urine-tray-aite';
function ok<T extends {ok:boolean}>(result:T):asserts result is T & {ok:true}{assert(result.ok,JSON.stringify(result));}
function local(api:typeof web,parent:web.AssemblyItem,p:web.AssemblyItem|web.Placement){
 const h=getProduct(parent.productId);
 return api.rotateVector([p.x-parent.x,p.y-parent.y,p.z-parent.z],((360-parent.rotation)%360)as 0|90|180|270).map((n,i)=>n+h.origin[i]);
}

test('approved full-size tray is appended, named and priced consistently without changing previous product indices',()=>{
 const catalogIndex=PRODUCTS.findIndex(p=>p.id===TRAY);assert.equal(PRODUCTS[catalogIndex-1].id,'milk-house-aite');assert(PRODUCTS.slice(catalogIndex+1).every(p=>p.id.endsWith('-left')));
 const p=getProduct(TRAY);assert.equal(p.name,'尿砂盆（艾特）');assert.equal(p.price,1400);assert.equal(p.category,'facility');
 assert.equal(getProduct('planter').price,800);assert.equal(getProduct('food-bowl').price,800);
 assert(VISIBLE_PRODUCTS.includes(p));assert.equal(p.attachment,'room-floor');assert.deepEqual(p.bottomMagnets,[]);
 assert.deepEqual(p.collisionBoxes,[[0,0,0,130,130,90]]);
 const b=index.UT01.bounds;assert(Math.abs(b[3]-b[0]-130)<.02);assert(Math.abs(b[4]-b[1]-130)<.02);assert.equal(b[5]-b[2],90);
});
for(const [name,api,codec]of[['website',web,webCode],['minitool',mini,miniCode]]as const){
 test(`${name}: every rotated Aite house accepts a floor-resting tray in the deepest room, facing the internal arch`,()=>{
  for(const rotation of[0,90,180,270]as const){
   const start=api.createInitialState();const point=api.getPlacements(start,'milk-house-aite',rotation)[0];assert(point);
   const house=api.tryPlace(start,'milk-house-aite',point,rotation);ok(house);
   const result=api.autoPlace(house.state,TRAY);ok(result);assert(result.item);const t=result.item;
   assert.equal(t.parentId,house.item.id);assert.equal(t.z,house.item.z);
   const [x,y,z]=local(api,house.item,t);assert(x<148.4,'deep room is across the partition');assert.equal(z,0);
   assert(x-65>16.9,'floor-level magnet seats remain clear');assert(x+65<148.4);assert(y-65>=7.5);assert(y+65<=182.8);
   // The 90 mm tray exceeds the roof locator's 89.6 mm datum, yet fits the 96.6 mm lid underside.
   assert.equal(getProduct(TRAY).collisionBoxes[0][5],90);
   const entry=api.transformPoint([150,93,0],getProduct('milk-house-aite'),house.item);
   const front=api.rotateVector([Math.SQRT1_2,-Math.SQRT1_2,0],t.rotation);
   const offset=api.rotateVector([130/Math.SQRT2-65,65-130/Math.SQRT2,0],t.rotation);
   const dx=entry[0]-t.x-offset[0],dy=entry[1]-t.y-offset[1];assert((dx*front[0]+dy*front[1])/Math.hypot(dx,dy)>.5);
   assert.deepEqual(api.validateAssembly(result.state),result.state);
   const code=codec.encodeConfig(result.state);assert.equal(codec.encodeConfig(codec.decodeConfig(code)),code);
   assert.equal(webCode.encodeConfig(webCode.decodeConfig(code)),miniCode.encodeConfig(miniCode.decodeConfig(code)));
  }
 });
 test(`${name}: 13 cm remains too large for the 2×2 and 2×3 narrow rooms`,()=>{
  for(const id of['milk-house-double','milk-house-double-2x3']){
   const h=api.autoPlace(api.createInitialState(),id);ok(h);assert(h.item);
   for(const rotation of[0,90,180,270]as const)assert(!api.getPlacements(h.state,TRAY,rotation).some(p=>p.parentId===h.item!.id));
  }
 });
 test(`${name}: free platform placement needs no magnets, preserves price and refuses unsupported or forged heights`,()=>{
  const initial=api.createInitialState();const placed=api.autoPlace(initial,TRAY);ok(placed);assert(placed.item);
  assert.equal(placed.item.parentId,'base');assert.equal(placed.item.z,110);
  assert.equal(api.getOrderLines(placed.state).find(line=>line.sku==='HM-GD-004')!.unitPrice,1400);
  assert.equal(api.getTotalPrice(placed.state)-api.getTotalPrice(initial),1400);
  assert.throws(()=>api.validateAssembly({...placed.state,items:placed.state.items.map(i=>({...i,z:i.z+10}))}));
  const pool=api.setPlatformPool(initial,'base',true);ok(pool);
  assert(!api.getPlacements(pool.state,TRAY,0).some(p=>p.x<170&&p.y<170),'pool opening is not a floor');
 });
 test(`${name}: internal furniture follows house movement/removal and only occupies each room once`,()=>{
  const h=api.autoPlace(api.createInitialState(),'milk-house-aite');ok(h);assert(h.item);
  const first=api.autoPlace(h.state,TRAY);ok(first);assert(first.item);
  const second=api.autoPlace(first.state,TRAY);ok(second);assert(second.item);
  assert.equal(second.item.parentId,h.item.id);assert(local(api,h.item,second.item)[0]>151.6,'second tray uses entry room, not the occupied inner room');
  const rotated=api.rotateItem(first.state,h.item.id);ok(rotated);
  const parent=rotated.state.items.find(i=>i.id===h.item!.id)!;const child=rotated.state.items.find(i=>i.id===first.item!.id)!;
  assert.deepEqual(local(api,parent,child),local(api,h.item,first.item));
  assert.equal(api.removeItem(first.state,h.item.id).items.length,0);
 });
}
test('drag targets choose the opening direction even after starting from a backwards rotation',()=>{
 const h=web.autoPlace(web.createInitialState(),'milk-house-aite');ok(h);assert(h.item);
 const target=getInteractionPlacements(h.state,TRAY,180).find(p=>p.parentId===h.item!.id);assert(target);
 const auto=web.autoPlace(h.state,TRAY);ok(auto);assert(auto.item);assert.equal(target.rotation,auto.item.rotation);
});
test('details, colors and compact import/export include the tray in every official palette',()=>{
 const h=web.autoPlace(web.createInitialState(),'milk-house-aite');ok(h);const placed=web.autoPlace(h.state,TRAY);ok(placed);assert(placed.item);
 for(let style=0;style<COLOR_STYLES.length;style++){
  const state=applyColorStyle(placed.state,style);const item=state.items.find(i=>i.productId===TRAY)!;
  assert.deepEqual(item.colors,getProductStyleColors(TRAY,style));const detail=getProductDetail(state,item.id)!;
  assert.equal(detail.title,'尿砂盆（艾特）');assert.match(detail.introduction,/自由放入/);assert.equal(detail.parts[0].id,'UT01');
  const c=webCode.encodeConfig(state);assert.deepEqual(webCode.buildConfigPayload(miniCode.decodeConfig(c)),webCode.buildConfigPayload(state));
 }
 const old=readFileSync(new URL('./fixtures/catalog-8-bridge.txt',import.meta.url),'utf8').trim();
 assert(!webCode.decodeConfig(old).items.some(i=>i.productId===TRAY),'historical serialized indices retain their meaning');
});
