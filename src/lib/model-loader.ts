import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODEL_ASSET_VERSION } from "../data/catalog";
import modelIndex from "../data/model-index.json";
import { stabilizeModelNormals } from "./model-normals";
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const index = modelIndex as Record<
  string,
  { url: string; bounds: number[]; components: { colorKey: string }[] }
>;
export function loadPart(id: string) {
  if (!cache.has(id)) {
    const request = loader.loadAsync(`${index[id].url}?v=${MODEL_ASSET_VERSION}`).then((g) => {
      g.scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          const previous=object.geometry;object.geometry=stabilizeModelNormals(previous);previous.dispose();
        }
      });
      return g.scene;
    }).catch(error => {
      if (cache.get(id) === request) cache.delete(id);
      throw error;
    });
    cache.set(id, request);
  }
  return cache.get(id)!;
}
