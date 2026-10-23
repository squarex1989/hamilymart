import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { stabilizeModelNormals } from '../src/lib/model-normals';

function readGeometry(part:string) {
 const file=readFileSync(`public/models/${part}.glb`), length=file.readUInt32LE(12);
 const json=JSON.parse(file.subarray(20,20+length).toString());const bin=20+length+8;
 const primitive=json.meshes[0].primitives[0], geometry=new THREE.BufferGeometry();
 const attribute=(index:number)=>{
  const a=json.accessors[index],v=json.bufferViews[a.bufferView],size=a.type==='VEC3'?3:1;
  const Type=a.componentType===5126?Float32Array:a.componentType===5123?Uint16Array:Uint32Array;
  const start=bin+(v.byteOffset??0)+(a.byteOffset??0);
  return new THREE.BufferAttribute(new Type(Uint8Array.from(file.subarray(start,start+a.count*size*Type.BYTES_PER_ELEMENT)).buffer),size);
 };
 geometry.setAttribute('position',attribute(primitive.attributes.POSITION));geometry.setAttribute('normal',attribute(primitive.attributes.NORMAL));geometry.setIndex(attribute(primitive.indices));return geometry;
}

for(const part of ['MCDB','MCLB','MCRB','LHB','SHB'])test(`${part}: planar wall normals are flat without altering positions or rounded-surface normals`,()=>{
 const source=readGeometry(part),before=source.toNonIndexed(),fixed=stabilizeModelNormals(source),after=fixed.toNonIndexed();
 assert.deepEqual(after.getAttribute('position').array,before.getAttribute('position').array,'exact triangle stream unchanged');
 const p=before.getAttribute('position'),n=before.getAttribute('normal'),actual=after.getAttribute('normal');
 let planes=0,curves=0,corrected=0;
 for(let i=0;i<p.count;i+=3){
  const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
  const face=b.sub(a).cross(c.sub(a));if(face.length()<1e-10)continue;face.normalize();
  const xyz=face.toArray();const axis=xyz.findIndex(v=>Math.abs(v)>=1-1e-5);
  for(let j=0;j<3;j++){
   const old=new THREE.Vector3().fromBufferAttribute(n,i+j).toArray(),now=new THREE.Vector3().fromBufferAttribute(actual,i+j).toArray();
   if(axis>=0){assert.deepEqual(now,xyz.map((_,a)=>a===axis?Math.sign(xyz[axis]):0));planes++;if(old.some((v,a)=>Math.abs(v-now[a])>.001))corrected++;}
   else {assert.deepEqual(now,old);curves++;}
  }
 }
 assert(planes>0&&curves>0);if(part.startsWith('MC'))assert(corrected>0,'regression fixture contains stretched smooth normals');
 assert(fixed.getAttribute('position').count<=after.getAttribute('position').count);
 source.dispose();before.dispose();fixed.dispose();after.dispose();
});
