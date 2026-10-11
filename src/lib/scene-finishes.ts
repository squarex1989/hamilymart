import * as THREE from "three";
import { COLORS } from "../data/catalog";

/** Object-space patterns keep their scale and direction on CAD meshes without UVs. */
export function applyFinish(material: THREE.MeshStandardMaterial, colorId: string) {
  material.color.set(COLORS.find(color => color.id === colorId)?.hex ?? "#F1EADB");
  // A material may be reused by a color picker: remove the previous finish in full.
  material.roughness = .72;
  material.metalness = 0;
  material.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
  material.customProgramCacheKey = () => "hamily-solid-1";
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoat = 0;
    material.clearcoatRoughness = 0;
  }
  material.needsUpdate = true;
  if (colorId === "jade") {
    material.roughness = .22;
    material.metalness = .04;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.clearcoat = .8;
      material.clearcoatRoughness = .12;
    }
  }
  if (colorId === "darkwood") {
    material.roughness = .62;
    material.customProgramCacheKey = () => "hamily-wood-1";
    material.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec3 vWoodPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvWoodPosition = position;");
      shader.fragmentShader = "varying vec3 vWoodPosition;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        // Coordinates are millimetres. Growth lines bend gently along the long grain.
        vec3 wp = vWoodPosition;
        float bend = sin(wp.y * 0.022 + sin(wp.x * 0.015)) * 0.85
                   + sin(wp.y * 0.057 + wp.z * 0.019) * 0.18;
        float growth = wp.x * 0.32 + wp.z * 0.24 + bend;
        float softGrain = sin(growth + sin(growth * 0.47) * 0.7);
        float growthLine = pow(0.5 + 0.5 * sin(growth * 2.2 + sin(growth * 0.71)), 12.0);
        float fibres = sin(wp.x * 4.8 + wp.z * 3.9 + bend * 3.0 + sin(wp.y * 0.19));
        float fibreDetail = smoothstep(0.65, 1.0, fibres) * (0.5 + 0.5 * sin(wp.y * 0.31 + wp.x));
        float warmth = sin(wp.x * 0.037 + wp.z * 0.045 + bend * 0.3);
        diffuseColor.rgb *= 1.02 + softGrain * 0.032 - growthLine * 0.09 - fibreDetail * 0.025;
        diffuseColor.rgb *= vec3(1.0 + warmth * 0.012, 1.0, 1.0 - warmth * 0.018);
      `);
    };
    return;
  }
  // Retained only for designs saved before marble was removed from the picker.
  if (colorId !== "marble") return;
  material.roughness = .48;
  material.customProgramCacheKey = () => "hamily-marble-1";
  material.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec3 vStonePosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvStonePosition = position;");
    shader.fragmentShader = "varying vec3 vStonePosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec3 p = vStonePosition * 0.075;
      float wave = p.x + p.y * 0.63 + p.z * 0.41 + 1.2 * sin(p.y * 0.7 + sin(p.z));
      float vein = pow(0.5 + 0.5 * sin(wave * 2.8 + 0.5 * sin(p.x * 2.)), 24.);
      float grain = sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 0.012;
      diffuseColor.rgb *= 1.0 - vein * 0.29 + grain;
    `);
  };
}
