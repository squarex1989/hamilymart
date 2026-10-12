import * as THREE from "three";
import { getPlatforms, getDisplayElevation } from "./assembly";
import type { AssemblyState } from "./assembly";
import modelIndex from "../data/model-index.json";
import { MIN_BEDDING_OPACITY } from "./bedding-fade";

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type Pool = { x: number; y: number };
const CAVITY_RADIUS = 82;
export const BEDDING_OVERHANG_MM = 50;

/** One continuous bed around the whole joined platform footprint. */
export function getBeddingBounds(state: AssemblyState): Bounds {
  const platforms = getPlatforms(state);
  return {
    minX: Math.min(...platforms.map(p => p.x)) - BEDDING_OVERHANG_MM,
    maxX: Math.max(...platforms.map(p => p.x + 300)) + BEDDING_OVERHANG_MM,
    minY: Math.min(...platforms.map(p => p.y)) - BEDDING_OVERHANG_MM,
    maxY: Math.max(...platforms.map(p => p.y + 300)) + BEDDING_OVERHANG_MM,
  };
}

function fitOuterEnvelope(group: THREE.Group, target: Bounds) {
  // The pile's sloping foot and curled tips extend past its nominal outline.
  // Fit only this outer fringe to the requested 50 mm envelope, leaving the
  // platform footprint and every pool cavity in their exact world positions.
  const source = new THREE.Box3().setFromObject(group);
  const inner = {
    minX: target.minX + BEDDING_OVERHANG_MM, maxX: target.maxX - BEDDING_OVERHANG_MM,
    minY: target.minY + BEDDING_OVERHANG_MM, maxY: target.maxY - BEDDING_OVERHANG_MM,
  };
  const axes = [
    { min: inner.minX, max: inner.maxX, lowScale: BEDDING_OVERHANG_MM / (inner.minX - source.min.x), highScale: BEDDING_OVERHANG_MM / (source.max.x - inner.maxX) },
    { min: inner.minY, max: inner.maxY, lowScale: BEDDING_OVERHANG_MM / (inner.minY - source.min.y), highScale: BEDDING_OVERHANG_MM / (source.max.y - inner.maxY) },
  ];
  const scaleAt = (value: number, axis: typeof axes[number]) => value < axis.min ? axis.lowScale : value > axis.max ? axis.highScale : 1;
  const warp = (value: number, axis: typeof axes[number]) => value < axis.min
    ? axis.min + (value - axis.min) * axis.lowScale
    : value > axis.max ? axis.max + (value - axis.max) * axis.highScale : value;
  const matrix = new THREE.Matrix4();
  group.traverse(object => {
    if (object instanceof THREE.InstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        for (let axis = 0; axis < 2; axis++) {
          const value = matrix.elements[12 + axis], scale = scaleAt(value, axes[axis]);
          for (const column of [0, 4, 8]) matrix.elements[column + axis] *= scale;
          matrix.elements[12 + axis] = warp(value, axes[axis]);
        }
        object.setMatrixAt(i, matrix);
      }
      object.instanceMatrix.needsUpdate = true;
      object.computeBoundingBox(); object.computeBoundingSphere();
    } else if (object instanceof THREE.Mesh) {
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        positions.setXY(i, warp(positions.getX(i), axes[0]), warp(positions.getY(i), axes[1]));
      }
      positions.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
    }
  });
}

function createShavingsTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#DDC69C";
  context.fillRect(0, 0, 512, 512);
  let seed = 72819;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 1400; i++) {
    const x = random() * 512, y = random() * 512;
    const width = 7 + random() * 22, height = 2 + random() * 6;
    const angle = random() * Math.PI;
    const lightness = 72 + random() * 16;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      context.save();
      context.translate(x + dx, y + dy);
      context.rotate(angle);
      context.fillStyle = `hsl(42, 39%, ${lightness}%)`;
      context.beginPath();
      context.moveTo(-width / 2, -height / 3);
      context.lineTo(width * .4, -height / 2);
      context.quadraticCurveTo(width * .58, 0, width / 2, height / 3);
      context.lineTo(-width * .42, height / 2);
      context.closePath(); context.fill();
      context.strokeStyle = "rgba(113, 85, 44, .13)";
      context.lineWidth = .7;
      context.beginPath(); context.moveTo(-width * .4, 0);
      context.quadraticCurveTo(0, -height * .16, width * .4, height * .13);
      context.stroke();
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // All generated surfaces use millimetres for their UV coordinates.
  texture.repeat.set(1 / 105, 1 / 105);
  return texture;
}

function roundedOutline(bounds: Bounds, inset: number) {
  const { minX, minY, maxX, maxY } = bounds;
  const left = minX + inset, right = maxX - inset;
  const bottom = minY + inset, top = maxY - inset;
  const radius = 26 - inset * .45;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.absarc(right - radius, bottom + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(right, top - radius);
  shape.absarc(right - radius, top - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(left + radius, top);
  shape.absarc(left + radius, top - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(left, bottom + radius);
  shape.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

function topSurface(x: number, y: number, height: number) {
  // Broad, shallow undulations stay below the platform, even with no legs.
  return height - 4 + Math.sin(x * .037 + y * .013) * .45 + Math.sin(y * .059 - x * .017) * .35;
}

function shapeWithPools(points: THREE.Vector2[], pools: Pool[]) {
  const shape = new THREE.Shape(points);
  for (const pool of pools) {
    const cavity = new THREE.Path();
    cavity.absarc(pool.x, pool.y, CAVITY_RADIUS, 0, Math.PI * 2, true);
    shape.holes.push(cavity);
  }
  return shape;
}

/** Split broad cap triangles so the surface itself can have small hills. */
function makeTop(shape: THREE.Shape, height: number) {
  const source = new THREE.ShapeGeometry(shape, 32);
  const positions = source.getAttribute("position");
  const indices = source.index!;
  const output: number[] = [];
  const uv: number[] = [];
  const point = (index: number) => new THREE.Vector2(positions.getX(index), positions.getY(index));
  const write = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth = 0) => {
    const lengths = [a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a)];
    const longest = Math.max(...lengths);
    if (longest > 24 * 24 && depth < 15) {
      const edge = lengths.indexOf(longest);
      const points = [a, b, c];
      const first = points[edge], second = points[(edge + 1) % 3], other = points[(edge + 2) % 3];
      const middle = first.clone().add(second).multiplyScalar(.5);
      write(first, middle, other, depth + 1);
      write(middle, second, other, depth + 1);
    } else {
      for (const p of [a, b, c]) {
        output.push(p.x, p.y, topSurface(p.x, p.y, height));
        uv.push(p.x, p.y);
      }
    }
  };
  for (let i = 0; i < indices.count; i += 3) write(point(indices.getX(i)), point(indices.getX(i + 1)), point(indices.getX(i + 2)));
  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(output, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function makeRibbon() {
  // A tapered curl rather than a rectangular chip: eight small triangles per
  // shaving, instanced on both the top and the sides to soften the silhouette.
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const width = Math.sin(Math.PI * (t * .8 + .1)) * .5;
    const curl = Math.sin(t * Math.PI) * .18;
    positions.push(t - .5, -width, curl, t - .5, width, curl + .035);
    if (i < 4) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rounded, gently uneven fill with real curled shavings around every edge. */
export function createBedding(scene: THREE.Scene) {
  const shavingsTexture = createShavingsTexture();
  const group = new THREE.Group();
  group.name = "浅黄蓬松木屑垫料";
  scene.add(group);
  let signature = "";
  let opacity = 1;
  const materials: THREE.Material[] = [];
  const shadowCasters: THREE.Mesh[] = [];
  const applyOpacity = () => {
    const translucent = opacity < 1;
    for (const material of materials) {
      const changed = material.transparent !== translucent;
      material.opacity = opacity;
      material.transparent = translucent;
      // A faint pile must not write opaque depth over the platform and legs.
      material.depthWrite = !translucent;
      // The curled, double-sided chips do not need two blended passes.
      material.forceSinglePass = translucent;
      if (changed) material.needsUpdate = true;
    }
    // Three's normal depth shadow material treats the pile as solid even at
    // 20% opacity. Disable only its casters while translucent; the cache needs
    // refreshing at the two endpoints, never on every opacity animation frame.
    for (const mesh of shadowCasters) mesh.castShadow = !translucent;
  };
  const clear = () => {
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      }
    });
    group.clear();
    materials.length = shadowCasters.length = 0;
  };
  return {
    setVisible(visible: boolean) { group.visible = visible; },
    setOpacity(value: number) {
      const next = Math.max(MIN_BEDDING_OPACITY, Math.min(1, value));
      if (next === opacity) return false;
      const shadowsChanged = (opacity === 1) !== (next === 1) && shadowCasters.length > 0;
      opacity = next;
      applyOpacity();
      return shadowsChanged;
    },
    setLowQuality(low: boolean) { group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.visible = !low; }); },
    update(state: AssemblyState) {
      const platforms = getPlatforms(state);
      const elevation = getDisplayElevation(state);
      const key = JSON.stringify([state.bedding.depth, elevation, platforms.map(p => [p.x, p.y, p.baseInsert])]);
      if (key === signature) return;
      signature = key;
      clear();
      const height = state.bedding.depth;
      if (height === 0) return;
      const bounds = getBeddingBounds(state);
      const poolBottom = modelIndex.B01.bounds[2] + elevation;
      // A raised basin must not punch a hole through bedding it never touches.
      const pools = platforms.filter(p => p.baseInsert === "pool" && poolBottom < height - 1)
        .map(p => ({ x: p.x + 100, y: p.y + 100 }));
      const floor = Math.max(0, poolBottom - .5);
      const material = new THREE.MeshStandardMaterial({
        color: "#FFFFFF", map: shavingsTexture, bumpMap: shavingsTexture,
        bumpScale: .38, roughness: 1,
      });
      const addMesh = (geometry: THREE.BufferGeometry, ownMaterial = material.clone()) => {
        const mesh = new THREE.Mesh(geometry, ownMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        // Each surface has its own clone; other objects and texture owners
        // never share a material whose transparency we animate.
        materials.push(ownMaterial);
        shadowCasters.push(mesh);
        group.add(mesh);
        return mesh;
      };
      const perimeter = roundedOutline(bounds, 0).getLength();
      const segments = Math.ceil(perimeter / 13);
      const contour = (inset: number, z: number) => {
        const points = roundedOutline(bounds, inset).getSpacedPoints(segments).slice(0, -1);
        return points.map((p, i) => {
          const before = points[(i + segments - 1) % segments], after = points[(i + 1) % segments];
          const direction = after.clone().sub(before).normalize();
          const ripple = Math.sin(p.x * .031 + p.y * .043) * 1.4
            + Math.sin(p.x * .057 - p.y * .019 + z * .012) * 1.1
            + Math.sin(p.x * .014 + p.y * .025) * 1.7;
          return p.clone().add(new THREE.Vector2(direction.y, -direction.x).multiplyScalar(ripple));
        });
      };
      const topContour = contour(8, height - 4);
      addMesh(makeTop(shapeWithPools(topContour, pools), height));

      // The fill spreads out at its foot and bows gently outwards. Together
      // with the irregular perimeter this reads as a loose pile, not a block.
      const spread = Math.min(32, 16 + height * .045);
      const insetAt = (z: number) => {
        const t = THREE.MathUtils.clamp(z / (height - 4), 0, 1);
        const slope = 8 - spread * Math.pow(1 - t, .65) - Math.sin(t * Math.PI) * 3;
        const roundFoot = z < 8 ? 7 * (1 - Math.sin(z / 8 * Math.PI / 2)) : 0;
        return slope + roundFoot;
      };
      const levels = [0, 3, 8];
      for (let z = 24; z < height - 16; z += 18) levels.push(z);
      levels.push(height - 16, height - 9, height - 4);
      levels.sort((a, b) => a - b);
      const uniqueLevels = [...new Set(levels)];
      const rings = uniqueLevels.map(z => ({ z, points: contour(insetAt(z), z) }));
      const sidePositions: number[] = [], sideUV: number[] = [], sideIndices: number[] = [];
      for (let row = 0; row < uniqueLevels.length; row++) {
        const z = uniqueLevels[row];
        const points = rings[row].points;
        for (let i = 0; i <= segments; i++) {
          const p = points[i % segments];
          const lastRow = row === uniqueLevels.length - 1;
          sidePositions.push(p.x, p.y, lastRow ? topSurface(p.x, p.y, height) : z);
          sideUV.push(i / segments * perimeter, z);
          if (row < uniqueLevels.length - 1 && i < segments) {
            const a = row * (segments + 1) + i, b = a + 1, d = a + segments + 1, c = d + 1;
            sideIndices.push(a, b, d, b, c, d);
          }
        }
      }
      const sides = new THREE.BufferGeometry();
      sides.setAttribute("position", new THREE.Float32BufferAttribute(sidePositions, 3));
      sides.setAttribute("uv", new THREE.Float32BufferAttribute(sideUV, 2));
      sides.setIndex(sideIndices); sides.computeVertexNormals();
      addMesh(sides);
      const bottom = new THREE.ShapeGeometry(shapeWithPools(rings[0].points, floor === 0 ? pools : []), 32);
      bottom.scale(1, 1, -1);
      // The underside faces down, without making the entire fill double-sided.
      const bottomIndex = bottom.index!;
      for (let i = 0; i < bottomIndex.count; i += 3) {
        const second = bottomIndex.getX(i + 1);
        bottomIndex.setX(i + 1, bottomIndex.getX(i + 2)); bottomIndex.setX(i + 2, second);
      }
      bottom.computeVertexNormals(); addMesh(bottom);
      for (const pool of pools) {
        const positions: number[] = [], uv: number[] = [], indices: number[] = [];
        for (let i = 0; i <= 64; i++) {
          const angle = i / 64 * Math.PI * 2;
          const x = pool.x + Math.cos(angle) * CAVITY_RADIUS, y = pool.y + Math.sin(angle) * CAVITY_RADIUS;
          const top = topSurface(x, y, height);
          positions.push(x, y, floor, x, y, Math.max(floor, top));
          uv.push(i / 64 * CAVITY_RADIUS * Math.PI * 2, floor, i / 64 * CAVITY_RADIUS * Math.PI * 2, top);
          if (i < 64) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        }
        const cavity = new THREE.BufferGeometry();
        cavity.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        cavity.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        cavity.setIndex(indices); cavity.computeVertexNormals(); addMesh(cavity);
        if (floor > 0) {
          const disk = new THREE.CircleGeometry(CAVITY_RADIUS, 64);
          disk.translate(pool.x, pool.y, floor);
          const diskUV = disk.getAttribute("uv"), diskPosition = disk.getAttribute("position");
          for (let i = 0; i < diskUV.count; i++) diskUV.setXY(i, diskPosition.getX(i), diskPosition.getY(i));
          addMesh(disk);
        }
      }
      material.dispose();

      let seed = 13579;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const topCount = platforms.length * 180;
      const sideCount = Math.min(400, Math.ceil(perimeter * height / 900));
      const chips = new THREE.InstancedMesh(makeRibbon(), new THREE.MeshStandardMaterial({
        color: "#FFFFFF", roughness: .98, side: THREE.DoubleSide,
      }), topCount + sideCount);
      chips.name = "顶部与四周的卷曲木屑";
      const dummy = new THREE.Object3D();
      const tint = new THREE.Color();
      const up = new THREE.Vector3(0, 0, 1), normal = new THREE.Vector3(), tangent = new THREE.Vector3();
      const basis = new THREE.Matrix4();
      const topBounds = {
        minX: Math.min(...topContour.map(p => p.x)), maxX: Math.max(...topContour.map(p => p.x)),
        minY: Math.min(...topContour.map(p => p.y)), maxY: Math.max(...topContour.map(p => p.y)),
      };
      const insideTop = (x: number, y: number) => {
        let inside = false;
        for (let i = 0, j = topContour.length - 1; i < topContour.length; j = i++) {
          const a = topContour[i], b = topContour[j];
          if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
      };
      for (let i = 0; i < topCount + sideCount; i++) {
        const length = 5 + random() * 10;
        const width = 1.4 + random() * 2.9;
        dummy.scale.set(length, width, 3 + random() * 4);
        if (i < topCount) {
          let x: number, y: number;
          do {
            x = topBounds.minX + random() * (topBounds.maxX - topBounds.minX);
            y = topBounds.minY + random() * (topBounds.maxY - topBounds.minY);
          } while (!insideTop(x, y) || pools.some(pool => Math.hypot(x - pool.x, y - pool.y) < CAVITY_RADIUS + length / 2));
          dummy.rotation.set((random() - .5) * .26, (random() - .5) * .26, random() * Math.PI * 2);
          dummy.position.set(x, y, topSurface(x, y, height) + .15);
        } else {
          const z = 1 + random() * (height - 5);
          const upper = Math.min(rings.length - 1, Math.max(1, rings.findIndex(ring => ring.z >= z)));
          const lower = upper - 1;
          const alpha = (z - rings[lower].z) / (rings[upper].z - rings[lower].z);
          const fraction = random() * segments;
          const index = Math.floor(fraction), next = (index + 1) % segments;
          const p0 = rings[lower].points[index].clone().lerp(rings[upper].points[index], alpha);
          const p1 = rings[lower].points[next].clone().lerp(rings[upper].points[next], alpha);
          const p = p0.clone().lerp(p1, fraction - index), direction = p1.clone().sub(p0).normalize();
          normal.set(direction.y, -direction.x, 0).normalize();
          tangent.set(-normal.y, normal.x, 0);
          basis.makeBasis(tangent, up, normal);
          dummy.quaternion.setFromRotationMatrix(basis);
          dummy.rotateZ(random() * Math.PI * 2);
          dummy.position.set(p.x + normal.x * .25, p.y + normal.y * .25, z);
        }
        dummy.updateMatrix();
        // Bound every curl, including rotated tips, below the platform's
        // underside. This remains true when the pile supports a legless base.
        const matrix = dummy.matrix.elements;
        const tipHeight = Math.abs(matrix[2]) * .5 + Math.abs(matrix[6]) * .5 + Math.max(0, matrix[10] * .215);
        dummy.position.z = Math.min(dummy.position.z, height - 1 - tipHeight);
        const lowerTip = Math.abs(matrix[2]) * .5 + Math.abs(matrix[6]) * .5 + Math.max(0, -matrix[10] * .215);
        dummy.position.z = Math.max(dummy.position.z, lowerTip + .1);
        dummy.updateMatrix();
        chips.setMatrixAt(i, dummy.matrix);
        chips.setColorAt(i, tint.setHSL(.105 + random() * .023, .34 + random() * .16, .64 + random() * .19));
      }
      chips.receiveShadow = true;
      chips.instanceMatrix.needsUpdate = true;
      group.add(chips);
      materials.push(chips.material);
      applyOpacity();
      fitOuterEnvelope(group, bounds);
    },
    dispose() { clear(); shavingsTexture.dispose(); scene.remove(group); },
  };
}
