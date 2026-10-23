import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { getSelectionToolbarPosition, applySceneViewport } from "../src/lib/scene-framing";
import { updateSelectionMetadata } from "../src/lib/scene-selection";
import { createExplodedLayout } from "../src/lib/exploded-view";
import { getBaseParts, getProduct } from "../src/data/catalog";
import { addPlatform, createInitialState, getPlatforms, removePlatform, setBedding, setLegHeight } from "../src/lib/assembly";

// Execute the actual runtime handlers with lightweight renderer/DOM boundaries.
// This catches unwanted camera resets in edit/async/explosion lifecycle paths
// without requiring a WebGL context in the Node test runner.
const source = ts.createSourceFile("AssemblyScene.tsx", readFileSync(new URL("../src/components/AssemblyScene.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const runtime = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createRuntime") as ts.FunctionDeclaration;
function handlers(names: string[], bindings: Record<string, unknown>) {
  const declarations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name!.text)) declarations.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(runtime.body!);
  const code = declarations.join("\n");
  const context = vm.createContext(bindings);
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInContext(output, context);
  return context;
}
function cameraState(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  return [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.zoom, camera.fov, ...target.toArray()];
}
function part(id: string) {
  const group = new THREE.Group(); group.userData.partId = id;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 10), new THREE.MeshBasicMaterial());
  mesh.userData.modelMesh = true; group.add(mesh);
  if (/^H0[1-5]$/.test(id)) {
    const seam = new THREE.Mesh(new THREE.RingGeometry(14, 15), new THREE.MeshBasicMaterial());
    seam.userData.selectionSeam = true; group.add(seam);
  }
  return group;
}
function owner(id: string, ids = ["P01", "H01", "H02", "H06", "B01"]) {
  const group = new THREE.Group(); group.userData.itemId = id;
  group.add(...ids.map(part)); return group;
}

test("selecting platforms, covers and pools updates hit IDs without replacing model geometry or materials", () => {
  const objects = new THREE.Group(), base = owner("base"), second = owner("base2"), fourth = owner("base4"), house = owner("house", ["SHB", "SHR"]);
  objects.add(base, second, fourth, house);
  const identities: Array<[THREE.Mesh, THREE.BufferGeometry, THREE.Material | THREE.Material[], number[]]> = [];
  objects.traverse(node => { if (node instanceof THREE.Mesh) identities.push([node, node.geometry, node.material, node.position.toArray()]); });
  for (const selected of ["base", "cover:base:H01", "base2", "base4", "cover:base4:H01", "pool:base4", "pool:base", "house", null]) {
    updateSelectionMetadata(objects, selected);
    for (const group of [base, second, fourth]) {
      const id = group.userData.itemId;
      const editing = selected === id || !!selected?.startsWith(`cover:${id}:`);
      assert.equal(group.children[1].userData.selectionId, editing ? `cover:${id}:H01` : id);
      assert.equal(group.children[1].children[1].visible, editing);
      assert.equal(group.children[3].userData.selectionId, id, "fixed H06 stays part of its platform");
      assert.equal(group.children[4].userData.selectionId, `pool:${id}`);
    }
    assert.equal(house.children[0].userData.selectionId, "house");
    identities.forEach(([mesh, geometry, material, position]) => {
      assert.equal(objects.getObjectById(mesh.id), mesh);
      assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
      assert.deepEqual(mesh.position.toArray(), position);
    });
  }
  updateSelectionMetadata(objects, "base", true);
  assert.equal(base.children[1].children[1].visible, false);
  assert.equal(base.children[1].children[1].userData.selectionSeamActive, true);
});

test("offscreen selection toolbars clamp to the canvas while camera pose and zoom remain unchanged", () => {
  for (const [width, height] of [[960, 720], [390, 410], [320, 268]]) {
    const camera = new THREE.PerspectiveCamera(34, width / height, 10, 4500);
    const target = new THREE.Vector3(150, 150, 130);
    camera.up.set(0, 0, 1); camera.position.set(500, -480, 360); camera.lookAt(target);
    camera.zoom = 1.7; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const before = cameraState(camera, target);
    for (const center of [new THREE.Vector3(150, 150, 130), new THREE.Vector3(0, 0, 1000), new THREE.Vector3(0, 0, -1000)]) {
      const bounds = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(300, 300, 200));
      const position = getSelectionToolbarPosition(bounds, camera, width, height, 180, 52);
      assert(position.x >= 98 && position.x <= width - 98);
      assert(position.y >= 8 && position.y + 52 <= height - 64);
      assert.deepEqual(cameraState(camera, target), before);
    }
    for (const [w, h, inset] of [[height, width, 50], [width, height, 80]]) {
      applySceneViewport(camera, w, h, inset);
      assert.deepEqual(cameraState(camera, target), before, "resize only changes projection");
    }
  }
});

test("design updates preserve the view unless an explicit reset requests reframing before model loading", async () => {
  let state = createInitialState(), viewResetKey = 0;
  const resets: typeof state[] = [];
  const pending: Array<(group: THREE.Group) => void> = [];
  let delay = false;
  const context = handlers(["update"], {
    props: () => ({ state, viewResetKey }), connectionView: { saved: true }, revision: 0, disposed: false, renderError: false, modelReady: true, lastViewResetKey: 0,
    restoreExploded() {}, bedding: { update() {} }, cagePreview: { update() {} }, home: () => resets.push(state),
    objects: new THREE.Group(), release() {}, getPlatforms, getBaseParts, getProduct,
    reconcileGroups: () => delay ? new Promise<THREE.Group>(resolve => pending.push(resolve)) : Promise.resolve(new THREE.Group()),
    elevation: () => 0, hamster: null, sceneCenter: () => new THREE.Vector3(),
    lighting: { centerAt() {} }, modelBatches: { rebuild() {} }, invalidateShadows() {}, ready() {}, updateSelection() {}, console,
    stopForError: (message: string) => assert.fail(message),
  });
  await context.update();
  const platform = addPlatform(state); assert(platform.ok); state = platform.state;
  await context.update();
  const bedding = setBedding(state, { mode: "thick", depth: 300 }); assert(bedding.ok); state = bedding.state;
  await context.update();
  state = { ...state, baseColors: { ...state.baseColors, P01: "rose" } };
  await context.update();
  const height = setLegHeight(state, 200, "base2"); assert(height.ok); state = height.state;
  await context.update();
  const removed = removePlatform(state, "base"); assert(removed.ok); state = removed.state;
  await context.update();
  assert.equal(resets.length, 0, "state changes, including undoing layout changes, do not reset the view by themselves");
  assert.deepEqual(context.connectionView, { saved: true }, "ordinary edits retain the editor return view");
  delay = true; viewResetKey++;
  const imported = state;
  const importing = context.update();
  assert.deepEqual(resets, [imported], "reset uses the new state without waiting for model I/O");
  assert.equal(context.connectionView, null, "a stale cover-editor view must not overwrite an explicit reframe");
  pending.splice(0).forEach(resolve => resolve(new THREE.Group()));
  await importing;
  delay = false;
  await context.update();
  assert.equal(resets.length, 1, "late loading or repeated update cannot reset again");
  state = createInitialState(); viewResetKey++;
  await context.update();
  assert.deepEqual(resets, [imported, state]);
});

for (const appPath of ["../src/App.tsx", "../minitool/src/App.tsx"]) {
  test(`${appPath}: clearing selection exits the cover editor while edits to its own covers retain it`, () => {
    const appSource = ts.createSourceFile(appPath, readFileSync(new URL(appPath, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler: ts.FunctionDeclaration | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "select") handler = node;
      ts.forEachChild(node, visit);
    };
    visit(appSource);
    assert(handler);
    for (const id of ["base4", "cover:base4:H01", "base", "house", null]) {
      let editing: string | null = "base4";
      const context = vm.createContext({
        connectionPlatform: editing, state: { items: [] },
        setConnectionPlatform: (value: string | null) => { editing = value; },
        setSelectedId() {}, setActiveProduct() {}, setRotation() {},
      });
      vm.runInContext(ts.transpileModule(handler.getText(appSource), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }).outputText, context);
      context.select(id);
      assert.equal(editing, id === "base4" || id === "cover:base4:H01" ? "base4" : null);
    }
  });
  test(`${appPath}: adding a platform requests exactly one reframe only when the addition succeeds`, () => {
    const appSource = ts.createSourceFile(appPath, readFileSync(new URL(appPath, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler: ts.FunctionDeclaration | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "addNextPlatform") handler = node;
      ts.forEachChild(node, visit);
    };
    visit(appSource);
    assert(handler, "app exposes its platform action");
    let current = createInitialState(), resetKey = 8, renderedPlatforms = getPlatforms(current);
    const selections: string[] = [], notices: string[] = [];
    const context = vm.createContext({
      get state() { return current; }, get platforms() { return renderedPlatforms; }, styleIndex: 0, addPlatform, getPlatforms,
      colorNewAdditions: (_old: unknown, next: typeof current) => next,
      commit: (next: typeof current) => { current = next; },
      setViewResetKey: (update: (value: number) => number) => { resetKey = update(resetKey); },
      select: (id: string) => selections.push(id), notify: (message: string) => notices.push(message),
    });
    vm.runInContext(ts.transpileModule(handler.getText(appSource), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText, context);
    const runAdd = () => { renderedPlatforms = getPlatforms(current); context.addNextPlatform(); };
    runAdd();
    assert.equal(getPlatforms(current).length, 2);
    assert.equal(resetKey, 9);
    assert.equal(selections.at(-1), "base2");
    runAdd();
    assert.equal(getPlatforms(current).length, 3);
    assert.equal(resetKey, 10);
    assert.equal(selections.at(-1), "base3");
    runAdd();
    assert.equal(getPlatforms(current).length, 4);
    assert.equal(resetKey, 11);
    assert.equal(selections.at(-1), "base4");
    const full = current;
    runAdd();
    assert.equal(current, full);
    assert.equal(resetKey, 11, "rejected fifth platform keeps the current camera");
    assert.equal(selections.length, 3);
    assert.equal(notices.length, 1);
    const withoutSecond = removePlatform(current, "base2"); assert(withoutSecond.ok); current = withoutSecond.state;
    runAdd();
    assert.equal(selections.at(-1), "base2", "refilling a middle slot selects the new platform, not the rightmost existing platform");
    assert.equal(resetKey, 12);
    const withoutBase = removePlatform(current, "base"); assert(withoutBase.ok); current = withoutBase.state;
    runAdd();
    assert.equal(selections.at(-1), "base");
    assert.equal(resetKey, 13, "restoring the base also requests one explicit reframe");
  });
}

test("explode, reverse and edit restoration preserve the current camera including gestures made while exploded", () => {
  const camera = new THREE.PerspectiveCamera(34, 1, 10, 4500), target = new THREE.Vector3(100, 80, 90);
  camera.position.set(400, -500, 600); camera.lookAt(target); camera.zoom = 1.3;
  const objects = new THREE.Group(), base = owner("base", ["P01"]), house = owner("house", ["SHB", "SHR"]);
  house.children[1].position.z = 25; objects.add(base, house);
  const context = handlers(["restoreExploded", "toggleExploded", "tickExplosion"], {
    THREE, createExplodedLayout, objects, camera, controls: { target, maxDistance: 4000 },
    modelReady: true, disposed: false, renderError: false, contextUnavailable: false, exploded: false, explosion: null, explosionAnimation: null, explosionProgress: 0,
    performance: { now: () => 1000 }, lastExplosionToggleAt: 0, cancel() {}, pressed: null, blankTaps: { reset() {} },
    reducedMotion: { matches: true }, targets: new THREE.Group(), annotations: new THREE.Group(), dimensionLines: { visible: false },
    modelBatches: { refresh() {} }, invalidateShadows() {}, dimensionLabels: [], toolbar: { hidden: true }, showSeams() {}, onExplodedChange() {}, updateTargets() {}, updateAnnotations() {},
  });
  const original = cameraState(camera, target);
  context.toggleExploded();
  assert(context.exploded); assert.deepEqual(cameraState(camera, target), original);
  // This manual gesture must survive both the reverse animation and edit-triggered restoration.
  camera.position.add(new THREE.Vector3(45, 50, -20)); target.addScalar(15); camera.lookAt(target); camera.zoom = 1.8;
  const changed = cameraState(camera, target);
  context.toggleExploded();
  assert.equal(context.exploded, false); assert.deepEqual(cameraState(camera, target), changed);
  context.toggleExploded(); context.restoreExploded(false);
  assert.deepEqual(cameraState(camera, target), changed);
});
