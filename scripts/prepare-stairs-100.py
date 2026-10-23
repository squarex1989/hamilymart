from pathlib import Path
import json,hashlib,importlib.util,shutil
import numpy as np,trimesh
ROOT=Path(__file__).resolve().parents[1];D=ROOT.parent/'bambu-output/milk-candy-storey-100';ARC=ROOT/'model-sources/library-v18'
spec=importlib.util.spec_from_file_location('cv',ROOT/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(spec);spec.loader.exec_module(cv)
index=json.loads((ROOT/'src/data/model-index.json').read_text());manifest=json.loads((ARC/'manifest.json').read_text())
package=(ROOT.parent/'bambu-output/milk-candy-house-aite/package_3mf.py').read_text()
for j,name in enumerate(['三阶圆角台阶_100mm','弧线螺旋台阶_右出_100mm','弧线螺旋台阶_左出_100mm'],1):
 c=json.loads((D/(name+'_mesh.json')).read_text());m=trimesh.Trimesh(c['vertices'],c['faces'],process=True);assert m.is_watertight and m.is_winding_consistent
 for k in [1,2]:
  id=f'RS{j}{k}';np.savez_compressed(ARC/f'{id}-0.npz',vertices=m.vertices,faces=m.faces)
  entries=[{'id':e['id'],'color_key':e['colorKey'],'color':e['color']}for e in index[id]['components']]
  path=ROOT/f'public/models/{id}.glb';cv.write_glb(path,{'id':id,'components':entries},[m]);b=m.bounds.reshape(-1).tolist();index[id]['bounds']=b
  manifest[id]={'source':f'milk-candy-storey-100/{name}_mesh.json','bounds':b,'components':entries,'checks':[{'keptOriginal':True,'triangles':len(m.faces)}],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 id=f'RS{j}1';target=D/id;target.mkdir(exist_ok=True);(target/'print_parts').mkdir(exist_ok=True)
 stl=target/f'print_parts/{id}.stl';shutil.copyfile(D/(name+'.stl'),stl)
 (target/'embedded_hardware.json').write_text('[]')
 (target/'print_manifest.json').write_text(json.dumps({'schema_version':3,'units':'millimeter','groups':[{'id':id,'name':id,'name_zh':name,'support_auto':False,'allow_z_rotation':True,'components':[{'id':id+'_Snow','color':'#F1EADB','color_key':'Snow','stl':str(stl)}]}]},ensure_ascii=False,indent=2))
 (target/'package_3mf.py').write_text(package.replace("PROJECT_NAME = '奶糖二居室（艾特）_可翻转门板.3mf'",f"PROJECT_NAME = '{name}.3mf'").replace("SLICED_PROJECT_NAME = '奶糖二居室（艾特）_切片校验.3mf'",f"SLICED_PROJECT_NAME = '{name}_切片校验.3mf'"))
for folder in ['src/data','minitool/src/data']:
 (ROOT/folder/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
 p=ROOT/folder/'library-v18.json';data=json.loads(p.read_text())
 for product in data:
  if product['id'].startswith('stairs-'):
   for b in product['collisionBoxes']:b[5]=100
   product['description']=product['description'].replace('高 9 cm','高 10 cm')
 p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(ARC/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
