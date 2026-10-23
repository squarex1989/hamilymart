import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MODEL_ASSET_VERSION } from '../src/data/catalog';
import format from '../src/data/offline-model-format.json';
import { loadPart } from '../src/lib/offline-models';

type FakeScript = {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  removeCount: number;
  remove: () => void;
};
type Outcome = 'error' | 'empty' | 'throw' | 'stale' | 'success';

test('offline script failures remain retryable and never block the shared model queue', async t => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const factories: NonNullable<Window['HamilyModels']> = {};
  const outcomes = new Map<string, Outcome[]>();
  const requests: FakeScript[] = [];
  const factoryCalls = new Map<string, number>();
  const groups = new Set<THREE.Group>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { HamilyModels: factories } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag: string): FakeScript {
      assert.equal(tag, 'script');
      return { src: '', onload: null, onerror: null, removeCount: 0, remove() { this.removeCount++; } };
    },
    head: {
      appendChild(script: FakeScript) {
        requests.push(script);
        const match = /^\.\/models\/([A-Z][A-Z0-9]+)\.js\?v=planar-creased36-v4&a=[a-z0-9-]+$/.exec(script.src);
        assert.ok(match, 'the real loader must request its same-origin model script');
        const id = match[1];
        const outcome = outcomes.get(id)?.shift();
        assert.ok(outcome, `unexpected model request: ${id}`);
        queueMicrotask(() => {
          if (outcome === 'error') { script.onerror!(); return; }
          if (outcome !== 'empty') factories[id] = () => {
            factoryCalls.set(id, (factoryCalls.get(id) ?? 0) + 1);
            if (outcome === 'throw') throw new Error(`broken factory: ${id}`);
            return [{
              v: outcome === 'stale' ? 1 : format.version, name: id,
              extras: { sourcePart: `${id}_Snow`, colorKey: 'Snow' },
              p: [0, 0, 0, 1000, 0, 0, 0, 1000, 0],
              i: [0, 1, 2], n: [0, 0, 1, 0, 0, 1, 0, 0, 1],
              material: { pbrMetallicRoughness: { baseColorFactor: [1, .5, .25, 1] } },
            }];
          };
          script.onload!();
        });
        return script;
      },
    },
  } });
  t.after(() => {
    for (const group of groups) group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose());
    });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  for (const [failure, error] of [
    ['error', /缺少本地模型/], ['empty', /模型内容不完整/], ['throw', /broken factory/], ['stale', /模型格式已更新/],
  ] as const) await t.test(`${failure}: same-ID retry loads again, queued work continues, success stays cached`, async () => {
    const id = `RETRY${failure.toUpperCase()}`, nextId = `NEXT${failure.toUpperCase()}`;
    outcomes.set(id, [failure, 'success']);
    outcomes.set(nextId, ['success']);
    const first = loadPart(id);
    assert.strictEqual(loadPart(id), first, 'concurrent callers share the in-flight attempt');
    const queued = loadPart(nextId);
    await assert.rejects(first, error);
    assert.equal(factories[id], undefined, 'a failed factory cannot poison the next attempt');
    const followingGroup = await queued;
    groups.add(followingGroup);
    assert.equal(followingGroup.children.length, 1, 'the first rejection does not block a different queued model');

    const retry = loadPart(id);
    assert.notStrictEqual(retry, first, 'the rejected promise must have been evicted');
    assert.strictEqual(loadPart(id), retry, 'retry requests are also coalesced');
    const group = await retry;
    groups.add(group);
    assert.equal(group.children.length, 1);
    const mesh = group.children[0] as THREE.Mesh;
    assert.ok(mesh instanceof THREE.Mesh, 'the real parser constructs a Three.js mesh');
    mesh.geometry.computeBoundingBox();
    assert.deepEqual(mesh.geometry.boundingBox!.max.toArray(), [1, 1, 0]);
    assert.equal(mesh.geometry.index!.count, 3, 'runtime retains baked vertex indices');
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('normal').array), [0,0,1,0,0,1,0,0,1]);
    assert.equal(mesh.userData.sourcePart, `${id}_Snow`);
    assert.equal(factories[id], undefined, 'successful upload releases source data');
    assert.strictEqual(loadPart(id), retry, 'successful models retain their promise cache');
    assert.strictEqual(await loadPart(id), group, 'the already parsed group is reused');
    assert.equal(factoryCalls.get(id), failure === 'throw' || failure === 'stale' ? 2 : 1);
    assert.equal(factoryCalls.get(nextId), 1);
    assert.equal(requests.filter(script => script.src === `./models/${id}.js?v=${format.cacheRevision}&a=${MODEL_ASSET_VERSION}`).length, 2);
    assert.equal(requests.filter(script => script.src === `./models/${nextId}.js?v=${format.cacheRevision}&a=${MODEL_ASSET_VERSION}`).length, 1);
    assert.ok(requests.every(script => script.removeCount === 1), 'success and failure both clean up their script nodes');
  });
});
