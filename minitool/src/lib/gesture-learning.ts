import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isTrackpadPan, panScenePixels } from './scene-trackpad';
export type SceneGesture = 'rotate' | 'pan' | 'zoom' | 'explode';
export const SCENE_GESTURES: readonly SceneGesture[] = ['rotate', 'pan', 'zoom', 'explode'];
export const GESTURE_LABELS: Record<SceneGesture, string> = { rotate: '单指旋转', pan: '双指移动', zoom: '双指缩放', explode: '双击爆炸' };
/** A hint completes only after an input gesture has actually changed the camera. */
export function bindGestureLearning(host: HTMLElement, canvas: HTMLElement, camera: THREE.Camera, controls: OrbitControls, complete: (gesture: SceneGesture) => void) {
  const pointers = new Map<number, { x: number; y: number; touch: boolean }>();
  let start: { x: number; y: number; spread: number; target: THREE.Vector3; distance: number; rotation: THREE.Quaternion } | null = null;
  const done = new Set<SceneGesture>();
  let wheelStart: { kind: 'pan' | 'zoom'; at: number; travel: number; target: THREE.Vector3; distance: number } | null = null;
  const metrics = () => {
    const points = [...pointers.values()];
    return { x: points.reduce((v,p)=>v+p.x,0)/points.length, y: points.reduce((v,p)=>v+p.y,0)/points.length,
      spread: points.length===2 ? Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y) : 0 };
  };
  const reset = () => { start = pointers.size ? { ...metrics(), target: controls.target.clone(), distance: camera.position.distanceTo(controls.target), rotation: camera.quaternion.clone() } : null; };
  const mark = (gesture: SceneGesture) => { if (!done.has(gesture)) { done.add(gesture); complete(gesture); } };
  const down = (e: PointerEvent) => { if (e.button!==0) return; wheelStart = null; pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,touch:e.pointerType==='touch'});reset(); };
  const move = (e: PointerEvent) => { const p=pointers.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY;} };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId);reset(); };
  const changed = () => {
    if (controls.enabled && wheelStart && performance.now() - wheelStart.at < 250) {
      if (wheelStart.kind === 'pan' && wheelStart.travel >= 6 && controls.target.distanceTo(wheelStart.target) > 1) mark('pan');
      if (wheelStart.kind === 'zoom' && Math.abs(camera.position.distanceTo(controls.target) / wheelStart.distance - 1) > .015) mark('zoom');
    }
    if (!controls.enabled || !start || !pointers.size) return;
    const now=metrics(), travel=Math.hypot(now.x-start.x,now.y-start.y);
    if(pointers.size===1 && travel>=6 && camera.quaternion.angleTo(start.rotation)>.025)mark('rotate');
    if(pointers.size===2 && [...pointers.values()].every(p=>p.touch)) {
      if(travel>=6 && controls.target.distanceTo(start.target)>1)mark('pan');
      if(Math.abs(now.spread-start.spread)>=6 && Math.abs(camera.position.distanceTo(controls.target)/start.distance-1)>.015)mark('zoom');
    }
  };
  const wheel = (event: WheelEvent) => {
    if (!controls.enabled || pointers.size) { wheelStart = null; return; }
    const pan = isTrackpadPan(event);
    // Only a trackpad pinch completes "双指缩放"; an ordinary mouse wheel does not.
    if (!pan && !event.ctrlKey) { wheelStart = null; return; }
    if (pan ? !controls.enablePan : !controls.enableZoom) { wheelStart = null; return; }
    const kind = pan ? 'pan' : 'zoom', now = performance.now();
    if (!wheelStart || wheelStart.kind !== kind || now - wheelStart.at > 250) {
      wheelStart = { kind, at: now, travel: 0, target: controls.target.clone(), distance: camera.position.distanceTo(controls.target) };
    }
    wheelStart.at = now;
    wheelStart.travel += Math.hypot(event.deltaX, event.deltaY);
    if (pan) {
      event.preventDefault();
      event.stopImmediatePropagation(); // OrbitControls would treat scroll as zoom.
      panScenePixels(camera, controls, canvas.clientWidth, canvas.clientHeight, event.deltaX, event.deltaY);
    }
    // Pinch continues to OrbitControls' native ctrl+wheel zoom and camera limits.
  };
  canvas.addEventListener('wheel', wheel, { capture: true, passive: false });
  canvas.addEventListener('pointerdown',down,true);
  window.addEventListener('pointermove',move,true);
  window.addEventListener('pointerup',up,true);
  window.addEventListener('pointercancel',up,true);
  controls.addEventListener('change',changed);
  const actions=host.parentElement?.querySelector<HTMLElement>('.canvas-bottom-actions');
  const position=()=>{const box=host.getBoundingClientRect(),bottom=actions?.getBoundingClientRect();host.style.setProperty('--gesture-hint-bottom',`${bottom ? Math.max(12,box.bottom-bottom.top+8) : 68}px`);};
  const observer=new ResizeObserver(position);observer.observe(host);if(actions)observer.observe(actions);position();
  return ()=>{canvas.removeEventListener('wheel',wheel,true);canvas.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);controls.removeEventListener('change',changed);observer.disconnect();};
}
