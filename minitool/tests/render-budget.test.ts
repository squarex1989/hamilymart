import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetPixelRatio, FrameBudget } from '../src/lib/render-budget';
test('drawing buffer obeys density and pixel ceilings after every resize', () => {
  for (const [w,h,dpr] of [[390,844,3],[1920,1080,2],[4000,3000,4],[320,480,1]]) {
    for (const low of [false,true]) { const ratio=budgetPixelRatio(w,h,dpr,low); assert(ratio <= (low?1:1.5)); assert(w*h*ratio*ratio <= (low?1e6:2e6)+1); }
  }
});
test('sustained poor frames downgrade once then stop high-cost rendering', () => {
  const budget = new FrameBudget(); const actions=[];
  for(let i=0;i<60;i++)actions.push(budget.sample(55));
  assert.equal(actions.filter(x=>x==='reduce-resolution').length,1); assert.equal(budget.reducedResolution,true);
  for(let i=0;i<59;i++)assert.equal(budget.sample(75),'keep');
  assert.equal(budget.sample(75),'fallback');
});
test('stable frames and pause resets do not trigger downgrade', () => {
  const budget = new FrameBudget(); for(let i=0;i<120;i++)assert.equal(budget.sample(34),'keep');
  for(let i=0;i<30;i++)budget.sample(80); budget.reset();
  for(let i=0;i<30;i++)assert.equal(budget.sample(80),'keep');
  assert.equal(budget.reducedResolution,false);
});
