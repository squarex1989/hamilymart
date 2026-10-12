import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

// Execute both production runtime implementations with real Three object graphs.
// Loading is controlled to exercise late resolutions without a browser or GPU.
function handlers(file: string, names: string[], bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) code.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(code.length, names.length);
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(code.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}
for (const file of ['../src/components/AssemblyScene.tsx', '../minitool/src/components/AssemblyScene.tsx']) {
  const label = file.includes('minitool') ? 'mini' : 'web';
  const initial = () => ({ legHeight: 100, elevation: 0,
    platforms: [{ id: 'base', x: 0, y: 0, baseInsert: true, removedCovers: [], baseColors: { Snow: 'cream' } }],
    items: [{ id: 'house', productId: 'cube', x: 100, y: 100, z: 110, rotation: 0, colors: { body: 'green' } }],
  });
  function runtime() {
    const objects = new THREE.Group(), created: THREE.Group[] = [], released: THREE.Object3D[] = [];
    const context = handlers(file, ['reconcileGroups'], {
      THREE, objects, disposed: false, revision: 1,
      getPlatforms: (state: ReturnType<typeof initial>) => state.platforms,
      getBaseParts: (height: number, insert: boolean, covers: string[]) => [height, insert, covers],
      getProduct: (id: string) => ({ parts: [id], origin: [0, 0, 0] }),
      getDisplayElevation: (state: ReturnType<typeof initial>) => state.elevation,
      build: async () => { const group = new THREE.Group(); created.push(group); return group; },
      release: (group: THREE.Object3D) => { assert(!released.includes(group), 'resources must not be released twice'); released.push(group); },
    });
    return { context, objects, created, released };
  }
  test(`${label}: translations/elevation reuse objects; color and cover changes replace only their owner`, async () => {
    const r = runtime(), state = initial();
    await r.context.reconcileGroups(state, 1);
    const [platform, house] = r.objects.children;
    const moved = structuredClone(state);
    moved.items[0].x = 210; moved.items[0].rotation = 90; moved.elevation = 200;
    await r.context.reconcileGroups(moved, 1);
    assert.equal(r.created.length, 2);
    assert.deepEqual(house.position.toArray(), [210, 100, 310]);
    assert.equal(house.rotation.z, Math.PI / 2);
    assert.equal(platform.position.z, 200);
    moved.items[0].colors.body = 'blue';
    await r.context.reconcileGroups(moved, 1);
    assert.equal(r.created.length, 3);
    assert(r.objects.children.includes(platform));
    assert.deepEqual(r.released, [house]);
    const replacement = r.objects.children.find(group => group.userData.itemId === 'house')!;
    moved.platforms[0].baseInsert = false;
    await r.context.reconcileGroups(moved, 1);
    assert.equal(r.created.length, 4);
    assert(r.objects.children.includes(replacement));
    assert.deepEqual(r.released, [house, platform]);
    moved.items = [];
    await r.context.reconcileGroups(moved, 1);
    assert.equal(r.objects.children.length, 1);
    assert.equal(r.released.at(-1), replacement);
  });
  test(`${label}: stale or failed loads preserve committed models and release late replacements`, async () => {
    const r = runtime(), state = initial();
    await r.context.reconcileGroups(state, 1);
    const committed = [...r.objects.children];
    const changed = structuredClone(state); changed.items[0].colors.body = 'red';
    let finish!: (value: THREE.Group) => void;
    r.context.build = () => new Promise(resolve => { finish = resolve; });
    const pending = r.context.reconcileGroups(changed, 1);
    r.context.revision = 2;
    const late = new THREE.Group(); finish(late);
    assert.equal(await pending, false);
    assert.deepEqual(r.objects.children, committed);
    assert.deepEqual(r.released, [late]);
    r.context.build = async () => { throw new Error('failed resource'); };
    await assert.rejects(r.context.reconcileGroups(changed, 2), /failed resource/);
    assert.deepEqual(r.objects.children, committed);
    assert.equal(r.released.length, 1);
  });
  test(`${label}: drag candidates invalidate with design/rotation and ray projection reads layout once`, () => {
    let state = {}, searches = 0, reads = 0;
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 2000);
    camera.position.set(0, 0, 1000); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const context = handlers(file, ['placementCandidates', 'pointAt'], {
      THREE, camera, ray: new THREE.Raycaster(), pointer: new THREE.Vector2(), elevation: () => 50,
      props: () => ({ state }), drag: { productId: 'cube', itemId: 'house' },
      getPlacements: () => { searches++; return [{ x: 0, y: 0, z: 0 }]; },
      renderer: { domElement: { getBoundingClientRect: () => {
        reads++; return { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 };
      } } },
    });
    const first = context.placementCandidates('cube', 0, 'house');
    assert.equal(context.placementCandidates('cube', 0, 'house'), first);
    assert.equal(searches, 1);
    context.placementCandidates('cube', 90, 'house'); state = {};
    context.placementCandidates('cube', 90, 'house'); assert.equal(searches, 3);
    const project = context.pointAt(200, 200);
    for (const z of [0, 0, 100, 100, 200]) {
      const point = project(z); assert.equal(point.x, 0); assert.equal(point.y, 0); assert.equal(point.z, z);
    }
    assert.equal(reads, 1);
    assert.equal(context.pointAt(-1, 0)(100), null);
  });
}
