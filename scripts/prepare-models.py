#!/usr/bin/env python3
"""Generate HamilyMart web assets from the approved assembly (never print STL poses).

Requires Python 3.11+, numpy, trimesh, fast-simplification and rtree.
Catalog PNGs are exported by /dev/thumbnail-studio.html using the live Three.js presentation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

import numpy as np
import trimesh
import fast_simplification

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v16/assembly_meshes.json')
DEFAULT_FOOD_BOWL_SOURCE = DEFAULT_SOURCE.parent.parent / 'christmas_villa_v30_pool_cover/assembly_meshes.json'


def food_bowl_group(source: Path) -> tuple[dict, dict]:
    """Import the real historical optional bowl without changing its 8x2 mm pockets."""
    source_bytes = source.read_bytes()
    data = json.loads(source_bytes)
    group = next(group for group in data['groups'] if group['id'] == 'O01')
    bounds = np.asarray([trimesh.Trimesh(component['vertices'], component['triangles'], process=False).bounds
                         for component in group['components']])
    group['assembly_bounds_mm'] = [*bounds[:, 0, :].min(axis=0).tolist(), *bounds[:, 1, :].max(axis=0).tolist()]
    return group, {'sourceDirectory': source.parent.name, 'sourceVersion': data.get('version'),
                   'sourceSha256': hashlib.sha256(source_bytes).hexdigest(), 'groups': ['O01'],
                   'magnetMm': [8, 2], 'pocketMm': [8.1, 2.1]}


def simplified_mesh(component: dict) -> tuple[trimesh.Trimesh, dict]:
    """Keep tiny details while reducing the extremely dense curved tessellation."""
    source = trimesh.Trimesh(component['vertices'], component['triangles'], process=False)
    stats = {'sourceTriangles': len(source.faces), 'triangles': len(source.faces),
             'sampledMaxErrorMm': 0.0, 'boundsMaxErrorMm': 0.0, 'volumeRelativeError': 0.0}
    if len(source.faces) < 3200:
        return source, stats
    vertices, faces = fast_simplification.simplify(
        np.asarray(source.vertices), np.asarray(source.faces, dtype=np.int32),
        target_count=max(1600, int(len(source.faces) * .24)), agg=3, preserve_border=True,
    )
    result = trimesh.Trimesh(vertices, faces, process=False)
    # These are geometry checks, not a claim of a full Hausdorff-distance bound.
    # A deterministic dense vertex sample protects tiny rounds, recesses and holes.
    rng = np.random.default_rng(37)
    samples = source.vertices[rng.choice(len(source.vertices), min(1600, len(source.vertices)), replace=False)]
    _, distances, _ = trimesh.proximity.closest_point(result, samples)
    bound_error = float(np.max(np.abs(source.bounds - result.bounds)))
    max_error = float(distances.max())
    volume_error = abs(result.volume - source.volume) / max(1, abs(source.volume))
    if bound_error > .06 or max_error > .06 or volume_error > .001:
        # Asset size is secondary to faithfully depicting the approved geometry.
        stats['keptOriginal'] = True
        return source, stats
    stats.update(triangles=len(result.faces), sampledMaxErrorMm=round(max_error, 6),
                 boundsMaxErrorMm=round(bound_error, 6), volumeRelativeError=round(volume_error, 8))
    return result, stats


def web_color_components(group: dict, meshes: list[trimesh.Trimesh]) -> tuple[dict, list[trimesh.Trimesh], dict]:
    """Separate the actual hat window for coloring, without changing any triangle.

    Source G03_Snow contains three disconnected bodies: brim, window and pompom.
    This is a web-only material split; approved source files and print meshes stay intact.
    Split after simplification so web geometry also remains identical to the old export.
    """
    if group['id'] != 'G03':
        return group, meshes, {}
    index = next(i for i, component in enumerate(group['components']) if component['id'] == 'G03_Snow')
    snow = meshes[index]
    bodies = snow.split(only_watertight=False)
    # Classify the window by its unchanged dimensions, allowing the complete
    # cottage to move to a new mounting position in the approved assembly.
    windows = [body for body in bodies if np.allclose(body.extents, [68, 5.9, 36], atol=.06)]
    if len(bodies) != 3 or len(windows) != 1:
        raise ValueError('G03 Snow geometry changed; audit window, brim and pompom before exporting')
    window = windows[0]
    trim = trimesh.util.concatenate([body for body in bodies if body is not window])
    if len(trim.faces) + len(window.faces) != len(snow.faces) or not np.isclose(trim.area + window.area, snow.area, atol=1e-8):
        raise ValueError('G03 material split must preserve all triangles and surface area')
    components = [dict(component) for component in group['components']]
    components.append({**components[index], 'id': 'G03_WindowSnow', 'color_slot': 'G03-window'})
    exported = list(meshes)
    exported[index] = trim
    exported.append(window)
    return {**group, 'components': components}, exported, {
        'sourceComponent': 'G03_Snow', 'method': 'disconnected-window-body',
        'windowComponent': 'G03_WindowSnow', 'windowBoundsMm': window.bounds.tolist(),
        'beforeTriangles': len(snow.faces), 'afterTriangles': len(trim.faces) + len(window.faces),
        'windowTriangles': len(window.faces), 'unchangedSurfaceAreaMm2': float(snow.area),
    }


def write_glb(path: Path, group: dict, meshes: list[trimesh.Trimesh]) -> None:
    """Small standard GLB writer. Extras are exposed as mesh.userData by Three.js."""
    gltf = {'asset': {'version': '2.0', 'generator': 'HamilyMart approved-assembly converter'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(meshes)))}],
            'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': [],
            'extras': {'units': 'millimeter', 'upAxis': 'Z', 'sourceGroup': group['id']}}
    binary = bytearray()
    def accessor(values, component_type: int, value_type: str, target: int, bounds=False):
        values = np.ascontiguousarray(values)
        while len(binary) % 4:
            binary.extend(b'\0')
        view_index = len(gltf['bufferViews'])
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': values.nbytes, 'target': target})
        binary.extend(values.tobytes())
        a = {'bufferView': view_index, 'componentType': component_type, 'count': len(values), 'type': value_type}
        if bounds:
            a['min'] = values.min(axis=0).tolist()
            a['max'] = values.max(axis=0).tolist()
        gltf['accessors'].append(a)
        return len(gltf['accessors']) - 1
    for i, (component, original_mesh) in enumerate(zip(group['components'], meshes)):
        mesh = trimesh.graph.smooth_shade(original_mesh, angle=math.radians(40), facet_minarea=None)
        position = accessor(np.asarray(mesh.vertices, dtype='<f4'), 5126, 'VEC3', 34962, True)
        normal = accessor(np.asarray(mesh.vertex_normals, dtype='<f4'), 5126, 'VEC3', 34962)
        short = len(mesh.vertices) < 65536
        indices = accessor(np.asarray(mesh.faces.reshape(-1), dtype='<u2' if short else '<u4'), 5123 if short else 5125, 'SCALAR', 34963)
        # glTF factors are linear, while the source palette is sRGB.
        srgb = np.array([int(component['color'][j:j+2], 16) / 255 for j in (1, 3, 5)])
        linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
        gltf['materials'].append({'name': component['color_key'], 'pbrMetallicRoughness': {
            'baseColorFactor': [*linear.tolist(), 1], 'metallicFactor': 0, 'roughnessFactor': .62}, 'doubleSided': False})
        extras = {'sourcePart': component['id'], 'sourceGroup': group['id'],
                  'colorKey': component['color_key'], 'defaultColor': component['color']}
        if component.get('color_slot'):
            extras['colorSlot'] = component['color_slot']
        gltf['meshes'].append({'name': component['id'], 'extras': extras, 'primitives': [{
            'attributes': {'POSITION': position, 'NORMAL': normal}, 'indices': indices, 'material': i}]})
        gltf['nodes'].append({'mesh': i, 'name': component['id'], 'extras': extras})
    while len(binary) % 4:
        binary.extend(b'\0')
    gltf['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(gltf, ensure_ascii=True, separators=(',', ':')).encode('utf8')
    encoded += b' ' * ((-len(encoded)) % 4)
    length = 12 + 8 + len(encoded) + 8 + len(binary)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, length) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--food-bowl-source', type=Path, default=DEFAULT_FOOD_BOWL_SOURCE,
                        help='Historical O01 fallback, used only when the primary assembly lacks O01')
    parser.add_argument('--only', nargs='+', help='Regenerate selected group IDs while preserving other existing assets')
    parser.add_argument('--thumbnails', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--thumbnails-only', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--thumbnail-products', nargs='+', help=argparse.SUPPRESS)
    parser.add_argument('--thumbnail-styles', nargs='+', help=argparse.SUPPRESS)
    parser.add_argument('--blender', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.thumbnails or args.thumbnails_only or args.thumbnail_products or args.thumbnail_styles or args.blender:
        parser.error('Blender thumbnails are retired: run npm run dev, open /dev/thumbnail-studio.html, and generate the catalog with the shared Three.js renderer.')
    models_dir = ROOT / 'public/models'
    models_dir.mkdir(parents=True, exist_ok=True)
    source_bytes = args.source.read_bytes()
    source = json.loads(source_bytes)
    groups = list(source['groups'])
    bowl_source = None
    if not any(group['id'] == 'O01' for group in groups):
        bowl, bowl_source = food_bowl_group(args.food_bowl_source)
        groups.append(bowl)
    index_path = ROOT / 'src/data/model-index.json'
    validation_path = models_dir / 'validation.json'
    index = json.loads(index_path.read_text()) if args.only else {}
    metrics = json.loads(validation_path.read_text())['groups'] if args.only else {}
    if args.only and set(args.only) - {group['id'] for group in groups}:
        raise ValueError('Unknown group in --only')
    for group in groups:
        if args.only and group['id'] not in args.only:
            continue
        meshes, checks = [], []
        for component in group['components']:
            mesh, stats = simplified_mesh(component)
            meshes.append(mesh)
            checks.append({'id': component['id'], **stats})
        file = models_dir / (group['id'] + '.glb')
        web_group, web_meshes, color_split = web_color_components(group, meshes)
        write_glb(file, web_group, web_meshes)
        index[group['id']] = {'url': '/models/' + file.name, 'bounds': group['assembly_bounds_mm'],
                              'components': [{'id': c['id'], 'colorKey': c['color_key'], 'color': c['color']} for c in web_group['components']],
                              'nameZh': group['name_zh']}
        provenance = bowl_source if group['id'] == 'O01' and bowl_source else {
            'sourceDirectory': args.source.parent.name,
            'sourceVersion': source.get('version'),
            'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
        }
        metrics[group['id']] = {'bytes': file.stat().st_size, 'components': checks,
                                'source': provenance}
        if color_split:
            metrics[group['id']]['webColorSplit'] = color_split
        print(f"{group['id']}: {sum(c['sourceTriangles'] for c in checks):,} → {sum(c['triangles'] for c in checks):,} triangles, {file.stat().st_size / 1000:.1f} KB", flush=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    validation_path.write_text(json.dumps({'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
        'sourceVersion': source.get('version'), 'supplementalSources': [bowl_source] if bowl_source else [],
        'units': 'millimeter', 'upAxis': 'Z', 'groups': metrics}, ensure_ascii=False, indent=2) + '\n')
    print(f"Total: {sum(v['bytes'] for v in metrics.values()) / 1e6:.2f} MB", flush=True)



if __name__ == '__main__':
    main()
