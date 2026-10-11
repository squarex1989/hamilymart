import * as THREE from "three";

/** Selection changes picking and helpers without replacing any model or material. */
export function updateSelectionMetadata(objects: THREE.Object3D, selectedId: string | null, exploded = false) {
  for (const owner of objects.children) {
    const ownerId = owner.userData.itemId as string | undefined;
    if (!ownerId) continue;
    const platform = /^(base|base2|base3)$/.test(ownerId);
    const editingOwner = selectedId === ownerId || !!selectedId?.startsWith(`cover:${ownerId}:`);
    for (const part of owner.children) {
      const partId = String(part.userData.partId ?? "");
      part.userData.selectionId = platform
        ? /^H0[1-5]$/.test(partId) && editingOwner ? `cover:${ownerId}:${partId}` : partId === "B01" ? `pool:${ownerId}` : ownerId
        : ownerId;
      part.traverse(node => {
        if (!node.userData.selectionSeam) return;
        node.userData.selectionSeamActive = editingOwner;
        node.visible = editingOwner && !exploded;
      });
    }
  }
}
