import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import bundles from '../src/data/model-bundles.json';
import { loadPart } from '../src/lib/offline-models';

test('companion models share one script while preserving every original mesh and releasing factories', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const browser = { HamilyModels: {} as NonNullable<Window['HamilyModels']> };
  const requests: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ src: '', remove() {} }),
    head: { appendChild(script: { src: string; onload: () => void }) {
      const name = /\/([A-Z0-9]+)\.js/.exec(script.src)![1];
      requests.push(name);
      const source = Object.entries(bundles).filter(([, bundle]) => bundle === name)
        .map(([id]) => readFileSync(new URL(`../generated/models/${id}.js`, import.meta.url), 'utf8')).join('\n');
      vm.runInNewContext(source, { window: browser });
      queueMicrotask(() => script.onload());
    } },
  } });
  try {
    const ids = Object.keys(bundles);
    const groups = await Promise.all(ids.map(loadPart));
    assert.deepEqual(requests, ['LEGS10', 'LEGS20', 'LEGS30']);
    for (let i = 0; i < ids.length; i++) {
      const original = { window: { HamilyModels: {} as NonNullable<Window['HamilyModels']> } };
      vm.runInNewContext(readFileSync(new URL(`../generated/models/${ids[i]}.js`, import.meta.url), 'utf8'), original);
      const meshes = original.window.HamilyModels[ids[i]]();
      assert.equal(groups[i].children.length, meshes.length);
      groups[i].children.forEach((node, j) => {
        const mesh = node as THREE.Mesh;
        assert.deepEqual(Array.from(mesh.geometry.index!.array), Array.from(meshes[j].i));
        assert.equal(mesh.geometry.getAttribute('position').count, meshes[j].p.length / 3);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
    assert.deepEqual(Object.keys(browser.HamilyModels), []);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
