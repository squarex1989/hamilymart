import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHamsterSimulation } from '../src/lib/hamster-scene';
import { createHamsterSimulation as miniSimulation } from '../minitool/src/lib/hamster-scene';
import { createInitialState, getItemDisplayElevation, getPlatforms } from '../src/lib/assembly';
import { getProduct } from '../src/data/catalog';
import { setModelPartTransform } from '../src/lib/model-presentation';
import type { AssemblyState } from '../src/lib/assembly';

function makeScene(state: AssemblyState) {
  const scene = new THREE.Scene(), environment = new THREE.Group(); environment.userData.hamsterEnvironment = true; scene.add(environment);
  for (const platform of getPlatforms(state)) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(300, 300, 10), new THREE.MeshBasicMaterial());
    deck.userData.sourceGroup = 'P01'; deck.userData.platformId = platform.id;
    deck.position.set(platform.x + 150, platform.y + 150, 105 + platform.elevation);
    environment.add(deck);
  }
  return { scene, environment };
}
function navigation(scene: THREE.Scene) { return scene.getObjectByName('hamster-simulation')!.userData.navigation; }
function finish(simulation: ReturnType<typeof createHamsterSimulation>, scene: THREE.Scene) {
  for (let frame = 0; frame < 1000 && !navigation(scene)?.ready; frame++) simulation.tick(.016);
  assert.equal(navigation(scene)?.ready, true, 'bounded network completes');
  assert(navigation(scene).nodes > 0); return navigation(scene);
}
function dispose(scene: THREE.Scene) {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
  });
}

for (const [label, make] of [['web', createHamsterSimulation], ['mini', miniSimulation]] as const) {
  test(`${label}: hamster can walk on finite ground or bedding with no platforms and no model colliders`, () => {
    for (const depth of [0, 50] as const) {
      const state = createInitialState(); state.baseRemoved = true; state.bedding = depth ? {mode:'thin',depth:50} : {mode:'none',depth:0}; state.hamster = 'robo-agouti';
      const {scene} = makeScene(state), simulation = make(scene); simulation.update(state);
      const nav = finish(simulation, scene);
      assert(nav.nodes < 2000, 'empty layout uses a finite default floor envelope');
      assert.equal(nav.minHeight, depth); assert.equal(nav.maxHeight, depth);
      assert(nav.reachableRegions.includes(depth ? 'bedding' : 'ground'));
      assert.equal(scene.getObjectByName('hamster-robo-agouti')?.visible, true);
      simulation.dispose(); dispose(scene);
    }
  });
  test(`${label}: different platform heights remain disconnected until their real supporting surfaces meet`, () => {
    const state = createInitialState(); state.hamster = 'robo-agouti'; state.bedding = {mode:'none',depth:0};
    state.extension = {direction:'right',legHeight:200,baseInsert:'lid',baseColors:{...state.baseColors},removedCovers:[]};
    const {scene,environment} = makeScene(state), simulation = make(scene); simulation.update(state);
    const separate = finish(simulation, scene);
    assert.equal(separate.minHeight, 110); assert.equal(separate.maxHeight, 110);
    const previousReachable = separate.reachable;
    const aligned = {...state,extension:{...state.extension,legHeight:100 as const}};
    environment.children.find(child => child.userData.platformId === 'base2')!.position.z = 105;
    simulation.update(aligned);
    assert.equal(navigation(scene).ready,false,'changing one platform height rebuilds navigation');
    const connected = finish(simulation, scene);
    assert.equal(connected.minHeight,110); assert.equal(connected.maxHeight,110);
    assert(connected.reachable > previousReachable * 1.8,'only coplanar platform seam connects the two decks');
    const onlySecond = {...state,baseRemoved:true};
    environment.children.find(child => child.userData.platformId === 'base')!.removeFromParent();
    environment.children.find(child => child.userData.platformId === 'base2')!.position.z = 205;
    simulation.update(onlySecond);
    const remaining = finish(simulation,scene);
    assert.equal(remaining.minHeight,210); assert.equal(remaining.maxHeight,210,'remaining platform uses its own leg height');
    simulation.dispose(); dispose(scene);
  });
}

test('a real house moved to the bedding keeps its interior reachable without an invisible platform', async () => {
  const state = createInitialState(); state.baseRemoved=true; state.bedding={mode:'thin',depth:50}; state.hamster='robo-agouti';
  const product = getProduct('cube-house');
  const house = {id:'ground-house',productId:product.id,parentId:'ground',x:200,y:200,z:0,rotation:0 as const,colors:{}};
  state.items=[house];
  const {scene,environment}=makeScene(state), owner=new THREE.Group();
  owner.position.set(house.x,house.y,house.z+getItemDisplayElevation(state,house)); environment.add(owner);
  for (const part of product.parts) {
    const bytes=readFileSync(new URL(`../public/models/${part.id}.glb`,import.meta.url));
    const child=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
    setModelPartTransform(child,part,product.origin); owner.add(child);
  }
  const simulation=createHamsterSimulation(scene); simulation.update(state); const nav=finish(simulation,scene);
  assert.equal(nav.minHeight,50); assert.equal(nav.maxHeight,50,'a roof is not a direct ground shortcut');
  assert.equal(nav.interiors[0].reachable,true);
  simulation.dispose();dispose(scene);
});
