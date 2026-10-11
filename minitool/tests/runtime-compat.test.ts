import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const source=readFileSync(new URL('../src/lib/runtime-compat.ts',import.meta.url),'utf8');
test('local shims restore only used language APIs before imported app modules run', () => {
  const context=vm.createContext({});
  vm.runInContext('delete Object.fromEntries;delete Object.hasOwn;delete Array.prototype.flat;delete Array.prototype.flatMap;delete Array.prototype.at;delete String.prototype.replaceAll;delete Promise.prototype.finally;',context);
  const compiled=transformSync(source,{loader:'ts',format:'iife',target:['es2017','chrome61']}).code;
  vm.runInContext(compiled,context);
  const result=vm.runInContext(`JSON.stringify({a:Object.fromEntries([['a',2]]),own:Object.hasOwn({x:1},'x'),flat:[1,[2,[3]]].flat(2),map:[1,2].flatMap(x=>[x,x]),tail:[1,2].at(-1),replace:'a+a+'.replaceAll('+','-'),finallyType:typeof Promise.prototype.finally})`,context);
  assert.deepEqual(JSON.parse(result),{a:{a:2},own:true,flat:[1,2,3],map:[1,1,2,2],tail:2,replace:'a-a-',finallyType:'function'});
});
