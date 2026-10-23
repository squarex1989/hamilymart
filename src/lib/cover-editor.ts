import * as THREE from 'three';
import type { AssemblyState } from './assembly';
import { getPlatforms, getDisplayElevation } from './assembly';
import index from '../data/model-index.json';

export function createCoverEditor(scene: THREE.Scene, objects: THREE.Group) {
  const rings = new THREE.Group(); scene.add(rings);
  const originals = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  function clear() {
    originals.forEach((value, material) => { Object.assign(material, value); material.needsUpdate = true; }); originals.clear();
    rings.children.forEach(node => { const mesh = node as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }); rings.clear();
  }
  return {
    rings,
    update(state: AssemblyState, platformId: string | null, selected: string | null) {
      clear();
      const platform = getPlatforms(state).find(p => p.id === platformId);
      if (!platform) return;
      for (const owner of objects.children) {
        if (owner.userData.itemId === platformId) continue;
        owner.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (originals.has(material)) continue;
            originals.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
            material.opacity = .12; material.transparent = true; material.depthWrite = false; material.needsUpdate = true;
          }
        });
      }
      for (const id of ['H01','H02','H03','H04','H05'] as const) {
        const b = index[id].bounds;
        const selectionId = `cover:${platformId}:${id}`;
        const radius = (b[3] - b[0]) / 2;
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 2, radius + 2, 64), new THREE.MeshBasicMaterial({color: selected === selectionId ? '#F3B32B' : '#439AD2',depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
        ring.position.set(platform.x+(b[0]+b[3])/2, platform.y+(b[1]+b[4])/2, b[5]+getDisplayElevation(state,platform.id)+1);
        ring.userData.selectionId = selectionId;ring.layers.enable(1);ring.renderOrder=12;rings.add(ring);
        const hit = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
        hit.position.copy(ring.position);hit.userData.selectionId=selectionId;hit.layers.enable(1);rings.add(hit);
      }
      rings.updateMatrixWorld(true);
    },
    selectionBounds(id: string | null) { const ring = rings.children.find(node=>node.userData.selectionId===id); return ring ? new THREE.Box3().setFromObject(ring) : null; },
    dispose() { clear(); scene.remove(rings); },
  };
}
