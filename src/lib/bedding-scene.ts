import * as THREE from "three";
import { getPlatforms, getDisplayElevation } from "./assembly";
import type { AssemblyState } from "./assembly";
import modelIndex from "../data/model-index.json";

function createShavingsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#D6BD91";
  context.fillRect(0, 0, 1024, 1024);
  let seed = 72819;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // Small overlapping curls, drawn across tile boundaries for seamless sides.
  for (let i = 0; i < 4600; i++) {
    const x = random() * 1024, y = random() * 1024;
    const width = 14 + random() * 54, height = 4 + random() * 16;
    const angle = random() * Math.PI;
    const lightness = 69 + random() * 16;
    for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) {
      context.save();
      context.translate(x + dx, y + dy);
      context.rotate(angle);
      context.fillStyle = `hsl(42 42% ${lightness}%)`;
      context.beginPath();
      context.moveTo(-width / 2, -height / 3);
      context.lineTo(width * .4, -height / 2);
      context.quadraticCurveTo(width * .58, 0, width / 2, height / 3);
      context.lineTo(-width * .42, height / 2);
      context.closePath(); context.fill();
      context.strokeStyle = "rgba(113, 85, 44, .18)";
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(-width * .4, 0);
      context.quadraticCurveTo(0, -height * .16, width * .4, height * .13);
      context.stroke();
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry uses millimetres in its generated UVs.
  texture.repeat.set(1 / 120, 1 / 120);
  return texture;
}

/** Lightweight instanced shavings with a solid fill so open holes reveal bedding. */
export function createBedding(scene: THREE.Scene) {
  const shavingsTexture = createShavingsTexture();
  const group = new THREE.Group();
  group.name = "浅黄木屑垫料";
  scene.add(group);
  let signature = "";
  const clear = () => {
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      }
    });
    group.clear();
  };
  return {
    update(state: AssemblyState) {
      const platforms = getPlatforms(state);
      const elevation = getDisplayElevation(state);
      const key = JSON.stringify([state.bedding.depth, elevation, platforms.map(p => [p.x, p.y, p.baseInsert])]);
      if (key === signature) return;
      signature = key;
      clear();
      const minX = Math.min(...platforms.map(p => p.x)) - 12;
      const maxX = Math.max(...platforms.map(p => p.x + 300)) + 12;
      const minY = Math.min(...platforms.map(p => p.y)) - 12;
      const maxY = Math.max(...platforms.map(p => p.y + 300)) + 12;
      const height = state.bedding.depth;
      const poolBottom = modelIndex.B01.bounds[2] + elevation;
      const pools = platforms.filter(p => p.baseInsert === "pool" && poolBottom < height - 1.5).map(p => ({ x: p.x + 100, y: p.y + 100 }));
      const solidDepth = pools.length ? Math.max(0, poolBottom - 1) : 0;
      const material = new THREE.MeshStandardMaterial({ color: "#FFFFFF", map: shavingsTexture, bumpMap: shavingsTexture, bumpScale: .25, roughness: 1 });
      const outline = new THREE.Shape();
      outline.moveTo(minX, minY); outline.lineTo(maxX, minY); outline.lineTo(maxX, maxY); outline.lineTo(minX, maxY); outline.closePath();
      for (const pool of pools) {
        const cavity = new THREE.Path();
        cavity.absarc(pool.x, pool.y, 80, 0, Math.PI * 2, true);
        outline.holes.push(cavity);
      }
      // Only displace shavings where the actual basin intersects the bedding.
      // In particular, a raised pool above thin bedding leaves a solid pile below.
      if (solidDepth > 0) {
        const bottomOutline = new THREE.Shape();
        bottomOutline.moveTo(minX, minY); bottomOutline.lineTo(maxX, minY); bottomOutline.lineTo(maxX, maxY); bottomOutline.lineTo(minX, maxY); bottomOutline.closePath();
        const bottom = new THREE.Mesh(new THREE.ExtrudeGeometry(bottomOutline, { depth: solidDepth, bevelEnabled: false }), material.clone());
        bottom.castShadow = bottom.receiveShadow = true;
        group.add(bottom);
      }
      const fill = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: height - 1.5 - solidDepth, bevelEnabled: false, curveSegments: 48 }), material);
      fill.position.z = solidDepth;
      fill.castShadow = true;
      fill.receiveShadow = true;
      group.add(fill);
      const count = platforms.length * 1500;
      const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#EDD6AD", roughness: .94 }), count);
      let seed = 13579;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        let x: number, y: number;
        do { x = minX + random() * (maxX - minX); y = minY + random() * (maxY - minY); }
        while (pools.some(pool => Math.hypot(x - pool.x, y - pool.y) < 83));
        dummy.position.set(x, y, height - 1 + random() * 1.4);
        dummy.rotation.set((random() - .5) * .4, (random() - .5) * .4, random() * Math.PI);
        dummy.scale.set(3 + random() * 8, 1.2 + random() * 3, .45 + random() * .45);
        dummy.updateMatrix();
        chips.setMatrixAt(i, dummy.matrix);
        chips.setColorAt(i, new THREE.Color().setHSL(.115, .34 + random() * .14, .68 + random() * .2));
      }
      chips.receiveShadow = true;
      chips.instanceMatrix.needsUpdate = true;
      group.add(chips);
    },
    dispose() { clear(); shavingsTexture.dispose(); scene.remove(group); },
  };
}
