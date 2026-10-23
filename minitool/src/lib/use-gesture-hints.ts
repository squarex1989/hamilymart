import { createDraftStorage } from './storage';
import { useEffect, useRef, useState } from 'react';
import { SCENE_GESTURES, type SceneGesture } from './gesture-learning';
const KEY='hamilymart.gestureHints.v1';
let backend: ReturnType<typeof createDraftStorage> | undefined;
const storage=async()=>{const s=await (backend ??= createDraftStorage());return {read:async()=>{const result=await s.read(KEY);return result.ok?result.value:null;},write:async(value:string)=>{await s.write(KEY,value);}};};
export function useGestureHints() {
  const [completed,setCompleted]=useState<SceneGesture[]>([]),[loaded,setLoaded]=useState(false);
  const queue=useRef(Promise.resolve());
  useEffect(()=>{let active=true;void storage().then(s=>s.read()).then(raw=>{const parsed=raw?JSON.parse(raw):[];if(active && Array.isArray(parsed))setCompleted(current=>[...new Set([...current,...parsed.filter((x):x is SceneGesture=>SCENE_GESTURES.includes(x))])]);}).catch(()=>{}).finally(()=>{if(active)setLoaded(true)});return()=>{active=false;};},[]);
  useEffect(()=>{if(!loaded)return;queue.current=queue.current.then(async()=>{const s=await storage();await s.write(JSON.stringify(completed));}).catch(()=>{});},[loaded,completed]);
  const complete=(gesture:SceneGesture)=>setCompleted(current=>current.includes(gesture)?current:[...current,gesture]);
  return { remaining:SCENE_GESTURES.filter(x=>!completed.includes(x)),complete };
}
