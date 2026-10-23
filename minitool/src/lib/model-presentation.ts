import { REVERSIBLE_PANELS } from '../data/reversible-panels';
import * as THREE from 'three';
import type { ColorMap, ProductPart } from '../data/catalog';
import { getSourceColorSlot } from '../data/catalog';
import { applyFinish } from './scene-finishes';
import { getModelMaterialColor } from './model-colors';
import type { DoorSide } from './aite-panel';

/** Bump together with the asset revision when changing baked catalog lighting. */
export const MODEL_RENDER_VERSION = 'three-neutral-v5-wall-planes';
export const MODEL_CAMERA_DIRECTION = [480, -710, 445] as const;

/** Match the printable Aite panel: turn around its vertical centre line.
 * A rigid 180° turn preserves face winding, lighting, picking and instancing. */
export function setModelPartTransform(child: THREE.Object3D, part: ProductPart, origin: number[] = [0, 0, 0], doorSide?: DoorSide) {
  child.position.set(
    -origin[0] + (part.offset?.[0] ?? 0),
    -origin[1] + (part.offset?.[1] ?? 0),
    -origin[2] + (part.offset?.[2] ?? 0),
  );
  const panel = Object.values(REVERSIBLE_PANELS).find(config => config.partId === part.id);
  if (panel) {
    const reversed = doorSide === 'left';
    child.rotation.z = reversed ? Math.PI : 0;
    if (reversed) child.position.add(new THREE.Vector3(...panel.translation));
  }
}

/** The live workbench and offline catalog export use this exact color pipeline. */
export function configureModelRenderer(renderer: THREE.WebGLRenderer) {
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Preserve light stock colors instead of compressing cream into white.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
}

export function createModelLighting(scene: THREE.Scene) {
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#b8b8b8', 2.7);
  const sun = new THREE.DirectionalLight('#ffffff', 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -850, right: 850, top: 850, bottom: -850, far: 1600 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .5;
  sun.shadow.bias = -.0003;
  const fill = new THREE.DirectionalLight('#ffffff', 1.2);
  const underside = new THREE.DirectionalLight('#ffffff', 1.5);
  underside.visible = false;
  scene.add(hemisphere, sun, sun.target, fill, fill.target, underside, underside.target);
  const centerAt = (x: number, y: number) => {
    // Move lights and targets together so adding a tall or distant component
    // cannot change the hue/brightness of every existing colored surface.
    sun.position.set(x - 370, y - 450, 650);
    fill.position.set(x + 500, y + 300, 350);
    underside.position.set(x - 250, y - 300, -500);
    for (const light of [sun, fill, underside]) light.target.position.set(x, y, 0);
  };
  centerAt(150, 150);
  return { sun, fill, hemisphere, underside, centerAt };
}

/** Identical physical finish, source slots and stair face treatment in both views. */
export function createModelMaterial(source: THREE.Material, part: ProductPart, sourcePart: string | undefined, colorKey: string | undefined, colors: ColorMap) {
  const material = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  applyFinish(material, getModelMaterialColor(part, sourcePart, colorKey, colors));
  const slot = getSourceColorSlot(part.id, sourcePart, colorKey);
  if (slot === 'PCW-glass' || slot === 'PCR-glass') {
    material.transparent = true; material.opacity = .6; material.depthWrite = false;
    material.roughness = .25;
  }
  if (part.id === 'G05' && colorKey === 'ChristmasRed') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  return material;
}
