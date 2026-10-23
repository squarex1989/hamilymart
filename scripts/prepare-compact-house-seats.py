from pathlib import Path
import json,importlib.util,hashlib,shutil
import numpy as np,trimesh
R=Path(__file__).resolve().parents[1];D=R.parent/'bambu-output';A=R/'model-sources/library-v18';idx=json.loads((R/'src/data/model-index.json').read_text());man=json.loads((A/'manifest.json').read_text())
s=importlib.util.spec_from_file_location('cv',R/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(s);s.loader.exec_module(cv)
def publish(id,ms,es,source):
 f=R/f'public/models/{id}.glb';cv.write_glb(f,dict(id=id,components=es),ms);bounds=trimesh.util.concatenate(ms).bounds.flatten().tolist();idx[id]=dict(url=f'/models/{id}.glb',bounds=bounds,nameZh=idx[id]['nameZh'],components=[dict(id=e['id'],colorKey=e['color_key'],color=e['color'])for e in es]);man[id]=dict(source=source,bounds=bounds,components=es,sha256=hashlib.sha256(f.read_bytes()).hexdigest())
 for i,m in enumerate(ms):np.savez_compressed(A/f'{id}-{i}.npz',vertices=m.vertices,faces=m.faces)
cs=json.loads((D/'pokemon-compact-magnets/scene.json').read_text());publish('PCW',[trimesh.Trimesh(c['vertices'],c['faces'])for c in cs],[dict(id='PCW_'+c['name'].split('__')[-1],color_key=c['name'].split('__')[-1],color=c['color'])for c in cs],'pokemon-compact-magnets/scene.json')
cs=json.loads((D/'fixed-door-compact-20261022/gift/scene.json').read_text());ms=[trimesh.Trimesh(cs[0]['vertices'],cs[0]['faces'])];es=[dict(id='A01_PineGreen',color_key='PineGreen',color='#174A3A')]
sc=trimesh.load(D/'gift-house-glue-magnetic/组装预览.glb')
for name,key,color in [('RIBBON_Gold','Gold','#C99B46'),('STAR_ChristmasRed','ChristmasRed','#B8273C')]:
 T,g=sc.graph[name];m=sc.geometry[g].copy();m.apply_transform(T);m.apply_translation([0,0,110]);ms.append(m);es.append(dict(id='A01_'+key,color_key=key,color=color))
publish('A01',ms,es,'fixed-door-compact-20261022/gift/scene.json + unchanged glue ornaments')
for id in ['MCRP','MCDP','MC23P','MCATP']:
 f=R/f'public/models/{id}.glb';dest=D/f'fixed-door-compact-20261022/legacy-panel-assets/{id}.glb';dest.parent.mkdir(exist_ok=True)
 if f.exists():shutil.move(f,dest)
 idx.pop(id,None)
(R/'src/data/model-index.json').write_text(json.dumps(idx,ensure_ascii=False,indent=2)+'\n');(A/'manifest.json').write_text(json.dumps(man,ensure_ascii=False,indent=2)+'\n')
