import * as THREE from "three";
import { COLORS } from "../data/catalog";

/** A volume-based marble pattern also works on CAD meshes without UVs. */
export function applyFinish(material: THREE.MeshStandardMaterial, colorId: string) {
  material.color.set(COLORS.find(color => color.id === colorId)?.hex ?? "#F1EADB");
  if (colorId === "jade") {
    material.roughness = .22;
    material.metalness = .04;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.clearcoat = .8;
      material.clearcoatRoughness = .12;
    }
  }
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
