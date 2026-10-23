from pathlib import Path
import json,importlib.util,hashlib
import numpy as np,trimesh
R=Path(__file__).resolve().parents[1];D=R.parent/'bambu-output/fixed-door-compact-20261022';A=R/'model-sources/library-v18';idx=json.loads((R/'src/data/model-index.json').read_text());man=json.loads((A/'manifest.json').read_text())
s=importlib.util.spec_from_file_location('cv',R/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(s);s.loader.exec_module(cv)
for kind,productId,filename in [('single','milk-house-right','library-v18.json'),('2x2','milk-house-double','library-v18.json'),('2x3','milk-house-double-2x3','milk-house-2x3.json'),('aite','milk-house-aite','milk-house-aite.json')]:
 for side in ['right','left']:
  O=D/f'{kind}-{side}';scene=json.loads((O/'scene.json').read_text());g=json.loads((O/'geometry_validation.json').read_text())
  for c in scene:
   id=c['id'];id='MCLR' if kind=='single' and side=='left' and id=='MCRR' else id
   m=trimesh.Trimesh(c['vertices'],c['faces'],process=True);key='Gold' if id.endswith('R') else 'Snow';e=dict(id=id+'_'+key,color_key=key,color=c['color']);f=R/f'public/models/{id}.glb';cv.write_glb(f,dict(id=id,components=[e]),[m]);np.savez_compressed(A/f'{id}-0.npz',vertices=m.vertices,faces=m.faces);bounds=m.bounds.flatten().tolist();idx[id]=dict(url=f'/models/{id}.glb',bounds=bounds,nameZh=c['name'],components=[dict(id=e['id'],colorKey=key,color=c['color'])]);man[id]=dict(source=str((O/'scene.json').relative_to(R.parent)),bounds=bounds,components=[e],checks=[dict(watertight=m.is_watertight)],sha256=hashlib.sha256(f.read_bytes()).hexdigest())
  if side=='left' and kind!='single':continue
  p=R/'src/data'/filename;data=json.loads(p.read_text());products=data if isinstance(data,list) else [data];product=next(x for x in products if x['id']==('milk-house-left' if side=='left' else productId))
  product['name']=g['name']+('（左开门）' if side=='left' else '（右开门）');product['description']='固定门墙 · 含盖高 10 cm · '+('无顶盖铁片' if kind=='aite' else '屋顶铁片支持叠放');product['bottomMagnets']=g['magnet_centers'];ids=[c['id']for c in scene];ids=['MCLB','MCLR'] if kind=='single' and side=='left' else ids;product['parts']=[dict(id=id,role='顶盖' if id.endswith('R') else '墙体',defaultColor='butter' if id.endswith('R') else 'cream')for id in ids];p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(R/'src/data/model-index.json').write_text(json.dumps(idx,ensure_ascii=False,indent=2)+'\n');(A/'manifest.json').write_text(json.dumps(man,ensure_ascii=False,indent=2)+'\n')
print('Published 8 fixed-wall variants')
