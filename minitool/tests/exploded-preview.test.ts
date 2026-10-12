import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";
import { createExplodedLayout } from "../src/lib/exploded-view";
import { PreviewQuality } from "../src/lib/preview-quality";

test("a reduced-motion explosion repaints an already settled preview without moving the camera", () => {
  const source = ts.createSourceFile("AssemblyScene.tsx", readFileSync(new URL("../src/components/AssemblyScene.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const runtime = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createRuntime") as ts.FunctionDeclaration;
  const code = runtime.body!.statements.filter(node => ts.isFunctionDeclaration(node) && ["toggleExploded", "tickExplosion"].includes(node.name!.text))
    .map(node => node.getText(source)).join("\n");
  const objects = new THREE.Group();
  for (const [id, parts] of [["base", [["P01", 0]]], ["house", [["SHB", 40], ["SHR", 65]]]] as const) {
    const owner = new THREE.Group(); owner.userData.itemId = id;
    for (const [partId, z] of parts) {
      const part = new THREE.Group(); part.userData.partId = partId;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 20), new THREE.MeshBasicMaterial());
      mesh.position.z = z; mesh.userData.modelMesh = true;
      part.add(mesh); owner.add(part);
    }
    objects.add(owner);
  }
  const camera = new THREE.PerspectiveCamera(34, 1, 10, 4500), target = new THREE.Vector3(150, 150, 100);
  camera.position.set(400, -500, 600); camera.lookAt(target);
  const cameraBefore = [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.zoom, ...target.toArray()];
  const quality = new PreviewQuality();
  assert.equal(quality.nextFrame(500, false), "still");
  assert.equal(quality.nextFrame(600, false), "skip");
  const context = vm.createContext({
    THREE, createExplodedLayout, objects, camera, controls: { target },
    modelReady: true, disposed: false, pausedFor: null, exploded: false, explosion: null, explosionProgress: 0, explosionAnimation: null,
    performance: { now: () => 1000 }, lastExplosionToggleAt: 0,
    invalidatePreview: () => quality.invalidate(1000), cancel() {}, pressed: null, blankTaps: { reset() {} },
    reducedMotion: { matches: true }, targets: new THREE.Group(), annotations: new THREE.Group(),
    dimensionLines: { visible: false }, dimensionLabels: [], toolbar: { hidden: true },
    showSeams() {}, onExplodedChange() {}, restoreExploded() {},
  });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  context.toggleExploded();
  assert.equal(context.exploded, true);
  assert.equal(context.explosionProgress, 1);
  assert.equal(context.explosionAnimation, null, "reduced motion leaves no moving-frame flag");
  assert.equal(quality.nextFrame(1000, false), "interactive", "geometry-only changes must request a draw after an idle frame");
  assert.equal(quality.nextFrame(1250, false), "still");
  assert.equal(quality.nextFrame(1400, false), "skip", "the final crisp frame must still settle once");
  assert.deepEqual([...camera.position.toArray(), ...camera.quaternion.toArray(), camera.zoom, ...target.toArray()], cameraBefore);
  objects.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose(); (node.material as THREE.Material).dispose();
    }
  });
});
