import trimesh,numpy as np,manifold3d as mf
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
import os
os.chdir(ROOT)
cases={'MCATB':[[20,8,0,135,166,12],[165,8,0,280,166,12]],'MC23B':[[15,15,0,85,285,12],[115,22,0,185,278,12]],'PCW':[[x-32,y-32,0,x+32,y+32,12] for x in [50,150,250] for y in [50,150]],'MCLB':[[15,15,0,185,85,12]],'MCRB':[[15,15,0,185,85,12]],'MCDB':[[15,15,0,85,185,12],[115,22,0,185,178,12]],'SHB':[[16,16,0,84,84,12]],'LHB':[[20,20,0,80,180,12],[20,120,0,180,180,12]],'G03':[[53,209,200,113,269,212]],'A01':[[16,216,110,84,284,122],[116,216,110,184,284,122]]}
names={'MCATB':'milk-house-aite','MC23B':'milk-house-double-2x3','PCW':'pokemon-center','MCLB':'milk-house-left','MCRB':'milk-house-right','MCDB':'milk-house-double','SHB':'cube-house','LHB':'l-house','G03':'roof-cottage','A01':'villa'}
for new,old,name in [('MCDLB','MCDB','milk-house-double-left'),('MC23LB','MC23B','milk-house-double-2x3-left'),('MCATLB','MCATB','milk-house-aite-left')]:
 cases[new]=cases[old];names[new]=name
report={}
for id,boxes in cases.items():
 files=list(Path('model-sources/library-v18').glob(id+'-*.npz'));ss=[]
 if files:
  for p in files:
   x=np.load(p);m=trimesh.Trimesh(x['vertices'],x['faces'],process=True);ss.append(m)
 else:
  g=trimesh.load('public/models/'+id+'.glb',force='scene').to_geometry();ss=[trimesh.Trimesh(g.vertices,g.faces,process=True)]
 solids=[mf.Manifold(mf.Mesh64(np.asarray(m.vertices),np.asarray(m.faces,dtype=np.uint64))) for m in ss]
 assert all(s.status()==mf.Error.NoError for s in solids), id
 sol=mf.Manifold.batch_boolean(solids,mf.OpType.Add)
 verified=[]
 for box in boxes:
  a=np.array(box[:3]);b=np.array(box[3:]);volume=(sol^mf.Manifold.cube(b-a).translate(a)).volume()
  if abs(volume)>=1e-5 and id=='PCW':
   box=[box[0]+5,box[1]+5,box[2],box[3]-5,box[4]-5,box[5]]
   a=np.array(box[:3]);b=np.array(box[3:]);volume=(sol^mf.Manifold.cube(b-a).translate(a)).volume()
  assert abs(volume)<1e-5,(id,box,volume)
  verified.append(box)
 report[names[id]]=verified

for folder in ['src/data','minitool/src/data']:
 (ROOT/folder/'house-pipe-clearances.json').write_text(json.dumps(report,indent=2)+'\n')
print('Verified empty low-level pipe clearances for',len(report),'houses')
