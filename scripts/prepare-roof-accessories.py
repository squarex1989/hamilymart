#!/usr/bin/env python3
"""Add a corner bowl magnet and a real standard-grid receiver to the gift deck.

All coordinates are assembly mm. Original contacts, outlines and material parts
are retained; source files stay read-only. Archive meshes reproduce the website.
"""
from pathlib import Path
import hashlib, importlib.util, json
import numpy as np
import trimesh
import manifold3d as mf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / 'bambu-output/roof-accessories'; OUT.mkdir(exist_ok=True)
ARCHIVE = ROOT / 'model-sources/library-v18'
SOURCE = Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v17/assembly_meshes.json')
spec = importlib.util.spec_from_file_location('converter', ROOT/'scripts/prepare-models.py')
cv = importlib.util.module_from_spec(spec); spec.loader.exec_module(cv)
data = json.loads(SOURCE.read_text())
index = json.loads((ROOT/'src/data/model-index.json').read_text())
manifest = json.loads((ARCHIVE/'manifest.json').read_text())
report = {}

def solid(m):
    return mf.Manifold(mf.Mesh64(m.vertices, np.asarray(m.faces, dtype=np.uint64)))

for id, center, radius, bottom, top, title in [
    ('O01', [249,288], 4.05, 199.9, 202.1, '方块食盆_通用边角磁吸'),
    ('A02', [210,290], 6.1, 197.6, 199.6, '礼物盒二层平台_通用钢片位'),
]:
    group = next(g for g in data['groups'] if g['id'] == id)
    meshes = [trimesh.Trimesh(c['vertices'], c['triangles'], process=True) for c in group['components']]
    old = meshes[0]
    cutter = mf.Manifold.cylinder(top-bottom, radius, radius, 128).translate([*center,bottom])
    result = (solid(old)-cutter).to_mesh64()
    meshes[0] = trimesh.Trimesh(result.vert_properties[:,:3], result.tri_verts, process=True)
    new = meshes[0]
    assert new.is_watertight and new.is_winding_consistent and new.volume > 0
    assert np.allclose(new.bounds, old.bounds)
    expected = float(cutter.volume()) * ((2.1/2.2) if id=='O01' else 1)
    removed = old.volume-new.volume
    assert abs(removed-expected) < .001, (id, removed, expected)
    # Pocket is not a through-hole. Check the full circular ceiling, not only its center.
    ceiling = np.array([[center[0]+r*np.cos(a),center[1]+r*np.sin(a),top+.1]
                        for r in [0,radius*.99] for a in np.linspace(0,2*np.pi,65)])
    assert np.all(new.contains(ceiling)), id
    if id=='A02':
        assert np.all(new.contains(ceiling-[0,0,2.2])), 'steel pocket must remain fully sealed'
    entries = [{k:c[k] for k in ['id','color_key','color']} for c in group['components']]
    cv.write_glb(ROOT/f'public/models/{id}.glb', {'id':id,'components':entries}, meshes)
    scene = []
    for n,(m,c) in enumerate(zip(meshes,entries)):
        np.savez_compressed(ARCHIVE/f'{id}-{n}.npz', vertices=m.vertices, faces=m.faces)
        scene.append({**c,'vertices':m.vertices.tolist(),'faces':m.faces.tolist()})
    (OUT/f'{id}_scene.json').write_text(json.dumps(scene, ensure_ascii=False))
    bounds = trimesh.util.concatenate(meshes).bounds.reshape(-1).tolist()
    assert np.allclose(index[id]['bounds'], bounds)
    index[id]['nameZh'] = title
    manifest[id] = {'source':f'roof-accessories/{id}_scene.json','bounds':bounds,
        'components':entries,'checks':[{'keptOriginal':True,'triangles':len(m.faces)} for m in meshes],
        'sha256':hashlib.sha256((ROOT/f'public/models/{id}.glb').read_bytes()).hexdigest()}
    # Shared translation preserves the multi-color rim's height in the bowl.
    print_meshes = [m.copy() for m in meshes]
    if id=='A02':
        # Deck prints upside down, long axis along Y on the H2C bed.
        rx=trimesh.transformations.rotation_matrix(np.pi,[1,0,0])
        rz=trimesh.transformations.rotation_matrix(np.pi/2,[0,0,1])
        for m in print_meshes:m.apply_transform(rz@rx)
    offset=trimesh.util.concatenate(print_meshes).bounds[0]
    for n,m in enumerate(print_meshes):
        m.apply_translation(-offset); m.export(OUT/f'{id}-{n}.stl')
    report[id] = {'title':title,'bounds_mm':bounds,'new_contact_mm':[*center,200],
        'pocket_diameter_mm':radius*2,'pocket_z_mm':[max(bottom,200) if id=='O01' else bottom,top],
        'hardware_mm':[8,2] if id=='O01' else [12,2],
        'old_contacts_preserved':True,'watertight':True,'removed_mm3':removed,
        'ceiling_intact':True,'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest()}

(ARCHIVE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for target in ['src/data','minitool/src/data']:
    (ROOT/target/'model-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
(OUT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(ARCHIVE/'roof-accessory-hardware.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
