import * as THREE from "three";
import { COLORS } from "../data/catalog";

/** Solid stock colors, jade clearcoat, and the retained legacy marble finish. */
export function applyFinish(material: THREE.MeshStandardMaterial, colorId: string) {
  material.color.set(COLORS.find(color => color.id === colorId)?.hex ?? COLORS[0].hex);
  // A material may be reused by a color picker: remove the previous finish in full.
  material.roughness = .72;
  material.metalness = 0;
  material.map = null;
  material.bumpMap = null;
  material.normalMap = null;
  material.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
  material.customProgramCacheKey = () => "hamily-solid-1";
  if (material instanceof THREE.MeshPhysicalMaterial) {
    // Matte stock is diffuse: moving the camera must not add a white specular wash.
    material.specularIntensity = 0;
    material.clearcoat = 0;
    material.clearcoatRoughness = 0;
  }
  material.needsUpdate = true;
  if (colorId === "jade") {
    material.roughness = .22;
    material.metalness = .04;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.specularIntensity = 1;
      material.clearcoat = .8;
      material.clearcoatRoughness = .12;
    }
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
