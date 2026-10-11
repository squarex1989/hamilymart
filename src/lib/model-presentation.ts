import * as THREE from 'three';
import type { ColorMap, ProductPart } from '../data/catalog';
import { applyFinish } from './scene-finishes';
import { getModelMaterialColor } from './model-colors';

/** Bump together with the asset revision when changing baked catalog lighting. */
export const MODEL_RENDER_VERSION = 'three-shared-v1';
export const MODEL_CAMERA_DIRECTION = [480, -710, 445] as const;

/** The live workbench and offline catalog export use this exact color pipeline. */
export function configureModelRenderer(renderer: THREE.WebGLRenderer) {
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

export function createModelLighting(scene: THREE.Scene) {
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#b4b99c', 2.7);
  const sun = new THREE.DirectionalLight('#fff6e9', 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -850, right: 850, top: 850, bottom: -850, far: 1600 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .5;
  sun.shadow.bias = -.0003;
  const fill = new THREE.DirectionalLight('#d9f3ee', 1.2);
  const underside = new THREE.DirectionalLight('#FFF8EC', 1.5);
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
  if (part.id === 'G05' && colorKey === 'ChristmasRed') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  return material;
}
