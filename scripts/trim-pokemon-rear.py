"""User-approved rear eave trim. Preserve magnet positions, joints and material parts."""
from pathlib import Path
import json,shutil,hashlib,importlib.util
import numpy as np,trimesh,manifold3d as mf
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT.parent/'bambu-output/pokemon-center-restored'
OUT=ROOT.parent/'bambu-output/pokemon-center-rear-trim'
LIMIT=199.9  # Original rear edge 201.605667; remove 1.705667 mm.
for folder in ['source','data','parts','projects','reports']: (OUT/folder).mkdir(parents=True,exist_ok=True)
shutil.copy2(SRC/'source/export_projects.py',OUT/'source/export_projects.py')
manifest=json.loads((SRC/'manifest.json').read_text());scene=json.loads((SRC/'scene.json').read_text());report=[]
for c in scene:
 name=c['name']; mesh=trimesh.Trimesh(c['vertices'],c['faces'],process=True)
 if name.startswith('03_roof'):
  solid=mf.Manifold(mf.Mesh64(np.asarray(mesh.vertices),np.asarray(mesh.faces,dtype=np.uint64)))
  assert solid.status()==mf.Error.NoError
  cut=solid ^ mf.Manifold.cube([1000,LIMIT+100,1000]).translate([-100,-100,-100])
  q=cut.to_mesh64();mesh=trimesh.Trimesh(np.asarray(q.vert_properties[:,:3]),np.asarray(q.tri_verts),process=True)
  assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0
  assert mesh.bounds[1,1]<=LIMIT+1e-6
  c['vertices']=mesh.vertices.tolist();c['faces']=mesh.faces.tolist()
  report.append({'part':name,'removed_mm3':solid.volume()-cut.volume(),'bounds':mesh.bounds.tolist(),'watertight':mesh.is_watertight})
 np.savez_compressed(OUT/'data'/f'{name}.npz',vertices=mesh.vertices,faces=mesh.faces)
 mesh.export(OUT/'parts'/f'{name}.stl')
for part in manifest['parts']:
 m=trimesh.load(SRC/'parts'/f'{part["name"]}.stl',force='mesh',process=True)
 if part['name'].startswith('03_roof'):
  solid=mf.Manifold(mf.Mesh64(np.asarray(m.vertices),np.asarray(m.faces,dtype=np.uint64)))
  assert solid.status()==mf.Error.NoError
  cut=solid ^ mf.Manifold.cube([1000,LIMIT+100,1000]).translate([-100,-100,-100])
  q=cut.to_mesh64();m=trimesh.Trimesh(np.asarray(q.vert_properties[:,:3]),np.asarray(q.tri_verts),process=True)
 assert m.is_watertight and m.is_winding_consistent
 m.export(OUT/'parts'/f'{part["name"]}.stl');part.update(bounds=m.bounds.tolist(),size_mm=m.extents.tolist(),volume_mm3=m.volume,watertight=True)
manifest['rear_eave_trim']={'max_y_mm':LIMIT,'original_max_y_mm':201.6056671142578,'magnets_unchanged':True}
(OUT/'scene.json').write_text(json.dumps(scene,ensure_ascii=False))
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(OUT/'reports/rear-trim.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
# Update the site's reproducible source archive and only PCR's GLB.
spec=importlib.util.spec_from_file_location('converter',ROOT/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(spec);spec.loader.exec_module(cv)
cs=sorted([c for c in scene if c['name'].startswith('03_roof')],key=lambda c:c['name'].split('__')[1]!='red')
meshes=[];entries=[];checks=[]
for i,c in enumerate(cs):
 key=c['name'].split('__')[1];original=trimesh.Trimesh(c['vertices'],c['faces'],process=True)
 np.savez_compressed(ROOT/f'model-sources/library-v18/PCR-{i}.npz',vertices=original.vertices,faces=original.faces)
 mesh,stats=cv.simplified_mesh({'vertices':original.vertices,'triangles':original.faces})
 if not mesh.is_watertight or mesh.bounds[1,1]>LIMIT+1e-4:mesh=original;stats={'keptOriginal':True}
 meshes.append(mesh);entries.append({'id':'PCR_'+key,'color_key':key,'color':manifest['palette'][key]});checks.append(stats)
path=ROOT/'public/models/PCR.glb';cv.write_glb(path,{'id':'PCR','components':entries},meshes)
bounds=trimesh.util.concatenate(meshes).bounds.reshape(-1).tolist()
for folder in ['src/data','minitool/src/data']:
 p=ROOT/folder/'model-index.json';index=json.loads(p.read_text());index['PCR']['bounds']=bounds;p.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
 p=ROOT/folder/'library-v18.json';catalog=json.loads(p.read_text());next(x for x in catalog if x['id']=='pokemon-center')['collisionBoxes'][0][4]=LIMIT;p.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
p=ROOT/'model-sources/library-v18/manifest.json';a=json.loads(p.read_text());a['PCR'].update(source='pokemon-center-rear-trim/scene.json',bounds=bounds,checks=checks,sha256=hashlib.sha256(path.read_bytes()).hexdigest());p.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
print(OUT);print('PCR bounds',bounds)
