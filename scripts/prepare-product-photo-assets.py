"""Freeze current catalog assets and overlay newer, verified printable CAD revisions."""
from pathlib import Path
import importlib.util,json,hashlib,shutil
import numpy as np,trimesh
R=Path(__file__).resolve().parents[2];W=R/'hamilymart';O=R/'bambu-output/product-photos-20261021';A=O/'models';A.mkdir(parents=True,exist_ok=True)
s=importlib.util.spec_from_file_location('cv',W/'scripts/prepare-models.py');cv=importlib.util.module_from_spec(s);s.loader.exec_module(cv)
provenance={}
for p in (W/'public/models').glob('*.glb'):
 shutil.copy2(p,A/p.name);provenance[p.stem]={'source':str(p.relative_to(R)),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'revision':'current-catalog'}
def write(id,ms,entries,source):
 cv.write_glb(A/f'{id}.glb',{'id':id,'components':entries},ms);provenance[id]={'source':source,'revision':'latest-printable-CAD','bounds':trimesh.util.concatenate(ms).bounds.tolist()}
def entry(id,key,color):return {'id':id+'_'+key,'color_key':key,'color':color}
for id in ['P01','H06']:
 p=R/f'bambu-output/platform-steel-22-cap06/{id}_assembly.glb';m=trimesh.load(p).to_geometry();write(id,[m],[entry(id,'Snow','#F1EADB')],str(p.relative_to(R)))
# New reversible milk models, with the corrected rear seats on Aite.
for folder,ids in [('milk-reversible-panels/single',['MCRB','MCRR','MCRP']),('milk-reversible-panels/double-2x2',['MCDB','MCDR','MCDP']),('milk-reversible-panels/double-2x3',['MC23B','MC23R','MC23P']),('aite-rear-magnet-fix',['MCATB','MCATP','MCATR'])]:
 p=R/'bambu-output'/folder/'scene.json'
 for id,c in zip(ids,json.loads(p.read_text())):
  write(id,[trimesh.Trimesh(c['vertices'],c['faces'])],[entry(id,'Gold' if id.endswith('R') else 'Snow',c['color'])],str(p.relative_to(R)))
# Glue-on gift ornaments and two-ended magnetic pillars stay in assembled positions.
p=R/'bambu-output/gift-house-glue-magnetic/组装预览.glb';sc=trimesh.load(p);gift={}
for n in sc.graph.nodes_geometry:
 T,g=sc.graph[n];m=sc.geometry[g].copy();m.apply_transform(T);m.apply_translation([0,0,110]);gift[n]=m
for id in ['A01','A02','W01','W02','G15','G16','G17']:
 names=[n for n in gift if n.startswith(id+'_')]
 if id=='A01':names+=['RIBBON_Gold','STAR_ChristmasRed']
 es=[]
 for n in names:
  key=n.split('_')[-1];es.append(entry(id,key,{'Snow':'#F1EADB','Gold':'#C99B46','ChristmasRed':'#B8273C','PineGreen':'#174A3A'}[key]))
 write(id,[gift[n] for n in names],es,str(p.relative_to(R)))
# Recover the original print-to-assembly transform of G05; the latest source meshes
# use this same local frame, independently of their new bed orientations.
T=trimesh.transformations.euler_matrix(0,-np.pi/2,0);old=trimesh.util.concatenate([gift['G05_Snow'],gift['G05_ChristmasRed']]);old.apply_transform(T);lo=old.bounds[0];inv=np.linalg.inv(T)
ms=[];es=[]
for name,key in [('G05R_round','ChristmasRed'),('G05W_through_scarf','Snow')]:
 p=R/f'bambu-output/gift-stair-rib45/assembly_parts/{name}.stl';m=trimesh.load(p);m.apply_translation(lo);m.apply_transform(inv);ms.append(m);es.append(entry('G05',key,'#B8273C' if key=='ChristmasRed' else '#F1EADB'))
write('G05',ms,es,'bambu-output/gift-stair-rib45/assembly_parts + inverse original G05 print pose')
p=R/'bambu-output/pokemon-roof-black-frame/photo-assets/PCR.glb';shutil.copy2(p,A/'PCR.glb');provenance['PCR']={'source':str(p.relative_to(R)),'revision':'four-piece-roof-independent-black-frame-around-blue-glass'}
p=R/'bambu-output/pokemon-compact-magnets/scene.json'
cs=json.loads(p.read_text());write('PCW',[trimesh.Trimesh(c['vertices'],c['faces']) for c in cs],[entry('PCW',c['name'].split('__')[-1],c['color']) for c in cs],str(p.relative_to(R)))
for id,item in provenance.items():
 item['photo_asset_sha256']=hashlib.sha256((A/f'{id}.glb').read_bytes()).hexdigest()
(O/'模型版本来源.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2));print(A)
