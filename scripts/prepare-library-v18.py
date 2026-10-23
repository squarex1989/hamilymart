#!/usr/bin/env python3
"""Import approved assembly poses for the October library additions.

Source JSONs are assembly coordinates, never the side-standing print STL poses.
Compressed source meshes and metadata are retained for reproducible regeneration.
"""
from pathlib import Path
import hashlib, importlib.util, json, sys
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'bambu-output'
ARCHIVE = ROOT / 'model-sources/library-v18'
ARCHIVE.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('converter', ROOT / 'scripts/prepare-models.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)
index = json.loads((ROOT / 'src/data/model-index.json').read_text())
report = {}
products = []


def export(id, name, components, source):
    meshes, entries, checks = [], [], []
    for n, c in enumerate(components):
        original = trimesh.Trimesh(c['vertices'], c['faces'], process=True)
        assert original.is_watertight and original.is_winding_consistent, (id, n)
        np.savez_compressed(ARCHIVE / f'{id}-{n}.npz', vertices=original.vertices, faces=original.faces)
        mesh, stats = converter.simplified_mesh({'vertices': original.vertices, 'triangles': original.faces})
        # Do not accept simplification which damages the closed printable source.
        if not mesh.is_watertight or not mesh.is_winding_consistent:
            mesh = original
            stats = {'sourceTriangles': len(original.faces), 'triangles': len(original.faces), 'keptOriginal': True}
        meshes.append(mesh)
        entries.append({'id': f'{id}_{c.get("key", "Snow")}', 'color_key': c.get('key', 'Snow'), 'color': c.get('color', '#F1EADB')})
        checks.append(stats)
    path = ROOT / 'public/models' / f'{id}.glb'
    converter.write_glb(path, {'id': id, 'components': entries}, meshes)
    bounds = trimesh.util.concatenate(meshes).bounds.reshape(-1).tolist()
    index[id] = {'url': f'/models/{id}.glb', 'bounds': bounds, 'nameZh': name,
                 'components': [{'id': c['id'], 'colorKey': c['color_key'], 'color': c['color']} for c in entries]}
    report[id] = {'source': source, 'bounds': bounds, 'components': entries, 'checks': checks,
                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    print(id, sum(len(m.faces) for m in meshes), 'triangles', flush=True)
    return bounds


def read(relative):
    return json.loads((SOURCE / relative).read_text())


def part(id, role, color='cream'):
    return dict(id=id, role=role, defaultColor=color)


def product(id, sku, name, category, price, parts, origin, feet, boxes, **extra):
    products.append(dict(id=id, sku=sku, name=name, category=category, price=price,
        description=extra.pop('description', name+' · 磁吸安装'), parts=parts, origin=origin,
        bottomMagnets=[[x,y,0] for x,y in feet], collisionBoxes=boxes, **extra))


if '--from-archive' in sys.argv:
    archived = json.loads((ARCHIVE / 'manifest.json').read_text())
    for id, entry in archived.items():
        components = []
        for n, material in enumerate(entry['components']):
            with np.load(ARCHIVE / f'{id}-{n}.npz') as mesh:
                components.append({'vertices': mesh['vertices'], 'faces': mesh['faces'],
                                   'key': material['color_key'], 'color': material['color']})
        export(id, index[id]['nameZh'], components, entry['source'])
    for target in [ROOT/'src/data', ROOT/'minitool/src/data']:
        (target/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
    (ARCHIVE/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    sys.exit(0)


for j, (kind, folder, prefix) in enumerate([
    ('straight', 'rounded-stairs', '三阶圆角台阶'),
    ('right', 'spiral-corner-stairs', '弧线螺旋台阶_右出'),
    ('left', 'spiral-corner-stairs', '弧线螺旋台阶_左出'),
]):
    for k in range(2):
        height = 90
        source = f'unified-storey-90/{prefix}_90mm_mesh.json'
        id = f'RS{j+1}{k+1}'
        name = ('三阶圆角台阶' if kind=='straight' else ('右转弧形台阶' if kind=='right' else '左转弧形台阶'))
        bounds = export(id, name, [read(source)], source)
        feet = [[10,10],[90,90]] if kind=='right' else [[10,90],[90,10]]
        product(f'stairs-{kind}-{k+1}', f'HM-ST-00{j*2+k+1}', name, 'facility',1400,[part(id,'台阶')],
                [50,50,0],feet,[bounds],allowedParents=['base','l-house','cube-house','milk-house-left','milk-house-right','milk-house-double','milk-house-double-2x3'],description=f'三阶防滑圆角 · 占一格 · 高 {height/10:g} cm')

hardware = read('unified-storey-90/hardware.json')
house_defs = [
    ('奶糖左开口','milk-house-left','MCL',[[10,90],[190,90],[190,10]],100,50,'奶糖小屋·左开口',2900),
    ('奶糖右开口','milk-house-right','MCR',[[190,90],[10,90],[10,10]],100,50,'奶糖小屋·右开口',2900),
    ('四格双室','milk-house-double','MCD',[[10,190],[10,10],[190,10]],100,100,'奶糖二居室（2×2）',3900),
]
roof_parents = ['base','l-house','cube-house','milk-house-left','milk-house-right','milk-house-double','milk-house-double-2x3']
for i,(source_name,id,prefix,feet,ox,oy,name,price) in enumerate(house_defs):
    source = f'unified-storey-90/{source_name}_scene.json'
    cs = read(source)
    b = export(prefix+'B',name+'墙体',[cs[0]],source)
    r = export(prefix+'R',name+'顶盖',[{**cs[1], 'key': 'Gold'}],source)
    h = next(v for v in hardware if v['name']==source_name)
    surface = dict(id='roof',points=[[x,y,h['top_z']] for x,y in h['centers']],bounds=[2,2,h['top_z'],ox*2-2,oy*2-2,h['top_z']])
    product(id,f'HM-HS-00{5+i}',name,'house',price,[part(prefix+'B','墙体'),part(prefix+'R','顶盖','butter')],
            [ox,oy,0],feet,[[2,2,0,ox*2-2,oy*2-2,90]],surfaces=[surface],allowedParents=roof_parents,
            description='可拆顶盖 · 屋顶钢片支持叠放')
# Bring existing roof assets forward to the same approved steel-receiver revision.
for name,id in [('L型转角屋','LHR'),('方糖小屋','SHR')]:
    source=f'unified-storey-90/{name}_scene.json'
    export(id,name+'顶盖',[read(source)[1]],source)
    export('LHB' if id=='LHR' else 'SHB',name+'墙体',[{**read(source)[0], 'key':'PineGreen'}],source)

source='magnetic-sag-bridge/mesh.json'
bounds=export('BR01','下弯吊桥',[{**read(source),'color':'#2E85B8','key':'Sky'}],source)
product('sag-bridge','HM-FC-001','吊桥','facility',800,[part('BR01','桥面','sky')],[82,48,0],
        [[22,8],[22,88],[142,8],[142,88]],[bounds],minimumMagnetMatches=2,
        allowedParents=roof_parents[1:]+['villa'],supportMode='bridge',preciseCollisionBoxes=[[0,0,0,32,96,6.2],[32,0,-6,132,96,6.2],[132,0,0,164,96,6.2]],description='跨一格空隙 · 两端同高支撑 · 磁吸固定')

source='pokemon-center-rear-trim/scene.json'
cs=read(source)
for prefix,id,name in [('02_wall_ring','PCW','宝可梦中心墙体'),('03_roof','PCR','宝可梦中心屋顶')]:
    group=[{**c,'key':c['name'].split('__')[1]} for c in cs if c['name'].startswith(prefix)]
    primary='white' if id=='PCW' else 'red'
    group.sort(key=lambda c:c['key']!=primary)
    export(id,name,group,source)
product('pokemon-center','HM-HS-008','宝可梦中心','house',9900,[part('PCW','墙体','white'),part('PCR','屋顶','red')],
        [150,100,0],read('pokemon-center-restored/manifest.json')['magnet_centers_mm'],
        [[6.774,-7.99,0,293.221,199.9,151.357]],allowedParents=['base'],description='两格 × 三格 · 可拆多色屋顶与墙体')

# Physical corner-contact revision, retaining original bowl and gift-deck receivers.
for id,name in [('O01','方块食盆'),('A02','礼物盒二层平台')]:
    source=f'roof-accessories/{id}_scene.json'
    export(id,name,[{**c,'key':c['color_key']} for c in read(source)],source)

for target in [ROOT/'src/data',ROOT/'minitool/src/data']:
    (target/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
    (target/'library-v18.json').write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n')
(ARCHIVE/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(ARCHIVE/'roof-receivers.json').write_text(json.dumps(hardware,ensure_ascii=False,indent=2)+'\n')
