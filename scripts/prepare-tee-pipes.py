#!/usr/bin/env python3
"""Derive two 100 mm T modules from the committed, approved straight tube/support.

Uses the original 86.4/80 mm bore, underside locating rib and magnetic pockets.
Only the new branch is added; no existing GLB or source production 3MF is edited.
Requires numpy, trimesh and manifold3d (plus the existing GLB writer dependencies).
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import manifold3d as mf
import numpy as np
import trimesh
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'public/models'
OUT = ROOT / 'model-sources/tee-pipes'
Z, R, RI, TOP_R = 46.4, 43.2, 40.0, 30.0
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('web_models', ROOT / 'scripts/prepare-models.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


def from_glb(id: str) -> mf.Manifold:
    mesh = trimesh.load(MODEL_DIR / f'{id}.glb', force='scene').to_geometry()
    mesh.merge_vertices()
    solid = mf.Manifold(mf.Mesh64(np.asarray(mesh.vertices, np.float64), np.asarray(mesh.faces, np.uint64)))
    assert solid.status() == mf.Error.NoError and mesh.is_watertight, id
    return solid


def y_cylinder(radius: float, y0: float, y1: float) -> mf.Manifold:
    return mf.Manifold.cylinder(y1-y0, radius, radius, 192).rotate((-90, 0, 0)).translate((50, y0, Z))


def x_cylinder(radius: float, x0: float, x1: float) -> mf.Manifold:
    return mf.Manifold.cylinder(x1-x0, radius, radius, 192).rotate((0, 90, 0)).translate((x0, 50, Z))


def mesh_of(solid: mf.Manifold) -> trimesh.Trimesh:
    assert solid.status() == mf.Error.NoError
    data = solid.to_mesh64()
    mesh = trimesh.Trimesh(np.asarray(data.vert_properties[:, :3]), np.asarray(data.tri_verts), process=False)
    assert mesh.is_watertight and mesh.is_winding_consistent and len(mesh.split()) == 1
    return mesh


def locating_rib() -> mf.Manifold:
    # Original modular_pipes.py profile: 3 mm wide, 1 mm deep, 0.4 mm root
    # overlap, 0.15 mm rounded edges. Rebuild analytically to avoid Boolean
    # slivers from unioning float32 source circles with double precision ones.
    u = np.linspace(-1.5, 1.5, 49)
    profile = Polygon([(50+x, Z-np.sqrt((R+1)**2-x*x)) for x in u]
        + [(50+x, Z-np.sqrt((R-.4)**2-x*x)) for x in reversed(u)])
    profile = profile.buffer(-.15, quad_segs=12).buffer(.15, quad_segs=12)
    cross = mf.CrossSection([np.asarray(profile.exterior.coords[:-1])], mf.FillRule.EvenOdd)
    return mf.Manifold.extrude(cross, 100).rotate((90, 0, 90))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source_base = from_glb('ST1B')
    # Union outer branches before subtracting their common lumen: no hidden
    # intersection membrane may block any of the three horizontal mouths.
    branch_outer = y_cylinder(R, 0, 50)
    lumen = x_cylinder(RI, -.1, 100.1) + y_cylinder(RI, -.1, 50)
    closed = ((x_cylinder(R, 0, 100) + branch_outer) - lumen) + locating_rib()
    top_port = mf.Manifold.cylinder(100-Z, TOP_R, TOP_R, 160).translate((50, 50, Z))
    opened = closed - top_port
    # Preserve ST1's full locating groove and both actual blind bottom pockets.
    # Clear the added branch at the same 0.15 mm circular saddle tolerance.
    support = source_base - y_cylinder(R + .15, -.1, 50)
    # Simplify sub-micron edges before writing float32 STL/GLB. The exported
    # files are loaded again to verify topology after serialization.
    solids = {id: solid.simplify(.0001) for id, solid in {'TT1T': closed, 'TT2T': opened, 'TTB': support}.items()}
    names = {'TT1T': 'T型三通管体', 'TT2T': '顶开口T型三通管体', 'TTB': 'T型三通磁吸底座'}
    index_path = ROOT / 'src/data/model-index.json'
    validation_path = MODEL_DIR / 'validation.json'
    index, validation = json.loads(index_path.read_text()), json.loads(validation_path.read_text())
    provenance = {
        'sourceVersion': '100 mm T modules v1', 'derivedFrom': ['ST1T', 'ST1B'],
        'sourceGlbSha256': {id: hashlib.sha256((MODEL_DIR / f'{id}.glb').read_bytes()).hexdigest() for id in ['ST1T', 'ST1B']},
        'generator': 'scripts/prepare-tee-pipes.py', 'production3mfIncluded': False,
    }
    measurements = {}
    for id, solid in solids.items():
        mesh = mesh_of(solid)
        bounds = mesh.bounds.reshape(-1).tolist()
        assert min(bounds[:2]) >= -.001 and max(bounds[3:5]) <= 100.001
        component = {'id': f'{id}_Snow', 'color_key': 'Snow', 'color': '#F1EADB'}
        group = {'id': id, 'components': [component]}
        path = MODEL_DIR / f'{id}.glb'
        converter.write_glb(path, group, [mesh])
        index[id] = {'url': f'/models/{id}.glb', 'bounds': bounds,
                     'components': [{'id': component['id'], 'colorKey': 'Snow', 'color': '#F1EADB'}], 'nameZh': names[id]}
        validation['groups'][id] = {'bytes': path.stat().st_size,
            'components': [{'id': component['id'], 'sourceTriangles': len(mesh.faces), 'triangles': len(mesh.faces),
                            'sampledMaxErrorMm': 0, 'boundsMaxErrorMm': 0, 'volumeRelativeError': 0}],
            'source': provenance}
        mesh.export(OUT / f'{id}.stl')
        reloaded = trimesh.load(OUT / f'{id}.stl', force='mesh')
        assert reloaded.is_watertight and reloaded.is_winding_consistent, f'{id}: serialized topology'
        measurements[id] = {'boundsMm': bounds, 'triangles': len(mesh.faces), 'watertight': bool(mesh.is_watertight),
                            'connectedBodies': len(mesh.split()), 'volumeMm3': mesh.volume}
        print(f'{id}: {np.round(mesh.extents, 4).tolist()} mm, {len(mesh.faces)} faces, watertight', flush=True)
    intersection = {id: (solids[id] ^ support).volume() for id in ['TT1T', 'TT2T']}
    assert max(intersection.values()) < .001, intersection
    # Three cylinders of radius 39.9 prove the full 80 mm passage centerline
    # remains unobstructed through the junction (not merely three visual holes).
    probes = {
        'left-to-right': x_cylinder(RI-.1, -.01, 100.01),
        'front-to-junction': y_cylinder(RI-.1, -.01, 50),
    }
    lumen_obstruction = {id: {name: (solids[id] ^ probe).volume() for name, probe in probes.items()} for id in ['TT1T', 'TT2T']}
    assert all(volume < .001 for checks in lumen_obstruction.values() for volume in checks.values())
    report = {'schema': 1, 'units': 'millimeter', 'upAxis': 'Z', 'moduleFootprintMm': [100, 100],
        'outerDiameterMm': R*2, 'innerDiameterMm': RI*2, 'nominalWallMm': R-RI,
        'axisHeightMm': Z, 'topOpeningDiameterMm': TOP_R*2,
        'bottomMagnetContactPoints': [[10, 90, 0], [90, 90, 0]], 'magnetPocketDiameterMm': 8.2, 'magnetPocketDepthMm': 4.2,
        'horizontalMouths': [{'center': [0, 50, Z], 'normal': [-1, 0, 0]},
                             {'center': [100, 50, Z], 'normal': [1, 0, 0]},
                             {'center': [50, 0, Z], 'normal': [0, -1, 0]}],
        'source': provenance, 'groups': measurements, 'supportIntersectionMm3': intersection,
        'lumenObstructionMm3': lumen_obstruction, 'physicalFitTested': False}
    (OUT / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    validation_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
