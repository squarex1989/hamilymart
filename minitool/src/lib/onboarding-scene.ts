import * as THREE from 'three';
import { createModelBatches } from './model-batches';
import { createBedding } from './bedding-scene';
import { loadPart } from './model-loader';
import { configureModelRenderer, createModelLighting, createModelMaterial, setModelPartTransform, MODEL_CAMERA_DIRECTION } from './model-presentation';
import { getBaseParts, getProduct, P01_TOP_XY, H06_TOP_XY, type ProductPart, type ColorMap } from '../data/catalog';
import { getPlatforms, getItemDisplayElevation, type AssemblyState } from './assembly';
import { createIntroductionDesigns, createMagnetDemonstration, createBeddingDemonstration, introductionPhase } from './onboarding';
const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
type ModuleScene={skin:THREE.Group;roofSteel:THREE.Group;items:THREE.Group[];positions:THREE.Vector3[];magnets:THREE.Group[];magnet:THREE.Object3D;roof:THREE.Object3D;upperHouse:number};
type BeddingScene={bed:ReturnType<typeof createBedding>;cover:THREE.Group;pipe:THREE.Group;pipePosition:THREE.Vector3;ghosts:THREE.Material[];coverAnchor:THREE.Object3D;pipeAnchor:THREE.Object3D};

/** Existing product meshes, procedural hardware, and a continuous demonstration-only platform skin. */
export function createOnboardingScene(host:HTMLDivElement,page:0|1|2,onStatus:(error?:string)=>void,annotations?:SVGSVGElement|null) {
  let disposed=false,lost=false,loaded=false,width=1,height=1;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  configureModelRenderer(renderer);renderer.shadowMap.enabled=false;
  renderer.domElement.setAttribute('aria-label',['一、二、三平台灵感搭配动画','圣诞别墅圆盖移除与向下管道安装动画','磁铁、内嵌铁片与模块吸附动画'][page]);
  host.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,1,8000);camera.up.set(0,0,1);
  const light=createModelLighting(scene);light.sun.castShadow=false;
  const materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
  const models=new THREE.Group();scene.add(models);
  const batches=page===0?createModelBatches(scene,models):null;
  const groups:THREE.Group[]=[],bounds:THREE.Box3[]=[];
  let active=-1,lastElapsed=0,lastPaint=-1,pixelBudget=1.5,slowFrames=0,lastStill=false,lastReduced=false;
  const center=new THREE.Vector3(),size=new THREE.Vector3(),direction=new THREE.Vector3(...MODEL_CAMERA_DIRECTION).normalize(),vertical=new THREE.Vector3(0,0,1),projected=new THREE.Vector3();
  let module:ModuleScene|undefined,bedding:BeddingScene|undefined,bedResource:ReturnType<typeof createBedding>|undefined;
  const callout=annotations?.querySelector<SVGGElement>('[data-callout]');
  const calloutBox=callout?.querySelector<SVGGElement>('[data-label]');
  const calloutBackground=calloutBox?.querySelector('rect');
  const arrow=callout?.querySelector<SVGPathElement>('[data-arrow]');
  const point=callout?.querySelector<SVGCircleElement>('[data-point]');
  const label=callout?.querySelector<SVGTextElement>('[data-title]');
  const description=callout?.querySelector<SVGTextElement>('[data-description]');
  function annotate(anchor:THREE.Object3D|THREE.Vector3,title:string,subtitle:string,right=false) {
    if(!callout||!calloutBox||!arrow||!point||!label||!description)return;
    if(anchor instanceof THREE.Object3D)anchor.getWorldPosition(projected);else projected.copy(anchor);
    projected.project(camera);
    const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2;
    const boxWidth=140,boxHeight=subtitle?44:30,left=right?width-boxWidth-10:10,top=Math.max(40,height*.12),startX=left+(right?20:boxWidth-20),startY=top+boxHeight;
    callout.style.display='';calloutBox.setAttribute('transform',`translate(${left},${top})`);
    calloutBackground?.setAttribute('height',String(boxHeight));
    arrow.setAttribute('d',`M ${startX} ${startY} Q ${startX} ${(startY+y)/2} ${x} ${y}`);
    point.setAttribute('cx',String(x));point.setAttribute('cy',String(y));label.textContent=title;description.textContent=subtitle;
  }
  async function part(p:ProductPart,colors:ColorMap,origin:number[]=[0,0,0],doorSide?:'left'|'right') {
    const source=await loadPart(p.id);if(disposed)throw new Error('disposed');
    const child=source.clone(true);setModelPartTransform(child,p,origin,doorSide);
    child.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
      const original=Array.isArray(object.material)?object.material:[object.material];
      const cloned=original.map(m=>createModelMaterial(m,p,object.userData.sourcePart,object.userData.colorKey,colors));cloned.forEach(m=>materials.add(m));
      object.material=Array.isArray(object.material)?cloned:cloned[0];
    });return child;
  }
  async function assembly(state:AssemblyState,index:number) {
    const group=new THREE.Group();models.add(group);groups.push(group);group.visible=false;
    for(const platform of getPlatforms(state)){
      const base=new THREE.Group();base.position.set(platform.x,platform.y,platform.elevation);group.add(base);
      for(const p of getBaseParts(platform.legHeight,platform.baseInsert,platform.removedCovers))base.add(await part(p,platform.baseColors));
    }
    for(const item of state.items){const product=getProduct(item.productId),owner=new THREE.Group();owner.position.set(item.x,item.y,item.z+getItemDisplayElevation(state,item));owner.rotation.z=THREE.MathUtils.degToRad(item.rotation);group.add(owner);
      for(const p of product.parts)owner.add(await part(p,item.colors,product.origin,item.doorSide));
    }
    group.updateMatrixWorld(true);bounds[index]=new THREE.Box3().setFromObject(group);return group;
  }
  function disks(points:number[][],radius:number,depth:number,color:string){
    const group=new THREE.Group(),geometry=new THREE.CylinderGeometry(radius,radius,depth,24);geometry.rotateX(Math.PI/2);geometries.add(geometry);
    const material=new THREE.MeshStandardMaterial({color,metalness:.35,roughness:.3});materials.add(material);
    const mesh=new THREE.InstancedMesh(geometry,material,points.length),matrix=new THREE.Matrix4();
    points.forEach((p,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(p[0],p[1],p[2])));group.add(mesh);return group;
  }
  function anchor(parent:THREE.Object3D,position:number[]) {const point=new THREE.Object3D();point.position.set(position[0],position[1],position[2]);parent.add(point);return point;}
  function continuousSlab(z:number,depth:number){
    const outline=new THREE.Shape();outline.moveTo(16,0);outline.lineTo(284,0);outline.quadraticCurveTo(300,0,300,16);outline.lineTo(300,284);outline.quadraticCurveTo(300,300,284,300);outline.lineTo(16,300);outline.quadraticCurveTo(0,300,0,284);outline.lineTo(0,16);outline.quadraticCurveTo(0,0,16,0);
    const geometry=new THREE.ExtrudeGeometry(outline,{depth,bevelEnabled:false,curveSegments:12});geometries.add(geometry);
    const material=new THREE.MeshStandardMaterial({color:'#fef1db',roughness:.8});materials.add(material);
    const mesh=new THREE.Mesh(geometry,material);mesh.position.z=z;return mesh;
  }
  async function modular(){
    const state=createMagnetDemonstration(),root=new THREE.Group(),skin=new THREE.Group();models.add(root);groups.push(root);
    // Entire continuous solids: no circular holes, covers, or seams in the peel demonstration.
    root.add(continuousSlab(100,6),skin);skin.add(continuousSlab(106,4));
    root.add(disks([...P01_TOP_XY,...H06_TOP_XY].map(p=>[...p,106.7]),6,1.2,'#718b95'));
    for(const p of getBaseParts(100))if(/^L0/.test(p.id))root.add(await part(p,state.baseColors));
    const items:THREE.Group[]=[],positions:THREE.Vector3[]=[],magnets:THREE.Group[]=[];
    let roofSteel=new THREE.Group(),magnet=new THREE.Object3D(),roof=new THREE.Object3D(),upperHouse=0;
    for(const item of state.items){
      const p=getProduct(item.productId),group=new THREE.Group();group.rotation.z=THREE.MathUtils.degToRad(item.rotation);root.add(group);
      for(const pp of p.parts)group.add(await part(pp,item.colors,p.origin));
      const points=p.bottomMagnets.map(v=>[v[0]-p.origin[0],v[1]-p.origin[1],v[2]-p.origin[2]-3]);
      const hardware=disks(points,4,4,'#354c57');group.add(hardware);magnets.push(hardware);
      items.push(group);positions.push(new THREE.Vector3(item.x,item.y,item.z));
      if(item.productId==='l-house'){
        const unique=new Map(p.surfaces!.flatMap(s=>s.points).map(v=>[v.join(','),v]));
        const points=[...unique.values()].map(v=>[v[0]-p.origin[0],v[1]-p.origin[1],v[2]-p.origin[2]+.7]);
        roofSteel=disks(points,6,1,'#718b95');group.add(roofSteel);
        roof=anchor(group,[10,10,90.7]);magnet=anchor(group,pointsFromMagnet(p,0));
      }
      if(item.productId==='cube-house')upperHouse=items.length-1;
    }
    module={skin,roofSteel,magnets,items,positions,magnet,roof,upperHouse};
    bounds.push(new THREE.Box3(new THREE.Vector3(-45,-10,0),new THREE.Vector3(335,355,410)));
  }
  function pointsFromMagnet(p:ReturnType<typeof getProduct>,i:number){return p.bottomMagnets[i].map((v,axis)=>v-p.origin[axis]-(axis===2?3:0));}
  async function secretBase(){
    const state=createBeddingDemonstration(),root=new THREE.Group();models.add(root);groups.push(root);
    const bed=createBedding(scene);bedResource=bed;bed.update(state);bed.setOpacity(.3);bed.setLowQuality(true);
    let cover=new THREE.Group(),pipe=new THREE.Group();const ghosts:THREE.Material[]=[];
    const ghost=(object:THREE.Object3D)=>object.traverse(o=>{if(o instanceof THREE.Mesh)ghosts.push(...(Array.isArray(o.material)?o.material:[o.material]));});
    // H01 is deliberately present at first, even though the final pipe occupies it.
    // Fade the other platform parts too, so they cannot hide the underground pipe.
    for(const p of getBaseParts(100,'pool',[])){
      const child=await part(p,p.id==='H01'?{...state.baseColors,H01:'butter'}:state.baseColors);root.add(child);
      if(p.id==='H01')cover=child;else if(!/^L0/.test(p.id))ghost(child);
    }
    const ringGeometry=new THREE.TorusGeometry(32.6,1.3,8,64),ringMaterial=new THREE.MeshBasicMaterial({color:'#d69736'});
    geometries.add(ringGeometry);materials.add(ringMaterial);
    const ring=new THREE.Mesh(ringGeometry,ringMaterial);ring.position.set(50,250,110.4);cover.add(ring);
    let pipePosition=new THREE.Vector3();
    for(const item of state.items){
      const product=getProduct(item.productId),owner=new THREE.Group();owner.position.set(item.x,item.y,item.z);owner.rotation.z=THREE.MathUtils.degToRad(item.rotation);root.add(owner);
      for(const p of product.parts){const child=await part(p,item.productId==='pipe-down'?{...item.colors,DP01:'pine'}:item.colors,product.origin);owner.add(child);
        if(item.productId!=='pipe-down')ghost(child);
      }
      if(item.productId==='pipe-down'){pipe=owner;pipePosition=owner.position.clone();pipe.visible=false;}
    }
    bedding={bed,cover,pipe,pipePosition,ghosts,coverAnchor:anchor(cover,[50,250,110]),pipeAnchor:anchor(pipe,[0,0,-4])};
    bounds.push(new THREE.Box3(new THREE.Vector3(-50,-50,0),new THREE.Vector3(350,350,415)));
  }
  function opacity(material:THREE.Material,value:number){const transparent=value<.999;if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}material.opacity=value;material.depthWrite=!transparent;}
  function fit(box:THREE.Box3){
    box.getCenter(center);box.getSize(size);
    const halfAngle=Math.min(THREE.MathUtils.degToRad(camera.fov/2),Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect));
    camera.position.copy(center).addScaledVector(direction,size.length()/2*1.08/Math.sin(halfAngle));
    camera.lookAt(center);camera.updateMatrixWorld();light.centerAt(center.x,center.y);
  }
  const platformSteel=new THREE.Vector3(210,10,106.7),bedPoint=new THREE.Vector3(110,250,43);
  function paint(elapsed:number,reduced=false,still=false){
    lastElapsed=elapsed;lastReduced=reduced;if(lastStill!==still){lastStill=still;resize();return;}
    if(disposed||lost||!loaded||document.hidden||elapsed===lastPaint)return;
    if(lastPaint>=0&&elapsed-lastPaint>48)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>15&&pixelBudget>1){pixelBudget=1;slowFrames=0;resize();return;}lastPaint=elapsed;
    if(callout)callout.style.display='none';
    if(page===0){
      const phase=introductionPhase(0,elapsed),local=(elapsed-phase*2000)*2;
      groups.forEach((g,i)=>{g.visible=i===phase;g.position.z=i===phase&&!reduced?(1-ease(local/650))*-45:0;});
      if(active!==phase){active=phase;batches?.rebuild();}else if(local<700)batches?.refresh();
      fit(bounds[phase]);if(!reduced){camera.position.sub(center).applyAxisAngle(vertical,Math.sin(local/4000*Math.PI)*.09).add(center);camera.lookAt(center);}
    }else if(page===1&&bedding){
      const {cover,pipe,pipePosition,ghosts}=bedding;
      const t=reduced?Math.floor(elapsed/4000)*4000+3000:elapsed,insert=ease((t-4700)/1900);
      ghosts.forEach(m=>opacity(m,1-.85*ease((t-600)/900)));
      cover.position.set(0,0,0);cover.visible=t<3100;
      pipe.visible=t>=4400;pipe.position.copy(pipePosition);pipe.position.z+=(1-insert)*135;
      fit(bounds[0]);scene.updateMatrixWorld(true);
      if(t<4400)annotate(bedding.coverAnchor,'平台连通孔','',true);
      else if(t<8000)annotate(bedding.pipeAnchor,'向下连通管道','对准圆洞，向下安装',true);
      else annotate(bedPoint,'鼠鼠的秘密基地','',true);
    }else if(module){
      const {skin,items,positions,magnets,roofSteel,upperHouse}=module;
      const t=reduced?Math.floor(elapsed/2000)*4000+2600:elapsed*2;
      const lift=ease((t-3000)/1300)*(1-ease((t-7200)/1400));
      skin.position.set(-35*lift,35*lift,70*lift);
      items.forEach((g,i)=>{
        const upper=i===upperHouse,settle=ease((t-(upper?11500:8600))/1300);
        g.position.copy(positions[i]);g.position.z+=(1-settle)*(upper?110:120);
        g.rotation.x=-1.05*(1-ease((t-2800)/900))*(1-settle);magnets[i].visible=settle<.999;
      });
      roofSteel.visible=t>10200;fit(bounds[0]);scene.updateMatrixWorld(true);
      if(t<4000)annotate(module.magnet,'圆形强磁','内嵌在组件底部');
      else if(t<8000)annotate(platformSteel,'不锈钢铁片','平台内部密布吸附位',true);
      else if(t<11000)annotate(platformSteel,'磁吸固定','对准铁片，轻松吸附',true);
      else annotate(module.roof,'屋顶内嵌铁片','方糖小屋也能吸在上面',true);
    }
    renderer.render(scene,camera);
  }
  const resize=()=>{width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);annotations?.setAttribute('viewBox',`0 0 ${width} ${height}`);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,lastStill?2:pixelBudget,Math.sqrt(1200000/(width*height))));renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();active=-1;lastPaint=-1;paint(lastElapsed,lastReduced,lastStill);};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const contextLost=(event:Event)=>{event.preventDefault();lost=true;onStatus('3D 连接中断，请重试');};
  const restored=()=>{lost=false;lastPaint=-1;onStatus();paint(lastElapsed,lastReduced,lastStill);};
  renderer.domElement.addEventListener('webglcontextlost',contextLost);renderer.domElement.addEventListener('webglcontextrestored',restored);
  const ready=page===0?Promise.all(createIntroductionDesigns().map((d,i)=>assembly(d.state,i))):page===1?secretBase():modular();
  void ready.then(()=>{if(disposed)return;loaded=true;resize();paint(0);onStatus();}).catch(()=>{if(!disposed)onStatus('介绍模型加载失败，请重试');});
  return {paint,dispose(){disposed=true;observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',contextLost);renderer.domElement.removeEventListener('webglcontextrestored',restored);batches?.dispose();bedResource?.dispose();models.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
