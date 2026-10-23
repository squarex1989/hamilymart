/** Offline authoring audit. Distances are mm, not a biological safety certification.
 * Door positions come from the source wall cutouts; pipeFaces are old saddle
 * connector datums, so mouth centers must be explicitly corrected by 38 mm. */
import { getProduct, type Bounds, type Vec3 } from '../src/data/catalog';
import { getItemBounds, getPlatforms, rotateVector, transformPoint, type AssemblyItem, type AssemblyState } from '../src/lib/assembly';
import modelIndex from '../src/data/model-index.json';
import { HOUSE_DOORWAYS } from '../src/data/house-doorways';
import { MODEL_CAMERA_DIRECTION } from '../src/lib/model-presentation';
export const LANDING_DEPTH = 50;
export const LANDING_WIDTH = 60;
export type Portal = { itemId:string; center:Vec3; normal:Vec3; width:number; pipe:boolean; depth?:number };
const doors = HOUSE_DOORWAYS;
export function portals(item:AssemblyItem):Portal[]{
 const product=getProduct(item.productId);
 let local: { center: Vec3; normal: Vec3; depth?: number }[] = [...(doors[item.productId] ?? [])];
 if(product.pipeFaces){
  local=product.pipeFaces.map(face=>{
   const center=[...face.center] as Vec3;
   if(center[2]===11){if(face.normal[0])center[1]-=38;else center[0]-=38;}
   center[2]=product.origin[2];
   return {center,normal:face.normal};
  });
  if(item.productId==='pipe-st2')local.push({center:[150,6.8,0],normal:[0,-1,0]});
 }
 return local.map(p=>({itemId:item.id,center:transformPoint(p.center,product,item),normal:rotateVector(p.normal,item.rotation),width:LANDING_WIDTH,pipe:!!product.pipeFaces,depth:p.depth}));
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
 const [x,y,z]=portal.center,[nx,ny]=portal.normal,w=portal.width/2,d=portal.depth ?? LANDING_DEPTH;
 return nx?[Math.min(x,x+nx*d),y-w,z+.5,Math.max(x,x+nx*d),y+w,z+60]:[x-w,Math.min(y,y+ny*d),z+.5,x+w,Math.max(y,y+ny*d),z+60];
}
export const intersects=(a:Bounds,b:Bounds)=>[0,1,2].every(i=>Math.min(a[i+3],b[i+3])-Math.max(a[i],b[i])>.1);
function inRect(x:number,y:number,b:Bounds){return x>=b[0]-.02&&x<=b[3]+.02&&y>=b[1]-.02&&y<=b[4]+.02;}
export function supports(state:AssemblyState,item:AssemblyItem):Bounds[]{
 const parent=state.items.find(i=>i.id===item.parentId);
 if(!parent)return getPlatforms(state).map(p=>[p.x,p.y,110,p.x+300,p.y+300,110] as Bounds);
 if(parent.productId==='l-house')return getItemBounds(parent);
 if(parent.productId==='villa')return [worldBounds(modelIndex.A02.bounds as Bounds,parent)];
 return (getProduct(parent.productId).surfaces ?? []).map(surface => worldBounds(surface.bounds,parent));
}
export function connected(a:Portal,b:Portal){return a.pipe&&b.pipe&&a.itemId!==b.itemId&&a.center.every((v,i)=>Math.abs(v-b.center[i])<.1)&&a.normal.every((v,i)=>Math.abs(v+b.normal[i])<.1);}
/** Source wall openings; visibility is checked against the unchanged home view.
 * A central patch must face the camera and clear other components' envelopes. */
export function visibleHouseOpening(state:AssemblyState,item:AssemblyItem,{doorsOnly=false}:{doorsOnly?:boolean}={}):boolean {
 if(!doors[item.productId])return true;
 const product=getProduct(item.productId);
 const openings=doors[item.productId].map(p=>({...p,center:[p.center[0],p.center[1],p.center[2]+30] as Vec3}));
 if(!doorsOnly&&item.productId==='roof-cottage')openings.push({center:[83,179.6,245],normal:[0,-1,0],depth:50});
 if(!doorsOnly&&item.productId==='cube-house')openings.push({center:[50,2,43],normal:[0,-1,0],depth:50},{center:[50,98,43],normal:[0,1,0],depth:50});
 const direction=MODEL_CAMERA_DIRECTION;
 function hits(origin:Vec3,b:Bounds){
  let near=0,far=Infinity;
  for(let axis=0;axis<3;axis++){
   const a=(b[axis]-origin[axis])/direction[axis],c=(b[axis+3]-origin[axis])/direction[axis];
   near=Math.max(near,Math.min(a,c));far=Math.min(far,Math.max(a,c));
  }
  return far>Math.max(near,.001);
 }
 return openings.some(p=>{
  const n=rotateVector(p.normal,item.rotation);
  if(n.reduce((sum,v,i)=>sum+v*direction[i],0)<100)return false;
  const center=transformPoint(p.center,product,item);
  const samples=[-8,0,8].map(offset=>[center[0]-n[1]*offset+n[0],center[1]+n[0]*offset+n[1],center[2]] as Vec3);
  return samples.every(point=>!state.items.some(other=>other.id!==item.id&&solidBounds(other).some(b=>hits(point,b))));
 });
}
export function audit(state:AssemblyState,{partial=false}:{partial?:boolean}={}){
 const issues:string[]=stairAccessIssues(state);const all=state.items.flatMap(portals);const width=getPlatforms(state).length*300;
 for(const item of state.items){
  if(!visibleHouseOpening(state,item,{doorsOnly:true}))issues.push(`${item.id}: no visible opening from home view`);
  for(const b of [...visualBounds(item),...(item.productId==='seesaw'?getItemBounds(item):[])])
   if(b[0]<-.02||b[1]<-.02||b[3]>width+.02||b[4]>300.02)issues.push(`${item.id}: overhang`);
  if(getProduct(item.productId).supportMode !== "bridge" && state.items.some(i=>i.id===item.parentId)){
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
    // A villa may open toward the matching installed pool, but never an uncovered hole.
    if(platform.baseInsert==='pool' && !(item.productId==='villa' && item.parentId===platform.id))circles.push([platform.x+100,100,78]);
    for(const id of platform.removedCovers){const h=(modelIndex as any)[id].bounds;circles.push([platform.x+(h[0]+h[3])/2,(h[1]+h[4])/2,33]);}
    for(const [cx,cy,r] of circles)if(Math.hypot(Math.max(b[0],Math.min(cx,b[3]))-cx,Math.max(b[1],Math.min(cy,b[4]))-cy)<r-.1)issues.push(`${item.id}: entrance over opening`);
   }
  }
 }
 return [...new Set(issues)];
}

/** Stair ports follow the source tread geometry, not the square footprint:
 * straight climbs +Y; curved right/left enter at -Y and exit at +/-X.
 * A grid seam leaves 4 mm between the rounded stair and roof edges. */
export function stairPorts(item: AssemblyItem) {
 if (!item.productId.startsWith('stairs-')) return null;
 const height = getProduct(item.productId).collisionBoxes[0][5];
 const right = item.productId.startsWith('stairs-right'), left = item.productId.startsWith('stairs-left');
 const product = getProduct(item.productId);
 return {
  top: transformPoint([right ? 98 : left ? 2 : 50, right || left ? 64 : 98, height], product, item),
  out: rotateVector(right ? [1,0,0] : left ? [-1,0,0] : [0,1,0], item.rotation),
  foot: transformPoint([right ? 36 : left ? 64 : 50,2,0], product, item),
  entry: rotateVector([0,-1,0], item.rotation),
 };
}
export function stairAccessIssues(state: AssemblyState): string[] {
 const issues: string[] = [];
 for (const stair of state.items) {
  const ports = stairPorts(stair); if (!ports) continue;
  const {top,out,foot,entry} = ports;
  // The home camera looks from the front/right: entry must face that front or side.
  if (entry[0]*MODEL_CAMERA_DIRECTION[0]+entry[1]*MODEL_CAMERA_DIRECTION[1] <= 0)
    issues.push(`${stair.id}: stair entry faces away from home view`);
  // Require a 40 mm wide, 30 mm deep landing, starting across the 4 mm grid seam.
  const samples = [5,20,35].flatMap(d => [-20,0,20].map(w =>
   [top[0]+out[0]*d-out[1]*w,top[1]+out[1]*d+out[0]*w,top[2]] as Vec3));
  const roofs = state.items.filter(other => other.id !== stair.id).flatMap(other =>
   (getProduct(other.productId).surfaces ?? []).map(surface => ({owner:other.id,box:worldBounds(surface.bounds,other)})));
  // The exit must meet an actual roof at the same height.
  const target = roofs.find(roof => roof.box[5]-top[2] >= -.5 && roof.box[5]-top[2] <= .5 && samples.every(p => inRect(p[0],p[1],roof.box)));
  if (!target) issues.push(`${stair.id}: stairs do not meet a same-height upper landing`);
  else {
   const landingBox:Bounds = [Math.min(...samples.map(p=>p[0])),Math.min(...samples.map(p=>p[1])),top[2]+1,
    Math.max(...samples.map(p=>p[0])),Math.max(...samples.map(p=>p[1])),top[2]+51];
   if(state.items.some(other => other.id!==stair.id && other.id!==target.owner && solidBounds(other).some(b=>intersects(landingBox,b))))
    issues.push(`${stair.id}: upper stair landing is blocked`);
  }
  const approach=landing({itemId:stair.id,center:foot,normal:entry,width:40,pipe:false,depth:40});
  const platforms=getPlatforms(state).map(p=>[p.x,p.y,110,p.x+300,p.y+300,110] as Bounds);
  for(const x of [approach[0],approach[3]])for(const y of [approach[1],approach[4]])
   if(!platforms.some(p=>inRect(x,y,p)))issues.push(`${stair.id}: stair entry outside platform`);
  if(state.items.some(other=>other.id!==stair.id && solidBounds(other).some(b=>intersects(approach,b))))
   issues.push(`${stair.id}: stair entry blocked`);
  for(const platform of getPlatforms(state)) {
   const holes: [number,number,number][] = platform.baseInsert==='pool' ? [[platform.x+100,platform.y+100,78]] : [];
   for(const id of platform.removedCovers){const b=(modelIndex as any)[id].bounds;holes.push([platform.x+(b[0]+b[3])/2,platform.y+(b[1]+b[4])/2,33]);}
   if(holes.some(([x,y,r])=>Math.hypot(Math.max(approach[0],Math.min(x,approach[3]))-x,Math.max(approach[1],Math.min(y,approach[4]))-y)<r))
    issues.push(`${stair.id}: stair entry over opening`);
  }
 }
 return [...new Set(issues)];
}
