"""Import the approved 100 mm ribbed hanging elbow in assembly coordinates."""
from pathlib import Path
import json,importlib.util,hashlib
import numpy as np
import trimesh
import manifold3d as mf
R=Path(__file__).resolve().parents[1];D=R.parent/'bambu-output/platform-down-elbow-ribs';O=R/'model-sources/down-pipe';O.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('models',R/'scripts/prepare-models.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
source=json.loads((D/'scene.json').read_text())['part'] if (D/'scene.json').exists() else dict(np.load(O/'source.npz'))
m=trimesh.Trimesh(source['vertices'],source['faces'],process=True);assert m.is_watertight and m.is_winding_consistent
np.savez_compressed(O/'source.npz',vertices=m.vertices,faces=m.faces)
mesh,stats=mod.simplified_mesh({'vertices':m.vertices,'triangles':m.faces})
if not mesh.is_watertight:mesh=m
# Clean sub-micron edges before float32 GLB serialization; verify the reloaded
# topology, not just the higher-precision in-memory mesh.
solid_mesh=mf.Manifold(mf.Mesh64(np.asarray(mesh.vertices),np.asarray(mesh.faces,dtype=np.uint64)))
for epsilon in [.0001,.0005,.001]:
    q=solid_mesh.simplify(epsilon).to_mesh64()
    candidate=trimesh.Trimesh(np.asarray(q.vert_properties[:,:3],dtype=np.float32),q.tri_verts,process=True)
    if candidate.is_watertight and candidate.is_winding_consistent:
        mesh=candidate;stats['float32CleanupMm']=epsilon;stats['triangles']=len(mesh.faces);break
else:raise ValueError('Float32 export loses closed topology')
c={'id':'DP01_Snow','color_key':'Snow','color':'#F1EADB'};path=R/'public/models/DP01.glb';mod.write_glb(path,{'id':'DP01','components':[c]},[mesh])
check=trimesh.load(path,force='scene').to_geometry();check.merge_vertices();assert check.is_watertight and check.is_winding_consistent
# Slice the actual curved envelope: its wide collar exists only at platform height,
# not beside the legs at the bottom of the bend.
slices=[]
edges=m.vertices[m.edges_unique]
levels=[*range(-100,-9,5),-5,0]
for lo,hi in zip(levels,levels[1:]):
    points=[m.vertices[(m.vertices[:,2]>=lo-1e-5)&(m.vertices[:,2]<=hi+1e-5)]]
    for z in [lo,hi]:
        mask=(edges[:,0,2]-z)*(edges[:,1,2]-z)<0
        crossing=edges[mask]
        if len(crossing):
            t=(z-crossing[:,0,2])/(crossing[:,1,2]-crossing[:,0,2])
            points.append(crossing[:,0]+t[:,None]*(crossing[:,1]-crossing[:,0]))
    points=np.concatenate(points)
    if len(points):slices.append([float(points[:,0].min()),float(points[:,1].min()),lo,float(points[:,0].max()),float(points[:,1].max()),hi])
slices.append([-31.2,-31.2,0,31.2,31.2,10])
def solid(mesh):
 mesh.merge_vertices();return mf.Manifold(mf.Mesh64(np.asarray(mesh.vertices),np.asarray(mesh.faces,dtype=np.uint64)))
index=json.loads((R/'src/data/model-index.json').read_text())
legs=mf.Manifold.batch_boolean([solid(trimesh.load(R/f'public/models/L0{n}.glb',force='scene').to_geometry()) for n in range(1,5)],mf.OpType.Add)
pool=solid(trimesh.load(R/'public/models/B01.glb',force='scene').to_geometry())
tube=solid(m);fits={}
for cover in ['H01','H02','H03','H04','H05']:
 b=index[cover]['bounds'];x=(b[0]+b[3])/2;y=(b[1]+b[4])/2
 for angle in [0,90,180,270]:
  placed=tube.rotate((0,0,angle)).translate((x,y,110))
  fits[f'{cover}:{angle}']={'legClear':abs((placed^legs).volume())<.001,'poolClear':abs((placed^pool).volume())<.001}
for directory in ['src/data','minitool/src/data']:
 (R/directory/'down-pipe-fit.json').write_text(json.dumps(fits,indent=2)+'\n')
 (R/directory/'down-pipe-collision.json').write_text(json.dumps(slices,indent=2)+'\n')
 p=R/directory/'model-index.json';index=json.loads(p.read_text());index['DP01']={'url':'/models/DP01.glb','bounds':mesh.bounds.reshape(-1).tolist(),'nameZh':'向下连通管道','components':[{'id':'DP01_Snow','colorKey':'Snow','color':'#F1EADB'}]};p.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
report={'source':'down-pipe-60mm-20261022/scene.json:part','assemblyBounds':m.bounds.tolist(),'watertight':True,'stats':stats,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(O/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(stats)
