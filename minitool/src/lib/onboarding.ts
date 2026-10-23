import { addPlatform, createInitialState, getPlatforms, tryPlace } from './assembly';
import { applyColorStyle, COLOR_STYLES } from './color-styles';
import { applyInspirationLayout } from './inspiration';
import type { DraftStorage } from './storage';
export const ONBOARDING_KEY = 'hamilymart.onboarding.v1';
export const ONBOARDING_DURATIONS = [6000, 12000, 8000, 12000] as const;
export const INTRO_LAYOUTS = [{id:'1A',style:0},{id:'2D',style:2},{id:'3B',style:3}] as const;
/** A separate flag: watching a demo never touches the user's draft or undo history. */
export async function hasSeenIntroduction(store: DraftStorage): Promise<boolean> {
  try { const result=await store.read(ONBOARDING_KEY); return result.ok && result.value==='true'; } catch { return false; }
}
export async function rememberIntroduction(store: DraftStorage): Promise<boolean> {
  try { return await store.write(ONBOARDING_KEY,'true'); } catch { return false; }
}
export function createIntroductionDesigns() {
  return INTRO_LAYOUTS.map(({id,style},index)=>{
    let state=createInitialState();state.cage=null;state.bedding={mode:'none',depth:0};
    for(let n=0;n<index;n++){const added=addPlatform(state);if(!added.ok)throw new Error(added.reason);state=added.state;}
    state=applyColorStyle(state,style);
    const result=applyInspirationLayout(state,style,id);if(!result.ok)throw new Error(result.reason);
    return {state:result.state,title:`${getPlatforms(result.state).length} 个平台 · ${COLOR_STYLES[style].name}`,layout:result.layout.name};
  });
}
/** Each demonstration placement still goes through the real magnetic attachment rules. */
export function createMagnetDemonstration() {
  let state=createInitialState();state.cage=null;state.bedding={mode:'none',depth:0};
  for(const [productId,x,y,z,rotation] of [
    ['l-house',100,200,110,0],
    ['cube-house',50,250,200,0],
    ['stairs-right-1',150,150,110,90],
  ] as const) {
    const result=tryPlace(state,productId,{x,y,z},rotation);
    if(!result.ok)throw new Error(result.reason);state=result.state;
  }
  return state;
}
export function createBeddingDemonstration() {
  const state=createIntroductionDesigns()[0].state;
  return {...state,bedding:{mode:'thick' as const,depth:100 as const}};
}
export function introductionPhase(page:number,elapsed:number) {
  return page===0?Math.min(2,Math.floor(elapsed/2000)):page===1?Math.min(2,Math.floor(elapsed/4000)):page===2?Math.min(3,Math.floor(elapsed/2000)):Math.min(2,Math.floor(elapsed/3400));
}
