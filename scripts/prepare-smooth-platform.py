from pathlib import Path
import importlib.util,json,hashlib
import numpy as np,trimesh
R=Path(__file__).resolve().parents[1];D=R.parent/'bambu-output/platform-64-20261022';idx=json.loads((R/'src/data/model-index.json').read_text());s=importlib.util.spec_from_file_location('cv',R/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(s);s.loader.exec_module(cv)
for id in ['P01','H01','H02','H03','H04','H05','H06']:
 p=D/'63_全开/print_parts/P01.stl' if id=='P01' else D/f'editor/{id}.stl';m=trimesh.load(p)
 if id=='P01':m.apply_translation([0,0,100])
 assert m.is_watertight
 e=dict(id=id+'_Snow',color_key='Snow',color='#F1EADB');cv.write_glb(R/f'public/models/{id}.glb',dict(id=id,components=[e]),[m]);idx[id]['bounds']=np.round(m.bounds.flatten(),3).tolist();idx[id]['components']=[dict(id=e['id'],colorKey='Snow',color=e['color'])]
for dest in ['src/data','minitool/src/data']:(R/dest/'model-index.json').write_text(json.dumps(idx,ensure_ascii=False,indent=2)+'\n')
