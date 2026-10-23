import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import * as webCode from '../src/lib/config-code';
import * as miniCode from '../minitool/src/lib/config-code';
import { getProduct, VISIBLE_PRODUCTS } from '../src/data/catalog';
import index from '../src/data/model-index.json';
const code = readFileSync(new URL('./fixtures/catalog-8-bridge.txt', import.meta.url), 'utf8').trim();

test('milk roofs and stair exits are 100 mm while other house heights stay unchanged', () => {
  for (const id of ['villa','l-house','cube-house','milk-house-left','milk-house-right','milk-house-double','milk-house-double-2x3','milk-house-aite']) {
    const product = getProduct(id);
    const height = id.startsWith("milk-house-") ? 100 : 90;
    for (const surface of product.surfaces ?? []) {
      assert.equal(surface.bounds[2] - product.origin[2],height,id);
      assert.equal(surface.bounds[5] - product.origin[2],height,id);
      for (const point of surface.points) assert.equal(point[2]-product.origin[2],height,id);
    }
    const roof = id==='villa'?'A02':id==='milk-house-aite'?'MCATR':product.parts[1].id;
    assert(Math.abs(index[roof as keyof typeof index].bounds[5]-product.origin[2]-height)<.002,id);
  }
  for (const stair of VISIBLE_PRODUCTS.filter(p=>p.id.startsWith('stairs-'))) {
    assert.equal(stair.collisionBoxes[0][5],100);
    assert(Math.abs(index[stair.parts[0].id as keyof typeof index].bounds[5]-100)<.002);
  }
});
for (const [runtime,api,codec] of [['website',web,webCode],['minitool',mini,miniCode]] as const) {
  test(`${runtime}: historical customer code migrates heights and rejects a bridge between now-unequal roofs`,()=>{
    const result = codec.decodeConfigWithMigration(code), state=result.state;
    assert.match(result.messages.join(' '),/10 cm/);
    assert.equal(state.items.length,8);
    assert.equal(state.items.find(i=>i.id==='c5')!.z,200);
    assert.equal(state.items.find(i=>i.id==='c8')!.z,210);
    assert.equal(state.items.find(i=>i.id==='c4')!.z,110);
    assert.equal(state.items.find(i=>i.id==='c7')!.z,110);
    const position=api.getPlacements(state,'sag-bridge',0).find(p=>p.x===650&&p.y===150);
    assert.equal(position,undefined,'9 cm L roof cannot support a level bridge to a 10 cm milk roof');
    const encoded=codec.encodeConfig(state);
    assert.equal(codec.encodeConfig(codec.decodeConfig(encoded)),encoded);
    assert.deepEqual(api.migrateAssembly(state),{state,messages:[]},'migration is idempotent');
    const mismatched={...state,items:state.items.map(i=>i.id==='c7'||i.id==='c8'?{...i,z:i.z+1}:i)};
    assert(!api.getPlacements(mismatched,'sag-bridge',0).some(p=>p.x===650&&p.y===150),'different heights remain unsupported');
  });
  test(`${runtime}: three mixed storeys accumulate parent height once and preserve the original save`,()=>{
    let state=api.createInitialState();const ids:string[]=[];
    for(const product of ['milk-house-double','l-house','cube-house']){
      const position=api.getPlacements(state,product,0).find(p=>p.parentId===(ids.at(-1)??'base'));assert(position,product);
      const placed=api.tryPlace(state,product,position,0);assert(placed.ok);state=placed.state;ids.push(placed.item.id);
    }
    assert.deepEqual(state.items.map(i=>i.z),[110,210,300]);
    const previous={...state,catalogVersion:8,items:state.items.map((i,n)=>({...i,z:[110,193.4,279][n]}))};
    const snapshot=JSON.stringify(previous);
    assert.deepEqual(api.migrateAssembly(previous).state,state);
    assert.equal(JSON.stringify(previous),snapshot);
  });
}

for (const [runtime,api,codec] of [['website',web,webCode],['minitool',mini,miniCode]] as const) {
  test(`${runtime}: catalog 9 stacks lift once per milk ancestor, preserving colors and immutable input`,()=>{
    let state=api.createInitialState();let parent='base';
    for(const id of ['milk-house-double','milk-house-left','cube-house']){
      const p=api.getPlacements(state,id,0).find(p=>p.parentId===parent);assert(p);
      const r=api.tryPlace(state,id,p,0);assert(r.ok);state=r.state;parent=r.item.id;
    }
    assert.deepEqual(state.items.map(i=>i.z),[110,210,310]);
    const old={...state,catalogVersion:9,items:state.items.map((item,i)=>({...item,z:[110,200,290][i]}))};
    const snapshot=JSON.stringify(old);const migrated=api.migrateAssembly(old).state;
    assert.deepEqual(migrated,state);assert.equal(JSON.stringify(old),snapshot);
    const code=codec.encodeConfig(migrated);assert.deepEqual(codec.buildConfigPayload(codec.decodeConfig(code)),codec.buildConfigPayload(migrated));
  });
}
