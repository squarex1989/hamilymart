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
  const initial = () => ({ legHeight: 100, beddingDepth: 50,
    platforms: [{ id: 'base', x: 0, y: 0, legHeight: 100, elevation: 0, baseInsert: true, removedCovers: [], baseColors: { Snow: 'cream' } }],
    items: [{ id: 'house', productId: 'cube', parentId: 'base', x: 100, y: 100, z: 110, rotation: 0, colors: { body: 'green' }, doorSide: undefined as 'left' | 'right' | undefined }],
  });
  function runtime() {
    const objects = new THREE.Group(), created: THREE.Group[] = [], released: THREE.Object3D[] = [];
    const context = handlers(file, ['reconcileGroups'], {
      THREE, objects, disposed: false, revision: 1,
      getPlatforms: (state: ReturnType<typeof initial>) => state.platforms,
      getBaseParts: (height: number, insert: boolean, covers: string[]) => [height, insert, covers],
      getProduct: (id: string) => ({ parts: [id], origin: [0, 0, 0] }),
      getItemDisplayElevation: (state: ReturnType<typeof initial>, item: ReturnType<typeof initial>['items'][number]) => {
        let parentId = item.parentId;
        for (let parent = state.items.find(item => item.id === parentId); parent; parent = state.items.find(item => item.id === parentId)) parentId = parent.parentId;
        return parentId === 'ground' ? state.beddingDepth : state.platforms.find(platform => platform.id === parentId)!.elevation;
      },
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
    moved.items[0].x = 210; moved.items[0].rotation = 90; moved.platforms[0].elevation = 200;
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
  test(`${label}: mixed heights, ground transfers and door flips affect only their own model families`, async () => {
    const r = runtime(), state = initial();
    state.platforms.push({ ...state.platforms[0], id: 'base2', x: 300, legHeight: 200, elevation: 100 });
    state.items.push(
      { ...state.items[0], id: 'house2', parentId: 'base2', x: 400 },
      { ...state.items[0], id: 'loose', parentId: 'ground', x: 650, z: 5 },
    );
    await r.context.reconcileGroups(state, 1);
    const find = (id: string) => r.objects.children.find(group => group.userData.itemId === id)!;
    const firstPlatform = find('base'), secondPlatform = find('base2');
    const house = find('house'), secondHouse = find('house2'), loose = find('loose');
    assert.equal(firstPlatform.position.z, 0);
    assert.equal(secondPlatform.position.z, 100);
    assert.equal(house.position.z, 110);
    assert.equal(secondHouse.position.z, 210);
    assert.equal(loose.position.z, 55);
    state.platforms[0].legHeight = 300; state.platforms[0].elevation = 200;
    await r.context.reconcileGroups(state, 1);
    assert.equal(r.created.length, 6, 'only the changed leg model rebuilds');
    assert.equal(find('house'), house);
    assert.equal(house.position.z, 310);
    assert.equal(find('base2'), secondPlatform);
    assert.equal(find('house2'), secondHouse);
    assert.equal(secondHouse.position.z, 210);
    state.platforms.shift();
    state.items[0].parentId = 'ground'; state.items[0].z = 0;
    await r.context.reconcileGroups(state, 1);
    assert.equal(r.created.length, 6, 'dropping a family onto bedding reuses its geometry');
    assert.equal(find('house'), house);
    assert.equal(house.position.z, 50);
    assert.equal(find('loose'), loose);
    state.items[0].doorSide = 'left';
    let receivedDoor: unknown;
    r.context.build = async (...args: unknown[]) => { receivedDoor = args[5]; return new THREE.Group(); };
    await r.context.reconcileGroups(state, 1);
    assert.equal(receivedDoor, 'left');
    assert.notEqual(find('house'), house, 'the mirrored door requires a new local model');
    assert.equal(find('house').position.z, 50);
    assert.equal(find('house2'), secondHouse);
    assert.equal(find('loose'), loose);
    assert.ok(r.released.includes(house));
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
      THREE, camera, ray: new THREE.Raycaster(), pointer: new THREE.Vector2(), elevation: () => 50, defaultSurface: () => 'base',
      props: () => ({ state }), drag: { productId: 'cube', itemId: 'house' },
      getInteractionPlacements: () => { searches++; return [{ x: 0, y: 0, z: 0 }]; },
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
  test(`${label}: ray projection caches world surfaces while returning each parent's own local height`, () => {
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 2000);
    camera.position.set(300, 0, 1000); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const context = handlers(file, ['pointAt'], {
      THREE, camera, ray: new THREE.Raycaster(), pointer: new THREE.Vector2(),
      elevation: (id: string) => ({ base: 0, base2: 100, ground: 50 }[id]),
      defaultSurface: () => 'ground',
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }) } },
    });
    const project = context.pointAt(200, 200);
    const low = project(110, 'base'), high = project(110, 'base2');
    assert.equal(low.z, 110); assert.equal(high.z, 110);
    assert.ok(Math.abs(low.x - 33) < .00001);
    assert.ok(Math.abs(high.x - 63) < .00001, 'higher platform uses its own physical projection plane');
    const sameWorld = project(60, 'ground');
    assert.equal(sameWorld.z, 60, 'shared world plane must not reuse another parent’s local height');
    assert.equal(sameWorld.x, low.x);
  });
  test(`${label}: placement rings use each platform's world height and allow bedding targets without a platform mesh`, () => {
    const objects = new THREE.Group(), targets = new THREE.Group();
    for (const [id, x, z] of [['base', 100, 110], ['base2', 400, 210]] as const) {
      const owner = new THREE.Group(); owner.userData.itemId = id;
      const surface = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 2), new THREE.MeshBasicMaterial());
      surface.userData.modelMesh = true; surface.position.set(x, 100, z - 1);
      owner.add(surface); objects.add(owner);
    }
    objects.updateMatrixWorld(true);
    const positions = [
      { parentId: 'base', x: 100, y: 100, z: 110 },
      { parentId: 'base2', x: 400, y: 100, z: 110 },
      { parentId: 'ground', x: 700, y: 100, z: 0 },
      { parentId: 'base3', x: 1000, y: 100, z: 110 },
    ];
    const context = handlers(file, ['updateTargets', 'ring'], {
      THREE, objects, targets, disposed: false, renderError: false, drag: null, MODEL_PICK_LAYER: 1,
      isExploded: () => false, clearTargets: () => targets.clear(), invalidatePreview() {},
      props: () => ({ state: { items: [], bedding: { depth: 50 } }, selectedId: null, activeProduct: 'cube', rotation: 0 }),
      placementCandidates: () => positions, getProduct: () => ({ attachment: undefined }),
      elevation: (id: string) => ({ base: 0, base2: 100, ground: 50 }[id] ?? 0),
    });
    context.updateTargets();
    assert.equal(targets.children.length, 3, 'missing platform slots have no floating target');
    assert.deepEqual(targets.children.map(marker => [marker.userData.placement.parentId, marker.position.z]),
      [['base', 110.8], ['base2', 210.8], ['ground', 50.8]]);
  });
}
