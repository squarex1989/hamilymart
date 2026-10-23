"""Publish checked printable poses, not print-bed orientations, to both catalogs."""
from pathlib import Path
import importlib.util,json,hashlib,sys
import numpy as np,trimesh
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT.parent/'bambu-output/milk-reversible-panels';ARC=ROOT/'model-sources/library-v18'
spec=importlib.util.spec_from_file_location('converter',ROOT/'scripts/prepare-models.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
index=json.loads((ROOT/'src/data/model-index.json').read_text());manifest=json.loads((ARC/'manifest.json').read_text())
variants=[('aite','milk-house-aite',['MCATB','MCATP','MCATR']),('single','milk-house-right',['MCRB','MCRR','MCRP']),('double-2x2','milk-house-double',['MCDB','MCDR','MCDP']),('double-2x3','milk-house-double-2x3',['MC23B','MC23R','MC23P'])]
for folder,productId,ids in variants:
 if '--aite-only' in sys.argv and folder!='aite':continue
 source=SOURCE/folder;scene=json.loads((source/'scene.json').read_text());geometry=json.loads((source/'geometry_validation.json').read_text())
 for id,part in zip(ids,scene):
  m=trimesh.Trimesh(part['vertices'],part['faces'],process=True);assert m.is_watertight and m.is_winding_consistent
  np.savez_compressed(ARC/f'{id}-0.npz',vertices=m.vertices,faces=m.faces)
  key='Gold' if id.endswith('R') else 'Snow';entry={'id':id+'_'+key,'color_key':key,'color':part['color']}
  path=ROOT/'public/models'/f'{id}.glb';c.write_glb(path,{'id':id,'components':[entry]},[m])
  bounds=m.bounds.reshape(-1).tolist();index[id]={'url':f'/models/{id}.glb','bounds':bounds,'nameZh':part['name'],'components':[{'id':entry['id'],'colorKey':key,'color':part['color']}]}
  manifest[id]={'source':f'milk-reversible-panels/{folder}/scene.json','bounds':bounds,'components':[entry],'checks':[{'keptOriginal':True,'watertight':True}],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 for dest in [ROOT/'src/data',ROOT/'minitool/src/data']:
  filename='milk-house-aite.json' if folder=='aite' else 'milk-house-2x3.json' if folder=='double-2x3' else 'library-v18.json'
  p=dest/filename;data=json.loads(p.read_text());products=data if isinstance(data,list) else [data];product=next(v for v in products if v['id']==productId)
  product['parts']=[{'id':id,'role':'顶盖' if id.endswith('R') else '可翻转门板' if id.endswith('P') else '墙体','defaultColor':'butter' if id.endswith('R') else 'cream'}for id in ids]
  if folder=='single':product['name']='奶糖小屋'
  product['description']='可左右翻转门板 · 贯通卡槽 · 含盖高 10 cm'+(' · 无顶盖铁片' if folder=='aite' else ' · 屋顶铁片支持叠放')
  product['bottomMagnets']=[[*point[:2],0]for point in geometry['magnet_centers']]
  p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 print(folder, 'published', flush=True)
for dest in [ROOT/'src/data',ROOT/'minitool/src/data']:(dest/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
(ARC/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
