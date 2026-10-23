"""Raise only milk houses to 100 mm, preserving doors, magnets, and rigid caps."""
from pathlib import Path
import json,hashlib,importlib.util
import numpy as np,trimesh,manifold3d as mf
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT.parent/'bambu-output/milk-candy-storey-100';OUT.mkdir(exist_ok=True)
ARC=ROOT/'model-sources/library-v18';index=json.loads((ROOT/'src/data/model-index.json').read_text());manifest=json.loads((ARC/'manifest.json').read_text())
spec=importlib.util.spec_from_file_location('cv',ROOT/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(spec);spec.loader.exec_module(cv)
hardware=json.loads((ROOT.parent/'bambu-output/unified-storey-90/hardware.json').read_text());reports={}
def solid(m):return mf.Manifold(mf.Mesh64(m.vertices,np.asarray(m.faces,dtype=np.uint64)))
variants=[('奶糖左开口',['MCLB','MCLR']),('奶糖右开口',['MCRB','MCRR']),('奶糖二居室（2×2）',['MCDB','MCDR']),('奶糖二居室（2×3）',['MC23B','MC23R'])]
for name,ids in variants:
 if ids[0]=='MC23B':
  src=ROOT.parent/'bambu-output/milk-candy-house-2x3/scene.json';h=json.loads((src.parent/'embedded_hardware.json').read_text())
 else:
  oldname='四格双室' if ids[0]=='MCDB' else name
  src=ROOT.parent/f'bambu-output/unified-storey-90/{oldname}_scene.json';hw=next(x for x in hardware if x['name']==oldname)
  h=[{'part':ids[1],'center_xy':xy,'pause_before_z':2.6,'steel_diameter_mm':12,'steel_depth_mm':2} for xy in hw['centers']]
 scene=json.loads(src.read_text());target=OUT/ids[0];target.mkdir(exist_ok=True);(target/'print_parts').mkdir(exist_ok=True)
 groups=[];meshes=[];delta=100-max(v[2] for v in scene[1]['vertices'])
 for i,(c,id) in enumerate(zip(scene,ids)):
  old=np.array(c['vertices'],dtype=float);v=old.copy()
  if i==0:
   # Door crown ends below 62 mm; no vertices inside this straight upper wall band.
   assert not np.any((v[:,2]>62)&(v[:,2]<70)),name
   v[:,2]+=delta*np.clip((v[:,2]-62)/8,0,1)
   assert np.array_equal(v[old[:,2]<=62],old[old[:,2]<=62])
  else:v[:,2]+=delta
  m=trimesh.Trimesh(v,c['faces'],process=True);assert m.is_watertight and m.is_winding_consistent
  c['vertices']=m.vertices.tolist();c['faces']=m.faces.tolist();meshes.append(m)
  np.savez_compressed(ARC/f'{id}-0.npz',vertices=m.vertices,faces=m.faces)
  entries=[{'id':e['id'],'color_key':e['colorKey'],'color':e['color']}for e in index[id]['components']]
  path=ROOT/f'public/models/{id}.glb';cv.write_glb(path,{'id':id,'components':entries},[m]);bounds=m.bounds.reshape(-1).tolist();index[id]['bounds']=bounds
  manifest[id]={'source':f'milk-candy-storey-100/{ids[0]}/scene.json','bounds':bounds,'components':entries,'checks':[{'keptOriginal':True,'triangles':len(m.faces)}],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
  printable=m.copy()
  if i:printable.apply_transform(trimesh.transformations.rotation_matrix(np.pi,[1,0,0]))
  printable.apply_translation(-printable.bounds[0]);stl=target/'print_parts'/f'{id}.stl';printable.export(stl)
  check=trimesh.load(stl,force='mesh');assert check.is_watertight and check.is_winding_consistent
  groups.append({'id':id,'name':id,'name_zh':name+('_顶盖' if i else '_墙体'),'support_auto':not bool(i),'allow_z_rotation':True,'components':[{'id':id+('_Gold' if i else '_Snow'),'color':'#C99B46' if i else '#F1EADB','color_key':'Gold' if i else 'Snow','stl':str(stl)}]})
 interference=(solid(meshes[0])^solid(meshes[1])).volume();assert abs(interference)<.01
 assert abs(meshes[1].bounds[1,2]-100)<.002
 (target/'scene.json').write_text(json.dumps(scene,ensure_ascii=False))
 (target/'embedded_hardware.json').write_text(json.dumps(h,indent=2))
 (target/'print_manifest.json').write_text(json.dumps({'schema_version':3,'units':'millimeter','groups':groups},ensure_ascii=False,indent=2))
 sc=trimesh.Scene()
 for i,m in enumerate(meshes):m.visual.vertex_colors=([245,224,187,255] if not i else [250,189,91,255]);sc.add_geometry(m)
 sc.export(target/'组装预览.glb')
 reports[name]={'size_mm':trimesh.util.concatenate(meshes).extents.tolist(),'roof_mm':100,'lid_underside_mm':96.6,'door_and_magnets_unchanged':True,'lid_translated_rigidly_mm':delta,'steel_count':len(h),'interference_mm3':interference,'watertight':True,'physical_tested':False}
 (target/'geometry_validation.json').write_text(json.dumps(reports[name],ensure_ascii=False,indent=2))
for d in ['src/data','minitool/src/data']:
 (ROOT/d/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
 for file in ['library-v18.json','milk-house-2x3.json']:
  path=ROOT/d/file;data=json.loads(path.read_text());products=data if isinstance(data,list) else [data]
  for product in products:
   if not product['id'].startswith('milk-house-'):continue
   for box in product['collisionBoxes']:box[5]=100
   for s in product.get('surfaces',[]):
    s['bounds'][2]=s['bounds'][5]=100
    for p in s['points']:p[2]=100
   product['description']=product['description'].replace('高 9 cm','高 10 cm')
  path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(ARC/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
p=ARC/'roof-receivers.json';hs=json.loads(p.read_text())
for h in hs:
 if h['name'] in ['奶糖左开口','奶糖右开口','四格双室']:h['top_z']=100
p.write_text(json.dumps(hs,ensure_ascii=False,indent=2)+'\n')
(OUT/'validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n');print(json.dumps(reports,ensure_ascii=False,indent=2))
