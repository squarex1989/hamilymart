"""Export the approved Aite assembly; preserve all existing serialized product indices."""
from pathlib import Path
import importlib.util,json,hashlib
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'bambu-output/milk-candy-house-aite'
ARCHIVE=ROOT/'model-sources/library-v18'
spec=importlib.util.spec_from_file_location('converter',ROOT/'scripts/prepare-models.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
index=json.loads((ROOT/'src/data/model-index.json').read_text())
manifest=json.loads((ARCHIVE/'manifest.json').read_text())
geometry=json.loads((SOURCE/'geometry_validation.json').read_text())
scene=json.loads((SOURCE/'scene.json').read_text())
for id,key,part in zip(['MCATB','MCATP','MCATR'],['Snow','Snow','Gold'],scene):
 m=trimesh.Trimesh(part['vertices'],part['faces'],process=True)
 assert m.is_watertight and m.is_winding_consistent
 np.savez_compressed(ARCHIVE/f'{id}-0.npz',vertices=m.vertices,faces=m.faces)
 mesh,stats=c.simplified_mesh({'vertices':m.vertices,'triangles':m.faces})
 if not mesh.is_watertight or not mesh.is_winding_consistent:mesh=m;stats={'keptOriginal':True}
 entry={'id':id+'_'+key,'color_key':key,'color':part['color']}
 out=ROOT/'public/models'/f'{id}.glb'
 c.write_glb(out,{'id':id,'components':[entry]},[mesh])
 bounds=m.bounds.reshape(-1).tolist()
 index[id]={'url':f'/models/{id}.glb','bounds':bounds,'nameZh':part['name'],'components':[{'id':entry['id'],'colorKey':key,'color':part['color']}]}
 manifest[id]={'source':'milk-candy-house-aite/scene.json','bounds':bounds,'components':[entry],'checks':[stats],'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
 print(id,len(mesh.faces),'triangles')
parents=['base','l-house','cube-house','milk-house-left','milk-house-right','milk-house-double','milk-house-aite']
product={'id':'milk-house-aite','sku':'HM-HS-010','name':'奶糖二居室（艾特）','category':'house','price':4900,
 'description':'30×18.6×10 cm · 门板左右翻转 · 无顶盖铁片',
 'parts':[{'id':'MCATB','role':'墙体','defaultColor':'cream'},{'id':'MCATP','role':'可翻转门板','defaultColor':'cream'},{'id':'MCATR','role':'顶盖','defaultColor':'butter'}],
 'origin':[150,93,0],'bottomMagnets':[[x,y,0]for x,y in geometry['magnet_centers']],
 'collisionBoxes':[[0,0,0,300,186,100]],'allowedParents':['base','milk-house-double-2x3']}
for dest in [ROOT/'src/data',ROOT/'minitool/src/data']:
 (dest/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
 (dest/'milk-house-aite.json').write_text(json.dumps(product,ensure_ascii=False,indent=2)+'\n')
 p=dest/'house-doorways.ts';s=p.read_text();line='  "milk-house-aite": [{ center: '+json.dumps([*geometry['outer_arch_right'],0])+', normal: [0,-1,0], depth: 50 }],\n'
 if '"milk-house-aite"' not in s:s=s.replace('  "pokemon-center":',line+'  "pokemon-center":')
 else:
  import re
  s=re.sub(r'^  "milk-house-aite":.*\n',line,s,flags=re.M)
 p.write_text(s)
(ARCHIVE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
