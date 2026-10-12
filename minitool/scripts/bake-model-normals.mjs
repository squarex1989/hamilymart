/** Build-time only: preserve the old runtime shading, then reuse identical vertices.
 * No mesh simplification, material merging, or component reordering happens here.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const FORMAT = JSON.parse(readFileSync(new URL('../src/data/offline-model-format.json', import.meta.url), 'utf8'));

/** Shorten textual floats only when their Float32 value remains exactly the same. */
export function float32Literal(value) {
  if (!Number.isFinite(value)) throw new Error('Non-finite baked normal');
  if (value === 0) return 0;
  for (let precision = 1; precision <= 9; precision++) {
    const shorter = Number(value.toPrecision(precision));
    if (Math.fround(shorter) === value) return shorter;
  }
  throw new Error('Normal was not a Float32 value');
}

/** Hash the actual triangle stream; signed zero has identical render meaning. */
export function renderedStreamHash(positions, normals) {
  const hash = createHash('sha256');
  for (const source of [positions, normals]) {
    const canonical = Float32Array.from(source, value => value === 0 ? 0 : value);
    hash.update(Buffer.from(canonical.buffer));
  }
  return hash.digest('hex');
}

export function bakeMesh(source) {
  const geometry = new THREE.BufferGeometry();
  // Use the exact old loadPart input and helper, including its Float32 rounding.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.p.map(value => value / FORMAT.positionScale), 3));
  geometry.setIndex(source.i);
  const smooth = toCreasedNormals(geometry, FORMAT.creaseAngleDegrees * Math.PI / 180);
  geometry.dispose();
  try {
    const positions = smooth.getAttribute('position').array;
    const normals = smooth.getAttribute('normal').array;
    const unique = new Map();
    const p = [], n = [], i = [];
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      const offset = vertex * 3;
      // String values are exact numeric identities, including a harmless +/-0 merge.
      const key = `${positions[offset]},${positions[offset + 1]},${positions[offset + 2]}|${normals[offset]},${normals[offset + 1]},${normals[offset + 2]}`;
      let index = unique.get(key);
      if (index === undefined) {
        index = unique.size;
        unique.set(key, index);
        // Retain the compact, existing micrometre coordinates. The runtime rounds
        // these to the same Float32 values used to compute the baked normals.
        const sourceOffset = source.i[vertex] * 3;
        for (let axis = 0; axis < 3; axis++) {
          const coordinate = source.p[sourceOffset + axis];
          if (Math.fround(coordinate / FORMAT.positionScale) !== positions[offset + axis])
            throw new Error(`Position changed while baking ${source.name}`);
          p.push(coordinate);
          n.push(float32Literal(normals[offset + axis]));
        }
      }
      i.push(index);
    }
    const baked = { ...source, v: FORMAT.version, p, n, i };
    const expandedPositions = new Float32Array(i.length * 3);
    const expandedNormals = new Float32Array(i.length * 3);
    for (let vertex = 0; vertex < i.length; vertex++) for (let axis = 0; axis < 3; axis++) {
      expandedPositions[vertex * 3 + axis] = p[i[vertex] * 3 + axis] / FORMAT.positionScale;
      expandedNormals[vertex * 3 + axis] = n[i[vertex] * 3 + axis];
    }
    const referenceSha256 = renderedStreamHash(positions, normals);
    if (renderedStreamHash(expandedPositions, expandedNormals) !== referenceSha256)
      throw new Error(`Baked shading changed for ${source.name}`);
    const indexBytes = unique.size > 65535 ? 4 : 2;
    return {
      mesh: baked,
      report: {
        name: source.name,
        triangles: i.length / 3,
        previousRenderVertices: positions.length / 3,
        renderVertices: unique.size,
        previousGeometryBytes: positions.byteLength + normals.byteLength,
        geometryBytes: (p.length + n.length) * 4 + i.length * indexBytes,
        indexBytes,
        renderedStreamSha256: referenceSha256,
      },
    };
  } finally { smooth.dispose(); }
}

export function bakeModels(models) {
  return Object.fromEntries(Object.entries(models).map(([id, meshes]) => {
    const baked = meshes.map(bakeMesh);
    return [id, { meshes: baked.map(value => value.mesh), reports: baked.map(value => value.report) }];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const models = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(bakeModels(models)));
}
