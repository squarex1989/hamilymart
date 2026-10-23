/** Keep true axis-aligned planes flat while retaining smooth normals on curves.
 * Input is the expanded triangle stream; positions are never changed.
 */
export function lockPlanarFaceNormals(positions, normals, tolerance = 1e-5) {
  let corrected = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax=positions[i+3]-positions[i], ay=positions[i+4]-positions[i+1], az=positions[i+5]-positions[i+2];
    const bx=positions[i+6]-positions[i], by=positions[i+7]-positions[i+1], bz=positions[i+8]-positions[i+2];
    const cross=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
    const length=Math.hypot(...cross);
    if (length < 1e-10) continue;
    const axis=Math.abs(cross[0])>Math.abs(cross[1])?(Math.abs(cross[0])>Math.abs(cross[2])?0:2):(Math.abs(cross[1])>Math.abs(cross[2])?1:2);
    // Exported CAD planes can vary by micrometres. The default 0.26° tolerance
    // catches those tiny slopes without flattening visible rounded facets.
    if (Math.abs(cross[axis])/length < 1-tolerance) continue;
    for(let vertex=0;vertex<3;vertex++)for(let coordinate=0;coordinate<3;coordinate++)
      normals[i+vertex*3+coordinate]=coordinate===axis?Math.sign(cross[axis]):0;
    corrected++;
  }
  return corrected;
}
