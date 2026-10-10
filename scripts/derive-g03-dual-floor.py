#!/usr/bin/env python3
"""Rebuild only G03 for the approved 120 x 94 mm dual-floor magnet layout.

V4 is an immutable input. Remap the original closed mesh topology continuously
between x=14 and x=142; preserve both side walls/magnet seats rigidly, and shorten
the middle by 26 mm. The monotone map is applied to real manufacturing vertices.
This keeps the 70 mm side doorway, circular 8.2 mm pockets, pocket depth and
5 mm side walls unchanged. This is a derived printable model, not a viewer scale.
Run after prepare-models.py; local large intermediates stay in .site-workflow.
Requires numpy, trimesh, manifold3d, fast-simplification and rtree.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import manifold3d as mf
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_8x4_v4/assembly_meshes.json')
LEFT_CUT, RIGHT_CUT, REDUCTION = 14.0, 142.0, 26.0
ORIGIN = [78.0, 239.0, 200.0]
MAGNETS = [[5.0, 192.0, 200.0], [5.0, 286.0, 200.0],
           [125.0, 192.0, 200.0], [125.0, 286.0, 200.0]]


def solid(component: dict) -> mf.Manifold:
    mesh = mf.Mesh64(np.array(component['vertices'], np.float64),
                     np.array(component['triangles'], np.uint64))
    mesh.merge()
    result = mf.Manifold(mesh)
    assert result.status() == mf.Error.NoError
    return result


def union(items: list[mf.Manifold]) -> mf.Manifold:
    return mf.Manifold.batch_boolean(items, mf.OpType.Add)


def mesh(s: mf.Manifold) -> trimesh.Trimesh:
    result = s.to_mesh64()
    return trimesh.Trimesh(np.asarray(result.vert_properties)[:, :3],
                           np.asarray(result.tri_verts), process=True)


def deform(s: mf.Manifold) -> mf.Manifold:
    def remap(vertices):
        result = np.asarray(vertices).copy()
        result[:, 0] -= REDUCTION * np.clip((result[:, 0] - LEFT_CUT) / (RIGHT_CUT - LEFT_CUT), 0, 1)
        return result
    # Preserve native welded topology instead of cutting/rejoining coplanar color
    # interfaces, whose microscopic inherited seams are fragile in float32 STL.
    result = s.warp_batch(remap)
    assert result.status() == mf.Error.NoError
    actual = mesh(result)
    assert actual.is_watertight and actual.is_winding_consistent
    return result


def cube(low, high):
    return mf.Manifold.cube(tuple(b - a for a, b in zip(low, high))).translate(low)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=ROOT / '.site-workflow/derived-models/g03-dual-floor')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source_sha = sha(args.source)
    source = json.loads(args.source.read_text())
    groups = {g['id']: g for g in source['groups']}
    original = groups['G03']
    derived = copy.deepcopy(original)
    derived['name_zh'] = '圣诞帽阁楼_120x94双层兼容派生版'
    before = [solid(c) for c in original['components']]
    after = [deform(s) for s in before]
    old_whole, whole = union(before), union(after)
    bounds = np.asarray(whole.bounding_box()).reshape(2, 3)
    derived['assembly_bounds_mm'] = bounds.reshape(-1).tolist()
    derived['dimensions_mm'] = (bounds[1] - bounds[0]).tolist()
    derived['volume_mm3'] = whole.volume()
    derived['origin_mm'] = ORIGIN
    derived['magnet_contact_points_mm'] = MAGNETS
    derived['derivation'] = {'sourceSha256': source_sha, 'sourceGroup': 'G03',
        'method': 'topology-preserving piecewise affine vertex rebuild; rigid side walls and pockets',
        'leftCutMm': LEFT_CUT, 'rightCutMm': RIGHT_CUT, 'widthReductionMm': REDUCTION,
        'magnetSpacingMm': [120, 94], 'physicalTested': False}
    component_checks = []
    for component, s in zip(derived['components'], after):
        actual = mesh(s)
        assert actual.is_watertight and actual.is_winding_consistent
        component['vertices'] = actual.vertices.tolist()
        component['triangles'] = actual.faces.tolist()
        printed = actual.copy()
        # Both colors share one registration, not per-color independent centering.
        printed.apply_translation(-bounds[0])
        file = args.output / (component['id'] + '.stl')
        printed.export(file)
        reloaded = trimesh.load(file, force='mesh')
        assert reloaded.is_watertight and reloaded.is_winding_consistent
        component['stl'] = str(file)
        component_checks.append({'id': component['id'], 'watertight': True,
            'consistentWinding': True, 'triangles': len(actual.faces),
            'printStlSha256': sha(file), 'positiveMaterialBodies': sum(p.volume() > 1e-5 for p in s.decompose())})
    # Strip inherited group-level arrays, which otherwise describe the old model.
    for key in ('vertices', 'triangles', 'face_materials'):
        derived.pop(key, None)
    combined = mesh(whole)
    # Manifold may report microscopic signed interface slivers inherited from V4.
    # Keep the physical positive body for the combined diagnostic STL only.
    physical = [p for p in whole.decompose() if p.volume() > 1e-5]
    assert len(physical) == 1
    combined = mesh(physical[0])
    combined.apply_translation(-bounds[0])
    combined_path = args.output / 'G03_combined_print.stl'
    combined.export(combined_path)
    # Verify protected seats are identical solids up to the rigid right translation.
    left_box = cube((-10, 175, 199), (LEFT_CUT, 305, 260))
    right_box = cube((RIGHT_CUT, 175, 199), (170, 305, 260))
    left_change = ((old_whole ^ left_box) - (whole ^ left_box)).volume() + ((whole ^ left_box) - (old_whole ^ left_box)).volume()
    expected_right = (old_whole ^ right_box).translate((-REDUCTION, 0, 0))
    actual_right = whole ^ right_box.translate((-REDUCTION, 0, 0))
    right_change = (expected_right - actual_right).volume() + (actual_right - expected_right).volume()
    assert abs(left_change) < .001 and abs(right_change) < .001
    pockets = []
    for x, y, z in MAGNETS:
        cavity = mf.Manifold.cylinder(4.19, 4.09, 4.09, 128).translate((x, y, z + .005))
        occupied = abs((whole ^ cavity).volume())
        assert occupied < .001
        pockets.append({'contactMm': [x, y, z], 'centerMm': [x, y, z + 2],
                        'diameterMm': 8.2, 'depthMm': 4.2, 'occupiedMm3': occupied})
    # The original side entrance occupies y=204..274. A conservative 67 x 50 mm
    # clear prism remains unchanged after the right wall's rigid translation.
    entrance = cube((119, 205.5, 200.01), (134, 272.5, 250))
    entrance_overlap = abs((whole ^ entrance).volume())
    assert entrance_overlap < .001
    # True physical intersections in the canonical upper-floor assembly, not AABBs.
    collisions = {}
    for gid in ['A02', 'G15', 'G16', 'G17']:
        other = union([solid(c) for c in groups[gid]['components']])
        collisions[gid] = abs((whole ^ other).volume())
    assert max(collisions.values()) < .01, collisions
    shifted_collisions = {}
    for gid in ['A02', 'G15', 'G16', 'G17']:
        other = union([solid(c) for c in groups[gid]['components']])
        shifted_collisions[gid] = abs((whole.translate((26, 0, 0)) ^ other).volume())
    assert max(shifted_collisions.values()) < .01, shifted_collisions
    # Sample shell crossings away from openings; retain the same Y/Z coordinates.
    shell_checks = []
    for z in [202, 210, 230, 250, 270, 300, 330, 350]:
        for y in [200, 239, 275]:
            hits = whole.ray_cast((-10, y, z), (145, y, z))
            xs = [float(h.position[0]) for h in hits]
            widths = [b - a for a, b in zip(xs[0::2], xs[1::2]) if b - a > .05]
            if widths:
                shell_checks.append({'y': y, 'z': z, 'xCrossingWidthsMm': widths})
    assert min(v for check in shell_checks for v in check['xCrossingWidthsMm']) > 3.5
    assembly_path = args.output / 'assembly_meshes.json'
    assembly_path.write_text(json.dumps({'schema_version': 3, 'units': 'millimeter',
        'version': 'HamilyMart G03 dual-floor 120x94 revision 1', 'palette': source['palette'],
        'groups': [derived]}, ensure_ascii=False, separators=(',', ':')))
    module_spec = importlib.util.spec_from_file_location('prepare_models', ROOT / 'scripts/prepare-models.py')
    converter = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(converter)
    web_meshes, web_checks = [], []
    for component in derived['components']:
        result, check = converter.simplified_mesh(component)
        web_meshes.append(result)
        web_checks.append({'id': component['id'], **check})
    glb = ROOT / 'public/models/G03.glb'
    converter.write_glb(glb, derived, web_meshes)
    scene = trimesh.load(glb, force='scene')
    glb_error = float(np.max(np.abs(scene.bounds - bounds)))
    assert glb_error < .06
    report = {'sourceFile': str(args.source), 'sourceSha256': source_sha,
        'derivedSourceFile': str(assembly_path), 'derivedSourceSha256': sha(assembly_path),
        'generator': 'scripts/derive-g03-dual-floor.py', 'generatorSha256': sha(Path(__file__)),
        'bounds': bounds.reshape(-1).tolist(), 'dimensionsMm': (bounds[1] - bounds[0]).tolist(),
        'originMm': ORIGIN, 'magnetContactPointsMm': MAGNETS,
        'magnetLocalContactPointsMm': (np.asarray(MAGNETS) - np.asarray(ORIGIN)).tolist(),
        'magnetPockets': pockets, 'physicalPositiveBodies': len(physical),
        'protectedLeftDifferenceMm3': left_change, 'protectedRightDifferenceMm3': right_change,
        'clearDoorwayProbeMm': [67, 50], 'clearDoorwayProbeOverlapMm3': entrance_overlap,
        'canonicalUpperCollisionsMm3': collisions, 'sampledShellCrossings': shell_checks,
        'shifted26UpperCollisionsMm3': shifted_collisions,
        'components': component_checks, 'webGlbSha256': sha(glb), 'glbBoundsErrorMm': glb_error,
        'combinedDiagnosticStl': str(combined_path), 'physicalTested': False,
        'note': 'Geometry checks only; new print requires slicer review/supports as with original G03.'}
    (args.output / 'geometry-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    index_path = ROOT / 'src/data/model-index.json'
    index = json.loads(index_path.read_text())
    index['G03'] = {'url': '/models/G03.glb', 'bounds': report['bounds'],
        'components': [{'id': c['id'], 'colorKey': c['color_key'], 'color': c['color']} for c in derived['components']],
        'nameZh': derived['name_zh'], 'derivedRevision': 'dual-floor-120x94-r1'}
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    validation_path = ROOT / 'public/models/validation.json'
    validation = json.loads(validation_path.read_text())
    validation['groups']['G03'] = {'bytes': glb.stat().st_size, 'components': web_checks,
        'derivedSource': report}
    validation_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
    assert sha(args.source) == source_sha, 'Immutable source was modified'
    print(json.dumps({k: report[k] for k in ['bounds', 'dimensionsMm', 'originMm',
        'magnetContactPointsMm', 'physicalPositiveBodies', 'canonicalUpperCollisionsMm3',
        'derivedSourceFile', 'derivedSourceSha256', 'webGlbSha256']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
