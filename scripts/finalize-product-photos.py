from pathlib import Path
import json,hashlib,zipfile,csv,shutil
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parents[2];A=R/'artifacts';O=A/'HamilyMart商品图片_20261021';S=R/'bambu-output/product-photos-20261021';d=json.loads((O/'图片清单.json').read_text());sources=json.loads((S/'模型版本来源.json').read_text())
products=sorted(d['products'].values(),key=lambda p:p['folder']);assert len(products)==d['expectedProductGroups']==30
modes=['preview','dimensions','exploded','exploded-reverse'];checks=[]
for p in products:
 assert set(p['images'])==set(modes)
 dims=p['images']['preview']['dimensionsCm']
 for mode in modes:
  v=p['images'][mode];f=O/v['file'];im=Image.open(f);im.verify();im=Image.open(f)
  assert im.size==(2400,2400) and im.format=='PNG'
  assert hashlib.sha256(f.read_bytes()).hexdigest()==v['sha256']
  assert v['dimensionsCm']==dims and v['assembledBoundsMm']==p['images']['preview']['assembledBoundsMm']
  assert len(v['labelTexts'])==(3 if mode=='dimensions' else 0)
  for part in v['sourcePartIds']:
   a=S/'models'/f'{part}.glb';assert hashlib.sha256(a.read_bytes()).hexdigest()==sources[part]['photo_asset_sha256']
  checks.append({'file':v['file'],'resolution':list(im.size),'sha256':v['sha256']})
 normal=p['images']['exploded']['cameraDirection'];rev=p['images']['exploded-reverse']['cameraDirection'];assert max(abs(normal[0]-rev[0]),abs(normal[1]-rev[1]),abs(normal[2]+rev[2]))<1e-8
 assert p['images']['exploded']['explosionGapMm']==(44 if p['id']=='pokemon-center' else 22)
assert len(checks)==120 and not d['browserErrors']
(O/'使用说明.txt').write_text('HamilyMart 商品图片｜2026-10-22 更新\n\n30组，共120张PNG；全部2400×2400像素、1:1、白色背景。\n每个文件夹4张：组装预览、长宽高标注、爆炸图、仰视爆炸图。\n尺寸标注为模型实际外包尺寸，单位cm，不包含垫料、笼子或爆炸间距。\n单体不可拆组件保留整体，爆炸图沿用小工具的组装分组。\n宝可梦中心四件屋顶保持组装，整顶爆炸间距44mm（其他22mm）。礼物盒丝带、五角星保留贴合。\n30_圣诞泳池小屋_整套 为含屋内向下连通管道的整套商品图。\n')
shutil.copy2(S/'模型版本来源.json',O/'模型版本来源.json')
with (O/'图片目录.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['商品','组装预览','长宽高标注','爆炸图','仰视爆炸图'])
 for p in products:w.writerow([p['name'],*[p['images'][m]['file'] for m in modes]])
QA=A/'商品图校验_20261021';QA.mkdir(exist_ok=True);font=ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc',19)
for n in range(5):
 im=Image.new('RGB',(1400,2250),'#f0f0f0');dr=ImageDraw.Draw(im)
 for y,p in enumerate(products[n*6:n*6+6]):
  for x,mode in enumerate(modes):
   b=Image.open(O/p['images'][mode]['file']);b.thumbnail((350,350));im.paste(b,(350*x,375*y));dr.text((350*x+6,375*y+351),p['name'],font=font,fill='black')
 im.save(QA/f'商品图总览_{n+1:02d}.jpg',quality=93)
(QA/'完整性校验.json').write_text(json.dumps({'groups':30,'png_count':120,'resolution':[2400,2400],'all_hashes_match':True,'underside_elevation_verified':True,'browser_errors':[],'images':checks},ensure_ascii=False,indent=2))
def zipdir(folder,target):
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in sorted(folder.rglob('*')):
   if p.is_file():z.write(p,str(p.relative_to(folder.parent)))
 with zipfile.ZipFile(target) as z:assert z.testzip() is None
 return {'file':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
zips=[zipdir(A/'宝可梦中心_小磁铁托_20261022',A/'宝可梦中心_小磁铁托_20261022.zip'),zipdir(O,A/'HamilyMart商品图片_2400px_四视图_20261021.zip'),zipdir(O/'30_圣诞泳池小屋_整套',A/'圣诞泳池小屋_四张商品图_20261021.zip'),zipdir(A/'宝可梦中心_四件屋顶_黑框套玻璃_20261021',A/'宝可梦中心_四件屋顶_黑框套玻璃_20261021.zip')]
(QA/'压缩包校验.json').write_text(json.dumps(zips,ensure_ascii=False,indent=2));print(json.dumps(zips,ensure_ascii=False,indent=2))
