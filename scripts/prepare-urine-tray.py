"""Export the approved 130 mm circular-entry tray, facing the catalog camera.
Only an orthogonal XY rotation/translation is applied; no resizing or height change.
"""
from pathlib import Path
import hashlib,importlib.util,json
import numpy as np,trimesh
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT.parent/'bambu-output/urine-tray-rounded';ARC=ROOT/'model-sources/library-v18'
spec=importlib.util.spec_from_file_location('cv',ROOT/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(spec);spec.loader.exec_module(cv)
m=trimesh.load(SOURCE/'print_parts/UT01.stl',force='mesh');assert m.is_watertight and m.is_winding_consistent
# Right-angle corner becomes the back-left corner. Curved low entry faces +X/-Y.
m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2,[0,0,1]));m.apply_translation([0,130,0])
assert np.allclose(m.extents,[130,130,90],atol=.02)
np.savez_compressed(ARC/'UT01-0.npz',vertices=m.vertices,faces=m.faces)
preview,stats=cv.simplified_mesh({'vertices':m.vertices,'triangles':m.faces})
assert preview.is_watertight and preview.is_winding_consistent
entry={'id':'UT01_Snow','color_key':'Snow','color':'#F1EADB'};out=ROOT/'public/models/UT01.glb';cv.write_glb(out,{'id':'UT01','components':[entry]},[preview])
loaded=trimesh.load(out,force='mesh');loaded.merge_vertices();assert loaded.is_watertight and loaded.is_winding_consistent
for dest in [ROOT/'src/data',ROOT/'minitool/src/data']:
 p=dest/'model-index.json';index=json.loads(p.read_text());index['UT01']={'url':'/models/UT01.glb','bounds':m.bounds.reshape(-1).tolist(),'nameZh':'尿砂盆（艾特）','components':[{'id':'UT01_Snow','colorKey':'Snow','color':'#F1EADB'}]};p.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
p=ARC/'manifest.json';j=json.loads(p.read_text());j['UT01']={'source':'urine-tray-rounded/print_parts/UT01.stl','bounds':m.bounds.reshape(-1).tolist(),'components':[entry],'checks':[stats],'sha256':hashlib.sha256(out.read_bytes()).hexdigest()};p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=ROOT/'public/models/validation.json';j=json.loads(p.read_text());j['groups']['UT01']={'bytes':out.stat().st_size,'components':[{'id':entry['id'],**stats}],'source':{'sourceDirectory':'urine-tray-rounded','source':'print_parts/UT01.stl','sourceSha256':hashlib.sha256((SOURCE/'print_parts/UT01.stl').read_bytes()).hexdigest(),'orthogonalTransformOnly':True}};p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'triangles':len(preview.faces),'sourceTriangles':len(m.faces),'size_mm':m.extents.tolist(),'source_bytes':out.stat().st_size,'quality':stats},indent=2))
