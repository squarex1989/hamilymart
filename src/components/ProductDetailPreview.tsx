import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadPart } from '../lib/model-loader';
import { configureModelRenderer, createModelLighting, createModelMaterial, setModelPartTransform, MODEL_CAMERA_DIRECTION } from '../lib/model-presentation';
import { createExplodedLayout } from '../lib/exploded-view';
import { createBlankDoubleTap } from '../lib/scene-gestures';
import type { ProductDetail } from '../lib/product-detail';
import { dimensionSegments, dimensionsInCentimeters } from '../lib/scene-annotations';
import './scene-overlays.css';

/** Own camera and cloned materials; never mutate the assembly or its cached assets. */
export default function ProductDetailPreview({ detail }: { detail: ProductDetail }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在加载 3D 模型…');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exploded, setExploded] = useState(false);
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    const element = host.current!;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    setStatus('正在加载 3D 模型…');
    setFailed(false); setExploded(false);
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { setStatus('3D 预览暂时无法启动'); setFailed(true); return; }
    configureModelRenderer(renderer);
    renderer.shadowMap.enabled = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 10000);
    camera.up.set(0, 0, 1);
    const lighting = createModelLighting(scene);
    lighting.centerAt(0, 0);
    const group = new THREE.Group();
    const owner = new THREE.Group(); owner.userData.itemId = detail.id;
    group.add(owner); scene.add(group);
    const materials: THREE.Material[] = [];
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: null };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: null };
    renderer.domElement.setAttribute('aria-label', `${detail.title}独立3D预览，可旋转及双击展开`);
    renderer.domElement.style.touchAction = 'none';
    element.appendChild(renderer.domElement);
    const dimensionLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: '#53696B', transparent: true, opacity: .7, depthTest: false, depthWrite: false,
    }));
    dimensionLines.renderOrder = 7; dimensionLines.visible = false;
    scene.add(dimensionLines);
    const dimensionLabels = ['长', '宽', '高'].map(axis => {
      const label = document.createElement('span');
      label.className = 'scene-dimension-label'; label.dataset.axis = axis; label.hidden = true;
      element.appendChild(label); return label;
    });
    let measurementBounds: THREE.Box3 | null = null;
    let dimensionKey = '';
    let viewportWidth = 1, viewportHeight = 1;
    let radius = 0;
    let frame = 0, interacting = false, contextLost = false;
    let layout: ReturnType<typeof createExplodedLayout> | null = null;
    let amount = 0, target = 0, from = 0, animationStart = 0;
    const taps = createBlankDoubleTap();
    const pointers = new Set<number>();
    let press: { id: number; x: number; y: number; at: number } | null = null;
    const updateDimensions = () => {
      // Match the main scene: rulers describe the assembled item, not exploded gaps.
      const visible = !!measurementBounds && !amount && !target && !contextLost;
      dimensionLines.visible = visible;
      dimensionLabels.forEach(label => { label.hidden = !visible; });
      if (!visible || !measurementBounds) return;
      camera.updateMatrixWorld();
      const segments = dimensionSegments(measurementBounds, camera.position);
      const key = segments.flatMap(segment => segment.flatMap(point => point.toArray())).join(',');
      if (key !== dimensionKey) {
        dimensionKey = key;
        const points: THREE.Vector3[] = [];
        segments.forEach(([start, end], i) => {
          const tick = i === 0 ? new THREE.Vector3(0, 3, 0) : new THREE.Vector3(3, 0, 0);
          points.push(start, end, start.clone().sub(tick), start.clone().add(tick), end.clone().sub(tick), end.clone().add(tick));
        });
        dimensionLines.geometry.dispose();
        dimensionLines.geometry = new THREE.BufferGeometry().setFromPoints(points);
      }
      const occupied: { x: number; y: number; width: number; height: number }[] = [];
      segments.forEach(([start, end], i) => {
        const point = start.clone().lerp(end, .5).project(camera);
        const label = dimensionLabels[i];
        label.hidden = point.z < -1 || point.z > 1;
        if (label.hidden) return;
        const width = label.offsetWidth, height = label.offsetHeight;
        const x = THREE.MathUtils.clamp((point.x + 1) * viewportWidth / 2, width / 2 + 6, viewportWidth - width / 2 - 6);
        let y = THREE.MathUtils.clamp((1 - point.y) * viewportHeight / 2, height / 2 + 6, viewportHeight - height / 2 - 6);
        // Nearby cube edges can project onto one another; stagger only colliding labels.
        for (let n = 0; n < dimensionLabels.length; n++) {
          const overlap = occupied.find(other => Math.abs(x - other.x) < (width + other.width) / 2 + 4 && Math.abs(y - other.y) < (height + other.height) / 2 + 4);
          if (!overlap) break;
          y = Math.max(height / 2 + 6, overlap.y - (height + overlap.height) / 2 - 5);
        }
        occupied.push({ x, y, width, height });
        label.style.left = `${x}px`; label.style.top = `${y}px`;
      });
    };
    const render = () => {
      if (disposed || frame || !radius || document.hidden || contextLost) return;
      frame = requestAnimationFrame(now => {
        frame = 0;
        if (disposed || document.hidden || contextLost) return;
        if (layout && amount !== target) {
          const progress = Math.min(1, Math.max(0, (now - animationStart) / 280));
          amount = from + (target - from) * (progress * progress * (3 - 2 * progress));
          if (progress === 1) amount = target;
          layout.apply(amount);
          const bounds = layout.originalBounds.clone();
          bounds.min.lerp(layout.expandedBounds.min, amount); bounds.max.lerp(layout.expandedBounds.max, amount);
          group.position.copy(bounds.getCenter(new THREE.Vector3()).negate());
          radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
          fit(false);
        }
        updateDimensions();
        renderer.render(scene, camera);
        if (amount !== target) render();
      });
    };
    const fit = (requestFrame = true) => {
      if (disposed) return;
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
      viewportWidth = width; viewportHeight = height;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, interacting ? 1.5 : 2, Math.sqrt(2000000 / (width * height))));
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const angle = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
      const distance = Math.max(1, (radius + 32) * 1.15 / Math.sin(angle));
      const direction = camera.position.lengthSq() ? camera.position.clone().normalize() : new THREE.Vector3(...MODEL_CAMERA_DIRECTION).normalize();
      camera.position.copy(direction.multiplyScalar(distance));
      camera.near = Math.max(.1, distance - radius * 2);
      camera.far = distance + radius * 3 + 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      if (requestFrame) render();
    };
    const start = () => { interacting = true; fit(); };
    const end = () => { interacting = false; fit(); };
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    controls.addEventListener('change', render);
    document.addEventListener('visibilitychange', render);
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; dimensionLabels.forEach(label => { label.hidden = true; }); cancelAnimationFrame(frame); frame = 0; if (!disposed) { setStatus('3D 连接中断，请重试'); setFailed(true); } };
    const restored = () => { if (!disposed) { contextLost = false; setStatus(''); setFailed(false); render(); } };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    renderer.domElement.addEventListener('webglcontextrestored', restored);
    const toggle = () => {
      if (!layout || disposed || contextLost) return;
      taps.reset(); from = amount; target = target ? 0 : 1; animationStart = performance.now();
      setExploded(!!target); render();
    };
    toggleRef.current = toggle;
    const pointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      if (pointers.size !== 1 || event.button !== 0) { press = null; taps.reset(); return; }
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
    };
    const pointerMove = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) { press = null; taps.reset(); }
    };
    const pointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId); const previous = press; press = null;
      if (!previous || previous.id !== event.pointerId || pointers.size || performance.now() - previous.at > 400
        || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 6) { taps.reset(); return; }
      if (taps.tap(event.clientX, event.clientY, performance.now(), event.pointerType)) toggle();
    };
    const pointerCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); press = null; taps.reset(); };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    // Preserve source transforms and offsets, then center the whole assembled item.
    Promise.all(detail.parts.map(async part => {
      const source = await loadPart(part.id);
      if (disposed) return;
      const child = source.clone(true);
      child.userData.partId = part.id;
      setModelPartTransform(child, part, [0, 0, 0], detail.doorSide);
      child.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.userData.modelMesh = true;
        const originals = Array.isArray(object.material) ? object.material : [object.material];
        const clones = originals.map(material => createModelMaterial(material, part, object.userData.sourcePart, object.userData.colorKey, detail.colors));
        materials.push(...clones);
        object.material = Array.isArray(object.material) ? clones : clones[0];
      });
      owner.add(child);
    })).then(() => {
      if (disposed) return;
      layout = createExplodedLayout(group, "parts");
      const bounds = layout.originalBounds;
      // Measure assembled source geometry once: orbit and exploded spacing are not product size.
      const values = dimensionsInCentimeters(bounds);
      dimensionLabels.forEach((label, i) => { label.textContent = `${label.dataset.axis} ${values[i]} cm`; });
      const center = bounds.getCenter(new THREE.Vector3());
      radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
      group.position.copy(center.negate());
      measurementBounds = bounds.clone().translate(group.position);
      fit(); setStatus('');
    }).catch(() => { if (!disposed) { setStatus('模型加载失败，请重试'); setFailed(true); } });
    return () => {
      disposed = true; cancelAnimationFrame(frame); toggleRef.current = () => {};
      layout?.restore();
      dimensionLines.geometry.dispose(); dimensionLines.material.dispose();
      dimensionLabels.forEach(label => label.remove());
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      document.removeEventListener("visibilitychange", render);
      observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener('webglcontextrestored', restored);
      materials.forEach(material => material.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      // Geometry belongs to the shared model cache and must stay alive.
    };
  }, [detail, attempt]);
  return <div className="product-detail-viewer">
    <div className="product-detail-canvas" ref={host} />
    <button className="product-detail-explode" disabled={!!status || failed} aria-pressed={exploded} onClick={() => toggleRef.current()}>{exploded ? "恢复组装" : "爆炸展开"}</button>
    {status && <div className="product-detail-status" role="status"><span>{status}</span>{failed && <button onClick={() => setAttempt(value => value + 1)}>重试</button>}</div>}
  </div>;
}
