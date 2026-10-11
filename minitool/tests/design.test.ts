import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewUserState } from '../src/lib/starter-assembly';
import { getTotalPrice, setBedding, validateAssembly, addPlatform } from '../src/lib/assembly';
import { encodeConfig } from '../src/lib/config-code';
import { decodePastedDesign } from '../src/lib/import-design';
import { applyColorStyle, COLOR_STYLES } from '../src/lib/color-styles';
test('offline copy retains the starter, geometry validation, prices and every palette in shared codes',()=>{
  const state=createNewUserState();assert.equal(getTotalPrice(state),18000);assert.equal(state.bedding.depth,0);
  for(let i=0;i<COLOR_STYLES.length;i++){const next=applyColorStyle(state,i);const code=encodeConfig(next);const restored=decodePastedDesign(`HamilyMart 搭配清单\n合计：¥180.00\n搭配编号：\n${code}`).state;assert.equal(encodeConfig(validateAssembly(restored)),code);assert.equal(getTotalPrice(restored),18000);}
  const deeper=setBedding(state,{mode:'thick',depth:300});assert.ok(deeper.ok);assert.equal(deeper.state.legHeight,300);
  const wider=addPlatform(deeper.state);assert.ok(wider.ok);assert.equal(wider.state.extension?.direction,'right');
});
