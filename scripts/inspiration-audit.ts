/** Offline authoring audit. Distances are mm, not a biological safety certification.
 * Door positions come from the source wall cutouts; pipeFaces are old saddle
 * connector datums, so mouth centers must be explicitly corrected by 38 mm. */
import { getProduct, type Bounds, type Vec3 } from '../src/data/catalog';
import { getItemBounds, getPlatforms, rotateVector, transformPoint, type AssemblyItem, type AssemblyState } from '../src/lib/assembly';
import modelIndex from '../src/data/model-index.json';
export const LANDING_DEPTH = 50;
export const LANDING_WIDTH = 60;
export type Portal = { itemId:string; center:Vec3; normal:Vec3; width:number; pipe:boolean };
const doors: Record<string,{center:Vec3;normal:Vec3}[]> = {
 villa:[{center:[145,181.1,110],normal:[0,-1,0]},{center:[198,240,110],normal:[1,0,0]}],
 'roof-cottage':[{center:[162,239,200],normal:[1,0,0]}],
 'l-house':[{center:[50,2,0],normal:[0,-1,0]},{center:[198,150,0],normal:[1,0,0]}],
 'cube-house':[{center:[98,50,0],normal:[1,0,0]}],
};
export function portals(item:AssemblyItem):Portal[]{
 const product=getProduct(item.productId);
 let local=doors[item.productId]??[];
 if(product.pipeFaces){
  local=product.pipeFaces.map(face=>{
   const center=[...face.center] as Vec3;
   if(center[2]===11){if(face.normal[0])center[1]-=38;else center[0]-=38;}
   center[2]=product.origin[2];
   return {center,normal:face.normal};
  });
  if(item.productId==='pipe-st2')local.push({center:[150,6.8,0],normal:[0,-1,0]});
 }
 return local.map(p=>({itemId:item.id,center:transformPoint(p.center,product,item),normal:rotateVector(p.normal,item.rotation),width:LANDING_WIDTH,pipe:!!product.pipeFaces}));
}
export function worldBounds(box:Bounds,item:AssemblyItem):Bounds{
 const p=getProduct(item.productId),a=transformPoint(box.slice(0,3) as Vec3,p,item),b=transformPoint(box.slice(3) as Vec3,p,item);
 return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.min(a[2],b[2]),Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.max(a[2],b[2])];
}
export function visualBounds(item:AssemblyItem):Bounds[]{
 return getProduct(item.productId).parts.map(p=>worldBounds((modelIndex as any)[p.id].bounds,item));
}
export function solidBounds(item:AssemblyItem):Bounds[]{
 // Stair walking envelope is conservatively kept; only a villa's high grass
 // and deck must not block an otherwise clear passage on the ground below it.
 return item.productId==='villa'?visualBounds(item):getItemBounds(item);
}
export function landing(portal:Portal):Bounds{
 const [x,y,z]=portal.center,[nx,ny]=portal.normal,w=portal.width/2,d=LANDING_DEPTH;
 return nx?[Math.min(x,x+nx*d),y-w,z+.5,Math.max(x,x+nx*d),y+w,z+60]:[x-w,Math.min(y,y+ny*d),z+.5,x+w,Math.max(y,y+ny*d),z+60];
}
export const intersects=(a:Bounds,b:Bounds)=>[0,1,2].every(i=>Math.min(a[i+3],b[i+3])-Math.max(a[i],b[i])>.1);
function inRect(x:number,y:number,b:Bounds){return x>=b[0]-.02&&x<=b[3]+.02&&y>=b[1]-.02&&y<=b[4]+.02;}
export function supports(state:AssemblyState,item:AssemblyItem):Bounds[]{
 const parent=state.items.find(i=>i.id===item.parentId);
 if(!parent)return getPlatforms(state).map(p=>[p.x,p.y,110,p.x+300,p.y+300,110] as Bounds);
 if(parent.productId==='l-house')return getItemBounds(parent);
 if(parent.productId==='villa')return [worldBounds(modelIndex.A02.bounds as Bounds,parent)];
 return [];
}
export function connected(a:Portal,b:Portal){return a.pipe&&b.pipe&&a.itemId!==b.itemId&&a.center.every((v,i)=>Math.abs(v-b.center[i])<.1)&&a.normal.every((v,i)=>Math.abs(v+b.normal[i])<.1);}
export function audit(state:AssemblyState,{partial=false}:{partial?:boolean}={}){
 const issues:string[]=[];const all=state.items.flatMap(portals);const width=getPlatforms(state).length*300;
 for(const item of state.items){
  for(const b of [...visualBounds(item),...(item.productId==='seesaw'?getItemBounds(item):[])])
   if(b[0]<-.02||b[1]<-.02||b[3]>width+.02||b[4]>300.02)issues.push(`${item.id}: overhang`);
  if(state.items.some(i=>i.id===item.parentId)){
   const floor=supports(state,item);
   for(const b of visualBounds(item))for(const x of [b[0],(b[0]+b[3])/2,b[3]])for(const y of [b[1],(b[1]+b[4])/2,b[4]])
    if(!floor.some(f=>inRect(x,y,[f[0]-1,f[1]-1,f[2],f[3]+1,f[4]+1,f[5]])))issues.push(`${item.id}: overhang on upper floor`);
  }
  for(const portal of all.filter(p=>p.itemId===item.id)){
   if(all.some(p=>connected(portal,p)))continue;
   if(partial&&portal.pipe)continue; // A remaining module may connect this end.
   const b=landing(portal),floor=supports(state,item);
   for(const x of [b[0],(b[0]+b[3])/2,b[3]])for(const y of [b[1],(b[1]+b[4])/2,b[4]]){
    if(!floor.some(f=>inRect(x,y,f)))issues.push(`${item.id}: doorway outside supporting floor`);
   }
   for(const other of state.items){
    if(other.id===item.id||other.id===item.parentId)continue;
    if(solidBounds(other).some(o=>intersects(b,o)))issues.push(`${item.id}: entrance blocked by ${other.id}`);
   }
   // At ground level, reserve dry landing outside pools and opened covers.
   if(item.z===110)for(const platform of getPlatforms(state)){
    const circles: [number,number,number][]=[];
    if(platform.baseInsert==='pool')circles.push([platform.x+100,100,78]);
    for(const id of platform.removedCovers){const h=(modelIndex as any)[id].bounds;circles.push([platform.x+(h[0]+h[3])/2,(h[1]+h[4])/2,33]);}
    for(const [cx,cy,r] of circles)if(Math.hypot(Math.max(b[0],Math.min(cx,b[3]))-cx,Math.max(b[1],Math.min(cy,b[4]))-cy)<r-.1)issues.push(`${item.id}: entrance over opening`);
   }
  }
 }
 return [...new Set(issues)];
}
