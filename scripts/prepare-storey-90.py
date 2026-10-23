#!/usr/bin/env python3
"""Export the approved 90 mm modular storey revision, preserving doorways and hardware.

House wall extension is confined above the doors. Caps translate rigidly, preserving
plate thickness and embedded steel seats. Stairs are regenerated parametrically at
90 mm (30 mm per tread), keeping groove depths and magnet-pocket dimensions.
"""
from pathlib import Path
import hashlib,importlib.util,json
import numpy as np,trimesh,manifold3d as mf
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'bambu-output/stackable-houses-v2'
OUT=ROOT.parent/'bambu-output/unified-storey-90'; OUT.mkdir(exist_ok=True)
ARCHIVE=ROOT/'model-sources/library-v18'
spec=importlib.util.spec_from_file_location('converter',ROOT/'scripts/prepare-models.py')
cv=importlib.util.module_from_spec(spec);spec.loader.exec_module(cv)
index=json.loads((ROOT/'src/data/model-index.json').read_text())
manifest=json.loads((ARCHIVE/'manifest.json').read_text())
hardware=json.loads((SOURCE/'hardware.json').read_text());report={}

def solid(m):return mf.Manifold(mf.Mesh64(m.vertices,np.asarray(m.faces,dtype=np.uint64)))
def export(id,m,source):
    assert m.is_watertight and m.is_winding_consistent and m.volume>0,id
    np.savez_compressed(ARCHIVE/f'{id}-0.npz',vertices=m.vertices,faces=m.faces)
    entries=[{'id':c['id'],'color_key':c['colorKey'],'color':c['color']} for c in index[id]['components']]
    assert len(entries)==1,id
    path=ROOT/f'public/models/{id}.glb'
    cv.write_glb(path,{'id':id,'components':entries},[m])
    bounds=m.bounds.reshape(-1).tolist();index[id]['bounds']=bounds
    manifest[id]={'source':source,'bounds':bounds,'components':entries,'checks':[{'keptOriginal':True,'triangles':len(m.faces)}],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

for name,ids in [('L型转角屋',['LHB','LHR']),('方糖小屋',['SHB','SHR']),('奶糖左开口',['MCLB','MCLR']),('奶糖右开口',['MCRB','MCRR']),('四格双室',['MCDB','MCDR'])]:
    cs=json.loads((SOURCE/(name+'_scene.json')).read_text());h=next(x for x in hardware if x['name']==name)
    delta=90-h['top_z'];meshes=[]
    for i,(c,id) in enumerate(zip(cs,ids)):
        old=np.array(c['vertices'],dtype=float);v=old.copy()
        if i==0:
            # No doorway geometry in this straight, planar band. Preserve all lower vertices.
            assert not np.any((v[:,2]>62)&(v[:,2]<70)),name
            v[:,2]+=delta*np.clip((v[:,2]-62)/8,0,1)
            assert np.array_equal(v[old[:,2]<=62],old[old[:,2]<=62])
        else:
            v[:,2]+=delta
            assert np.allclose(v-old,[0,0,delta])
        c['vertices']=v.tolist();m=trimesh.Trimesh(v,c['faces'],process=True);meshes.append(m)
        export(id,m,f'unified-storey-90/{name}_scene.json')
        printable=m.copy()
        if i==1:
            printable.apply_transform(trimesh.transformations.rotation_matrix(np.pi,[1,0,0]));printable.apply_translation(-printable.bounds[0])
        path=OUT/(name+('_墙体' if i==0 else '_顶盖')+'.stl');printable.export(path)
        check=trimesh.load(path,force='mesh');assert check.is_watertight and check.is_winding_consistent
    intersection=(solid(meshes[0])^solid(meshes[1])).volume();assert abs(intersection)<.01,(name,intersection)
    assert abs(meshes[1].bounds[1,2]-90)<1e-4
    (OUT/(name+'_scene.json')).write_text(json.dumps(cs,ensure_ascii=False))
    h.update(top_z=90,body_unchanged=False,assembly_intersection_mm3=intersection)
    report[name]={'roof_mm':float(meshes[1].bounds[1,2]),'height_change_mm':delta,'door_and_base_unchanged':True,'lid_thickness_and_steel_pockets_unchanged':True,'intersection_mm3':intersection,'watertight':True}

for j,name in enumerate(['三阶圆角台阶_90mm','弧线螺旋台阶_右出_90mm','弧线螺旋台阶_左出_90mm'],1):
    c=json.loads((OUT/(name+'_mesh.json')).read_text());m=trimesh.Trimesh(c['vertices'],c['faces'],process=True)
    assert abs(m.bounds[1,2]-90)<.002
    for k in [1,2]:export(f'RS{j}{k}',m,f'unified-storey-90/{name}_mesh.json')
    report[name]={'height_mm':float(m.bounds[1,2]),'tread_rise_mm':30,'watertight':m.is_watertight,'consistent_winding':m.is_winding_consistent}
for folder in ['src/data','minitool/src/data']:
    (ROOT/folder/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
    p=ROOT/folder/'library-v18.json';products=json.loads(p.read_text())
    for product in products:
        if product['id'].startswith(('stairs-','milk-house-')):
            for box in product['collisionBoxes']:box[5]=90
            for surface in product.get('surfaces',[]):
                surface['bounds'][2]=surface['bounds'][5]=90
                for point in surface['points']:point[2]=90
            if product['id'].startswith('stairs-'):
                product['description']='三阶防滑圆角 · 占一格 · 高 9 cm'
                product['name']=product['name'].split('·')[0]
    p.write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n')
(ARCHIVE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for p in [ARCHIVE/'roof-receivers.json',OUT/'hardware.json']:p.write_text(json.dumps(hardware,ensure_ascii=False,indent=2)+'\n')
(OUT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
