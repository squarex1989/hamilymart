#!/usr/bin/env python3
"""Derive 300 mm preview legs by extending only the shaft of the source 200 mm legs.
Keeps the upper magnetic seat and both end profiles rigid. Does not alter the source 3MF.
"""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('web_models', ROOT / 'scripts/prepare-models.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)
source_bytes = converter.DEFAULT_SOURCE.read_bytes()
source = json.loads(source_bytes)
index_file = ROOT / 'src/data/model-index.json'
validation_file = ROOT / 'public/models/validation.json'
index = json.loads(index_file.read_text())
validation = json.loads(validation_file.read_text())
for n in range(1, 5):
    old_id, new_id = f'X0{n}', f'Y0{n}'
    group = copy.deepcopy(next(g for g in source['groups'] if g['id'] == old_id))
    group['id'] = new_id
    group['name_zh'] = f'30cm支撑脚{n}'
    for component in group['components']:
        component['id'] = component['id'].replace(old_id, new_id)
        vertices = np.asarray(component['vertices'], dtype=float)
        z = vertices[:, 2]
        # Lower 12 mm and upper 20 mm remain exact rigid source geometry.
        extension = np.clip((80 - z) / 168, 0, 1) * 100
        vertices[:, 2] -= extension
        component['vertices'] = vertices.tolist()
    meshes, checks = [], []
    for component in group['components']:
        mesh, stats = converter.simplified_mesh(component)
        assert mesh.is_watertight, new_id
        meshes.append(mesh)
        checks.append({'id': component['id'], **stats})
    bounds = np.array([mesh.bounds for mesh in meshes])
    group['assembly_bounds_mm'] = [*bounds[:, 0].min(axis=0).tolist(), *bounds[:, 1].max(axis=0).tolist()]
    assert abs(group['assembly_bounds_mm'][5] - group['assembly_bounds_mm'][2] - 300) < .001
    file = ROOT / 'public/models' / f'{new_id}.glb'
    converter.write_glb(file, group, meshes)
    index[new_id] = {'url': f'/models/{new_id}.glb', 'bounds': group['assembly_bounds_mm'], 'components': [{'id': c['id'], 'colorKey': c['color_key'], 'color': c['color']} for c in group['components']], 'nameZh': group['name_zh']}
    validation['groups'][new_id] = {'bytes': file.stat().st_size, 'components': checks, 'source': {'sourceDirectory': converter.DEFAULT_SOURCE.parent.name, 'sourceVersion': source['version'], 'sourceSha256': hashlib.sha256(source_bytes).hexdigest(), 'derivedFrom': old_id, 'derivation': 'Extend shaft by 100 mm between z=-88 and z=80; preserve both end profiles', 'production3mfIncluded': False}}
    print(new_id, group['assembly_bounds_mm'], 'watertight')
index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
validation_file.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
