import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import * as webFade from "../src/lib/bedding-fade";
import * as miniFade from "../minitool/src/lib/bedding-fade";
import { createBedding as createWebBedding } from "../src/lib/bedding-scene";
import { createBedding as createMiniBedding } from "../minitool/src/lib/bedding-scene";
import { createInitialState, setBedding } from "../src/lib/assembly";
import { PreviewQuality } from "../minitool/src/lib/preview-quality";

const context = new Proxy({}, { get: () => () => undefined, set: () => true });
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
} });

for (const [runtime, fade, createBedding] of [
  ["web", webFade, createWebBedding], ["mini", miniFade, createMiniBedding],
] as const) {
  test(`${runtime}: bedding stays opaque above, then fades with angle to a 20% floor`, () => {
    assert.equal(fade.beddingOpacityForAngle(0), 1);
    assert.equal(fade.beddingOpacityForAngle(Math.PI / 2), 1);
    assert(Math.abs(fade.beddingOpacityForAngle(Math.PI * 97.5 / 180) - .6) < 1e-10);
    assert.equal(fade.beddingOpacityForAngle(Math.PI), .2);
    let previous = 1;
    for (let degree = 0; degree <= 180; degree++) {
      const opacity = fade.beddingOpacityForAngle(degree * Math.PI / 180);
      assert(opacity >= .2 && opacity <= previous);
      previous = opacity;
    }
  });

  test(`${runtime}: a camera flip fades gradually, reverses continuously and settles`, () => {
    const animation = new fade.BeddingFade();
    assert.deepEqual(animation.step(0, 0), { opacity: 1, changed: false, active: false });
    const first = animation.step(Math.PI, 16);
    assert(first.opacity < 1 && first.opacity > .9);
    let middle = first;
    for (let time = 32; time <= 208; time += 16) middle = animation.step(Math.PI, time);
    assert(middle.opacity > .2 && middle.opacity < .7);
    const reversed = animation.step(0, 224);
    assert(reversed.opacity > middle.opacity && reversed.opacity < 1);
    for (let time = 240; time <= 704; time += 16) animation.step(0, time);
    assert.deepEqual(animation.step(0, 720), { opacity: 1, changed: false, active: false });
    let current = reversed;
    for (let time = 736; time <= 1248; time += 16) current = animation.step(Math.PI, time);
    assert.equal(current.opacity, .2);
    assert.deepEqual(animation.step(Math.PI, 1264), { opacity: .2, changed: false, active: false });
  });

  test(`${runtime}: fade duration is independent of frame rate and a resumed tab cannot snap`, () => {
    const sample = (step: number) => {
      const animation = new fade.BeddingFade();
      animation.step(Math.PI, 0);
      for (let time = step; time <= 200; time += step) animation.step(Math.PI, time);
      return animation.step(Math.PI, 200).opacity;
    };
    assert(Math.abs(sample(10) - sample(20)) < 1e-12);
    const animation = new fade.BeddingFade();
    animation.step(0, 0);
    assert(animation.step(Math.PI, 60000).opacity > .8);
  });

  test(`${runtime}: translucency preserves meshes, enables blending without depth writes, and restores materials`, () => {
    const result = setBedding(createInitialState(), { mode: "thin", depth: 50 });
    assert(result.ok);
    const scene = new THREE.Scene(), bedding = createBedding(scene);
    bedding.update(result.state);
    const group = scene.children[0];
    const meshes = group.children as THREE.Mesh[];
    const geometries = meshes.map(mesh => mesh.geometry);
    const materials = meshes.map(mesh => mesh.material as THREE.Material);
    assert.equal(new Set(materials).size, materials.length, "all surfaces own their materials");
    assert.equal(bedding.setOpacity(.6), true, "only entering transparency invalidates shadows");
    assert.equal(bedding.setOpacity(.2), false);
    assert.equal(group.visible, true);
    assert.deepEqual(meshes.map(mesh => mesh.geometry), geometries);
    assert(meshes.every(mesh => mesh.visible), "curled chips remain present as well");
    for (const material of materials) {
      assert.equal(material.opacity, .2);
      assert.equal(material.transparent, true);
      assert.equal(material.depthWrite, false);
      assert.equal(material.forceSinglePass, true);
    }
    assert(meshes.every(mesh => !mesh.castShadow), "faint bedding cannot cast an opaque shadow");
    assert.equal(bedding.setOpacity(.1), false, "cannot fade below the 20% floor");
    assert.equal(bedding.setOpacity(1), true, "restoring opacity refreshes cached shadows once");
    for (const material of materials) {
      assert.equal(material.opacity, 1);
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
      assert.equal(material.forceSinglePass, false);
    }
    assert(meshes.filter(mesh => !(mesh instanceof THREE.InstancedMesh)).every(mesh => mesh.castShadow));
    assert.equal(bedding.setOpacity(1), false);
    bedding.setOpacity(.2);
    const taller = setBedding(result.state, { mode: "thick", depth: 100 });
    assert(taller.ok);
    bedding.update(taller.state);
    for (const mesh of group.children as THREE.Mesh[]) {
      const material = mesh.material as THREE.Material;
      assert.equal(material.opacity, .2, "rebuilt geometry keeps the active underside opacity");
      assert.equal(material.transparent, true);
    }
    bedding.dispose();
    assert.equal(scene.children.length, 0);
  });
}


test("mini opacity tail finishes at high resolution, then on-demand drawing stops", () => {
  const fade = new miniFade.BeddingFade(), quality = new PreviewQuality();
  quality.gestureEnded(0);
  fade.step(0, 0);
  let finalDrawnOpacity = 1;
  const frames: Array<{ time: number; kind: string; opacity: number }> = [];
  for (let time = 16; time <= 1200; time += 16) {
    const fading = fade.step(Math.PI, time);
    if (fading.changed) quality.cameraChanged(time);
    const kind = quality.nextFrame(time, false);
    if (kind !== "skip") {
      finalDrawnOpacity = fading.opacity;
      frames.push({ time, kind, opacity: fading.opacity });
    }
  }
  assert.equal(finalDrawnOpacity, .2, "the final opacity frame cannot be skipped");
  assert(frames.some(frame => frame.time >= 400 && frame.kind === "still"));
  assert.equal(frames[frames.length - 1].kind, "still");
  assert(frames[frames.length - 1].time <= 432, "settled fade no longer requests frames");
  assert.equal(quality.nextFrame(1201, false), "skip");
});
