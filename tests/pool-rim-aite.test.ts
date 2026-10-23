import test from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../src/lib/assembly';
import * as mini from '../minitool/src/lib/assembly';
import * as code from '../src/lib/config-code';
import * as miniCode from '../minitool/src/lib/config-code';
import { getProduct, getProductColorParts } from '../src/data/catalog';
import { getModelMaterialColor } from '../src/lib/model-colors';
import { getProductDetail } from '../src/lib/product-detail';
for(const [name,api,codec] of [['web',web,code],['mini',mini,miniCode]] as const){
  test(`${name}: independent pool rim survives save, import and basin edits`,()=>{
    let state=api.createInitialState();
    const add=api.addPlatform(state);assert.ok(add.ok);state=add.state;
    state.baseColors={...state.baseColors,B01:'sky','B01-rim':'black'};
    state.extension!.baseColors={...state.extension!.baseColors,B01:'cream','B01-rim':'rose'};
    const restored=codec.decodeConfig(codec.encodeConfig(state));
    assert.equal(restored.baseColors['B01-rim'],'black');assert.equal(restored.extension!.baseColors['B01-rim'],'rose');
    const changed=api.setPlatformColors(restored,'base',{...restored.baseColors,B01:'white'});assert.ok(changed.ok);
    assert.equal(changed.state.baseColors['B01-rim'],'black');
    assert.equal(getModelMaterialColor(getProduct('pool').parts[0],undefined,'ChristmasRed',changed.state.baseColors),'black');
    assert.equal(getProductDetail(changed.state,'pool:base')!.colors['B01-rim'],'black');
  });
  test(`${name}: old pool color maps retain their previous automatic rim`,()=>{
    const state=api.createInitialState();state.baseColors.B01='sky';delete state.baseColors['B01-rim'];
    const restored=codec.decodeConfig(codec.encodeConfig(state));assert.equal(restored.baseColors['B01-rim'],'yellow');
  });
  test(`${name}: Aite places on four magnetic points with a front-facing door and no rooftop support`,()=>{
    const result=api.autoPlace(api.createInitialState(),'milk-house-aite');assert.ok(result.ok);assert.ok(result.item);
    assert.equal(result.item.rotation,0);assert.equal(result.item.y,207);
    assert.equal(codec.decodeConfig(codec.encodeConfig(result.state)).items[0].productId,'milk-house-aite');
    assert.equal(getProduct('milk-house-aite').price,4900);
    assert.equal(getProduct('milk-house-aite').surfaces?.length??0,0);
  });
}
test('pool exposes basin and rim as separate color controls',()=>assert.deepEqual(getProductColorParts('pool').map(p=>p.id),['B01','B01-rim']));
