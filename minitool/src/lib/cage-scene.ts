import * as THREE from 'three';
import { getLayoutFootprint } from './layout-footprint';
import type { AssemblyState } from './assembly';

/** The cage is grounded and centered on the complete platform footprint (millimetres). */
export function getCageBounds(state: AssemblyState): THREE.Box3 | null {
  if (!state.cage) return null;
  const footprint = getLayoutFootprint(state);
  const x = (footprint.minX + footprint.maxX) / 2;
  const y = (footprint.minY + footprint.maxY) / 2;
  const { width, depth, height } = state.cage;
  return new THREE.Box3(new THREE.Vector3(x - width * 5, y - depth * 5, 0), new THREE.Vector3(x + width * 5, y + depth * 5, height * 10));
}

export function createCagePreview(scene: THREE.Scene) {
  const enabled = { value: 0 }, min = { value: new THREE.Vector3() }, max = { value: new THREE.Vector3() };
  const material = new THREE.MeshBasicMaterial({ color: '#4f9ee8', transparent: true, opacity: .1, depthWrite: false, side: THREE.BackSide });
  // Keep the blue reference behind the opaque models. Front faces would tint
  // them differently as zoom crosses the cage boundary.
  material.forceSinglePass = true;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  shell.name = 'Cage size reference';
  shell.visible = false;
  // This shell never joins the model/picking roots or the placement engine.
  scene.add(shell);
  return {
    update(state: AssemblyState) {
      const bounds = getCageBounds(state);
      enabled.value = bounds ? 1 : 0;
      shell.visible = !!bounds;
      if (bounds) {
        min.value.copy(bounds.min); max.value.copy(bounds.max);
        bounds.getCenter(shell.position); bounds.getSize(shell.scale);
      }
    },
    decorate(material: THREE.Material) {
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.hmCageEnabled = enabled;
        shader.uniforms.hmCageMin = min;
        shader.uniforms.hmCageMax = max;
        shader.vertexShader = 'varying vec3 hmCagePosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
          vec4 hmWorld = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            hmWorld = batchingMatrix * hmWorld;
          #endif
          #ifdef USE_INSTANCING
            hmWorld = instanceMatrix * hmWorld;
          #endif
          hmCagePosition = (modelMatrix * hmWorld).xyz;
          #include <project_vertex>
        `);
        shader.fragmentShader = 'varying vec3 hmCagePosition;\nuniform float hmCageEnabled;\nuniform vec3 hmCageMin;\nuniform vec3 hmCageMax;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          if (hmCageEnabled > 0.5 && (any(lessThan(hmCagePosition, hmCageMin - vec3(0.05))) || any(greaterThan(hmCagePosition, hmCageMax + vec3(0.05))))) {
            diffuseColor.rgb = vec3(0.85, 0.025, 0.035);
          }
        `);
      };
      material.customProgramCacheKey = () => 'hamily-cage-world-v1';
      material.userData.cageShader = true;
    },
    dispose() { scene.remove(shell); shell.geometry.dispose(); material.dispose(); },
  };
}
