import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseBurrow,
  connectWalkSurfaceSamples,
  findHamsterPath,
} from "../src/lib/hamster-scene";
import type { HamsterNavNode, HamsterWalkSample } from "../src/lib/hamster-scene";

function sample(x: number, y: number, z: number, region = "platform"): HamsterWalkSample {
  return { point: [x, y, z], region };
}

const clear = () => true;

function assertTraversablePath(nodes: HamsterNavNode[], path: number[], from: number, to: number) {
  assert.equal(path[0], from);
  assert.equal(path.at(-1), to);
  for (let index = 1; index < path.length; index++) {
    assert.ok(nodes[path[index - 1]].links.includes(path[index]), "every path segment must be a navigation edge");
  }
}

test("navigation connects neighboring samples without jumping across a missing strip of platform", () => {
  const samples = [sample(0, 0, 110), sample(12, 0, 110), sample(36, 0, 110), sample(48, 0, 110)];
  const before = structuredClone(samples);
  const nodes = connectWalkSurfaceSamples(samples, 12, clear);

  assert.deepEqual(findHamsterPath(nodes, 0, 1), [0, 1]);
  assert.deepEqual(findHamsterPath(nodes, 2, 3), [2, 3]);
  assert.deepEqual(findHamsterPath(nodes, 0, 3), []);
  assert.ok(!nodes[1].links.includes(2), "a 24 mm gap cannot be crossed by a 12 mm grid edge");
  assert.deepEqual(samples, before, "building navigation must preserve source samples");
});

test("a roof 90 mm above the floor cannot be reached directly, even when the XY positions coincide", () => {
  const nodes = connectWalkSurfaceSamples([
    sample(0, 0, 110, "floor"),
    sample(12, 0, 110, "floor"),
    sample(0, 0, 200, "roof"),
    sample(12, 0, 200, "roof"),
  ], 12, clear);

  assert.deepEqual(findHamsterPath(nodes, 0, 1), [0, 1]);
  assert.deepEqual(findHamsterPath(nodes, 2, 3), [2, 3]);
  assert.deepEqual(findHamsterPath(nodes, 0, 2), []);
  assert.deepEqual(findHamsterPath(nodes, 1, 3), []);
});

test("continuous stairs connect differently labeled surfaces and can be traversed in both directions", () => {
  const samples = Array.from({ length: 11 }, (_, index) =>
    sample(index * 12, 0, 110 + index * 9, index === 0 ? "floor" : index === 10 ? "roof" : "stairs"),
  );
  const nodes = connectWalkSurfaceSamples(samples, 12, clear);
  const expected = samples.map((_, index) => index);

  assert.deepEqual(findHamsterPath(nodes, 0, 10), expected);
  assert.deepEqual(findHamsterPath(nodes, 10, 0), [...expected].reverse());
  assertTraversablePath(nodes, findHamsterPath(nodes, 0, 10), 0, 10);
  assert.ok(nodes[0].links.includes(1), "the floor/stair region boundary is traversable");
  assert.ok(nodes[9].links.includes(10), "the stair/roof region boundary is traversable");
});

test("single-step rise is limited by grid spacing and by the 14 mm ceiling", () => {
  for (const spacing of [12, 14, 24]) {
    const allowedRise = Math.min(14, spacing * 0.8);
    const atLimit = connectWalkSurfaceSamples([sample(0, 0, 0), sample(spacing, 0, allowedRise)], spacing, clear);
    const tooHigh = connectWalkSurfaceSamples([sample(0, 0, 0), sample(spacing, 0, allowedRise + 0.01)], spacing, clear);

    assert.deepEqual(findHamsterPath(atLimit, 0, 1), [0, 1], `${spacing} mm spacing accepts its exact step limit`);
    assert.deepEqual(findHamsterPath(atLimit, 1, 0), [1, 0]);
    assert.deepEqual(findHamsterPath(tooHigh, 0, 1), [], `${spacing} mm spacing rejects an excessive rise`);
    assert.deepEqual(findHamsterPath(tooHigh, 1, 0), [], "an excessive drop also needs stairs");
  }
});

test("clearance obstacles break an otherwise continuous surface in both directions", () => {
  const samples = Array.from({ length: 5 }, (_, index) => sample(index * 12, 0, 110));
  const checkedPairs = new Set<string>();
  const isClear = (a: HamsterWalkSample, b: HamsterWalkSample) => {
    checkedPairs.add([a.point[0], b.point[0]].sort((x, y) => x - y).join(","));
    return !(Math.min(a.point[0], b.point[0]) < 18 && Math.max(a.point[0], b.point[0]) > 18);
  };
  const nodes = connectWalkSurfaceSamples(samples, 12, isClear);

  assert.deepEqual(findHamsterPath(nodes, 0, 4), []);
  assert.deepEqual(findHamsterPath(nodes, 4, 0), []);
  assert.deepEqual(findHamsterPath(nodes, 2, 4), [2, 3, 4]);
  assert.ok(checkedPairs.has("12,24"), "the wall-crossing candidate must be clearance-tested");
  for (let from = 0; from < nodes.length; from++) {
    for (const to of nodes[from].links) {
      assert.ok(checkedPairs.has([nodes[from].point[0], nodes[to].point[0]].sort((x, y) => x - y).join(",")));
      assert.equal(isClear(nodes[from], nodes[to]), true, "no accepted edge crosses an obstacle");
      assert.ok(nodes[to].links.includes(from), "walkable edges are reversible");
    }
  }
});

test("path search can leave a dead-end branch and uses only existing links", () => {
  const nodes: HamsterNavNode[] = [
    { ...sample(0, 0, 110), links: [1, 2] },
    { ...sample(12, 0, 110), links: [0] },
    { ...sample(0, 12, 110), links: [0, 3] },
    { ...sample(12, 12, 110), links: [2, 4] },
    { ...sample(24, 12, 110), links: [3] },
    { ...sample(100, 100, 110), links: [] },
  ];
  const before = structuredClone(nodes);
  const outward = findHamsterPath(nodes, 0, 4);
  const inward = findHamsterPath(nodes, 4, 0);

  assert.deepEqual(outward, [0, 2, 3, 4]);
  assert.deepEqual(inward, [...outward].reverse());
  assertTraversablePath(nodes, outward, 0, 4);
  assertTraversablePath(nodes, inward, 4, 0);
  assert.deepEqual(findHamsterPath(nodes, 0, 5), []);
  assert.deepEqual(findHamsterPath(nodes, 5, 5), [5]);
  assert.deepEqual(nodes, before, "path searches must not alter graph connectivity");
});

test("burrow fit uses body cross section plus a 3 mm safety margin", () => {
  assert.equal(canUseBurrow(60, 20, 0), true, "a 60 mm hamster fits this opening");
  assert.equal(canUseBurrow(100, 20, 0), false, "a larger hamster cannot use the same opening");
  for (const bodyLength of [60, 100, 140]) {
    const minimumRadius = bodyLength * 0.24 + 3;
    assert.equal(canUseBurrow(bodyLength, minimumRadius, 0), true);
    assert.equal(canUseBurrow(bodyLength, minimumRadius - 0.01, 0), false);
  }
});

test("burrow drop limit scales with body size and treats bedding above the opening as zero drop", () => {
  assert.equal(canUseBurrow(60, 40, 60), false, "this drop is too high for the smaller hamster");
  assert.equal(canUseBurrow(100, 40, 60), true, "the larger hamster can use the same drop");
  for (const bodyLength of [60, 100, 140]) {
    const holeRadius = bodyLength * 0.24 + 3;
    const maximumDrop = bodyLength * 0.65 + 10;
    assert.equal(canUseBurrow(bodyLength, holeRadius, maximumDrop), true);
    assert.equal(canUseBurrow(bodyLength, holeRadius, maximumDrop + 0.01), false);
    assert.equal(canUseBurrow(bodyLength, holeRadius, -20), true);
  }
  assert.equal(canUseBurrow(100, 20, -20), false, "negative drop does not waive opening clearance");
});
