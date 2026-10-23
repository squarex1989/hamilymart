import * as THREE from 'three';
import { lockPlanarFaceNormals } from './planar-normals.js';
/** Split normals at plane/curve borders without moving or simplifying any vertex. */
export function stabilizeModelNormals(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const expanded=source.index?source.toNonIndexed():source.clone();
  if(!expanded.getAttribute('normal')) expanded.computeVertexNormals();
  lockPlanarFaceNormals(expanded.getAttribute('position').array,expanded.getAttribute('normal').array);
  const attributes=Object.entries(expanded.attributes) as [string,THREE.BufferAttribute][];
  const unique=new Map<string,number>(), first:number[]=[], indices:number[]=[];
  const normals=expanded.getAttribute('normal');
  for(let vertex=0;vertex<normals.count;vertex++){
    // Original indices preserve every position/UV seam exactly; only equal
    // corrected normals on that same source vertex can share a GPU vertex.
    const original=source.index?source.index.getX(vertex):vertex;
    const key=`${original}|${normals.getX(vertex)},${normals.getY(vertex)},${normals.getZ(vertex)}`;
    let index=unique.get(key);
    if(index===undefined){index=unique.size;unique.set(key,index);first.push(vertex);}
    indices.push(index);
  }
  const result=source.clone();
  for(const [name,attribute] of attributes){
    const values=new (attribute.array.constructor as typeof Float32Array)(first.length*attribute.itemSize);
    first.forEach((vertex,index)=>{for(let axis=0;axis<attribute.itemSize;axis++)values[index*attribute.itemSize+axis]=attribute.array[vertex*attribute.itemSize+axis];});
    result.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));
  }
  result.setIndex(indices);expanded.dispose();return result;
}
