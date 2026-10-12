import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { captureSceneView, restoreSceneView } from "../src/lib/scene-recovery";
import { BeddingFade } from "../src/lib/bedding-fade";

const source = ts.createSourceFile("AssemblyScene.tsx", readFileSync(new URL("../src/components/AssemblyScene.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handlers(names: string[], bindings: Record<string, unknown>) {
  const code: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) code.push(node.getText(source));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) code.push(`var ${node.getText(source)};`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(code.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return context;
}

test("retry restores an independent camera snapshot including its already consumed reset key", () => {
  const camera = new THREE.PerspectiveCamera(34, .8, 10, 4500), target = new THREE.Vector3(300, 80, 190);
  camera.up.set(0, 0, 1); camera.position.set(620, -530, 810); camera.lookAt(target); camera.zoom = 1.6;
  const view = captureSceneView(camera, target, 7);
  const expected = structuredClone(view);
  camera.position.set(0, 0, 0); camera.quaternion.identity(); target.set(0, 0, 0); camera.zoom = 1;
  assert.deepEqual(view, expected, "disposal or later mutations cannot change the saved pose");
  const replacement = new THREE.PerspectiveCamera(34, 1.2, 10, 4500), nextTarget = new THREE.Vector3();
  restoreSceneView(replacement, nextTarget, view);
  assert.deepEqual(captureSceneView(replacement, nextTarget, view.consumedViewResetKey), expected);
  assert.equal(replacement.aspect, 1.2, "retry still uses the current viewport");
});

test("a rejected GLB request is removed from cache, while successful retries stay shared", async () => {
  let calls = 0;
  const scene = new THREE.Group(), cache = new Map<string, Promise<THREE.Group>>();
  const context = handlers(["loadPart"], {
    cache, index: { P01: { url: "/models/P01.glb" } }, MODEL_ASSET_VERSION: "test",
    loader: { loadAsync: () => ++calls === 1 ? Promise.reject(new Error("network failed")) : Promise.resolve({ scene }) },
  });
  const first = context.loadPart("P01");
  assert.equal(context.loadPart("P01"), first);
  await assert.rejects(first, /network failed/);
  assert.equal(cache.has("P01"), false);
  assert.equal(await context.loadPart("P01"), scene);
  assert.equal(await context.loadPart("P01"), scene);
  assert.equal(calls, 2, "retry performs a real new request and then reuses success");
});

test("a current ghost load failure pauses 3D for retry, while a canceled request stays silent", async () => {
  const failures: string[] = [], pending: Array<(error: Error) => void> = [];
  const context = handlers(["startDrag"], {
    disposed: false, renderError: false, contextUnavailable: false, drag: null,
    restoreExploded() {}, blankTaps: { reset() {} }, controls: { enabled: true }, updateTargets() {},
    makeGhost: () => new Promise((_, reject) => pending.push(reject)),
    stopForError: (message: string) => failures.push(message),
  });
  context.startDrag("cube-house", 10, 20);
  context.drag = null; // Released/canceled before the resource request completed.
  pending.shift()!(new Error("canceled request failed"));
  await Promise.resolve();
  assert.equal(failures.length, 0);
  context.startDrag("cube-house", 10, 20);
  pending.shift()!(new Error("current request failed"));
  await Promise.resolve();
  assert.equal(failures.length, 1);
  assert.match(failures[0], /重新加载3D/);
});

function recoveryRuntime() {
  const camera = new THREE.PerspectiveCamera(34, 1, 10, 4500), target = new THREE.Vector3(130, 150, 60);
  camera.position.set(480, -520, 700); camera.lookAt(target);
  const errors: string[] = [], scheduled: unknown[] = [], canceled: number[] = [];
  let renders = 0, readyCalls = 0;
  const context = handlers(["pauseScene", "stopForError", "contextLost", "contextRestored", "draw"], {
    disposed: false, renderError: false, contextUnavailable: false, notifiedReady: true, modelReady: true, frame: 17,
    camera, controls: { target, enabled: true, update() {}, getPolarAngle: () => 0 },
    scene: new THREE.Scene(), document: { hidden: false }, host: { clientWidth: 390, clientHeight: 420 },
    renderer: { setSize() {}, render() { renders++; } }, invalidateShadows() {},
    clock: { getDelta: () => 0 }, updateViewportFraming() {}, cancel() {},
    blankTaps: { reset() {} }, pressed: {}, touchPointers: new Set([1]),
    toolbar: { hidden: false }, dimensionLabels: [{ hidden: false }], fail: (message: string) => errors.push(message),
    cancelAnimationFrame: (id: number) => canceled.push(id), requestAnimationFrame: (callback: unknown) => { scheduled.push(callback); return 18; },
    performance: { now: () => 1000 }, tickExplosion() {}, layoutAnnotations() {}, isExploded: () => false,
    bedding: { setVisible() {}, setOpacity: () => false }, beddingFade: new BeddingFade(), lastBeddingVisible: true, drag: null,
    floor: { visible: true }, grid: { visible: true }, lighting: { underside: { visible: false } },
    hamster: null, ready: () => { readyCalls++; }, console: { error() {} },
  });
  return { context, camera, target, errors, scheduled, canceled, renders: () => renders, ready: () => readyCalls };
}

test("context loss pauses 3D and auto-restoration only becomes ready after a successful frame", () => {
  const r = recoveryRuntime(), before = captureSceneView(r.camera, r.target, 5);
  let prevented = false;
  r.context.contextLost({ preventDefault() { prevented = true; } });
  assert(prevented); assert.equal(r.context.contextUnavailable, true);
  assert.equal(r.context.controls.enabled, false); assert(r.canceled.includes(17));
  r.context.draw(); assert.equal(r.renders(), 0);
  r.context.contextRestored();
  assert.equal(r.context.contextUnavailable, false); assert.equal(r.context.controls.enabled, true);
  assert.equal(r.scheduled.length, 1); assert.equal(r.ready(), 0, "the restore event alone must not clear the error UI");
  r.context.draw();
  assert.equal(r.context.renderError, false, "the restored frame must not encounter a runtime error");
  assert.equal(r.renders(), 1); assert.equal(r.ready(), 1);
  assert.deepEqual(captureSceneView(r.camera, r.target, 5), before);
});

test("context restoration cannot clear independent fatal errors, and failed frames never report ready", () => {
  const r = recoveryRuntime();
  r.context.notifiedReady = false;
  r.context.renderer.render = () => { throw new Error("GPU failure"); };
  r.context.draw();
  assert.equal(r.context.renderError, true); assert.equal(r.ready(), 0); assert.equal(r.scheduled.length, 0);
  assert.equal(r.errors.length, 1);
  r.context.contextLost({ preventDefault() {} });
  r.context.contextRestored();
  assert.equal(r.context.renderError, true); assert.equal(r.context.controls.enabled, false);
  assert.equal(r.errors.length, 1); assert.equal(r.ready(), 0); assert.equal(r.scheduled.length, 0);
  r.context.disposed = true;
  r.context.contextRestored(); r.context.draw();
  assert.equal(r.ready(), 0, "callbacks from a disposed runtime stay silent");
});
