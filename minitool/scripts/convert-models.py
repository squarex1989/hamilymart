"""Build offline preview meshes, preserving component topology and assembly coordinates."""
from pathlib import Path
import json
import struct
import hashlib
import subprocess
import numpy as np
import trimesh
import fast_simplification
from scipy.spatial import ConvexHull
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'minitool/generated/models'
MAX_COMPONENT_BOUNDS_ERROR_MM = 0.1
MAX_COMPONENT_VOLUME_ERROR = 0.01


def quality(reference, candidate):
    """Global bounds alone cannot detect a missing component or a collapsed thin wall."""
    if not len(candidate.faces) or not candidate.is_watertight or not candidate.is_winding_consistent:
        return None
    if candidate.euler_number != reference.euler_number:
        return None
    if len(candidate.split(only_watertight=False)) != 1:
        return None
    if np.any(candidate.area_faces <= 1e-12):
        return None
    bounds_error = float(np.max(np.abs(candidate.bounds - reference.bounds)))
    volume_error = float(abs(candidate.volume - reference.volume) / max(abs(reference.volume), 1e-12))
    area_error = float(abs(candidate.area - reference.area) / max(reference.area, 1e-12))
    if bounds_error > MAX_COMPONENT_BOUNDS_ERROR_MM or volume_error > MAX_COMPONENT_VOLUME_ERROR or area_error > .03:
        return None
    return {'boundsErrorMm': bounds_error, 'volumeRelativeError': volume_error, 'areaRelativeError': area_error}


def quantized_candidate(reference, vertices, faces):
    # Most vertices use integer micrometres. Sub-micrometre precision preserves
    # tiny source bevels which would otherwise weld into non-manifold edges.
    for decimals in (0, 3, 6):
        stored = np.round(np.asarray(vertices) * 1000, decimals)
        candidate = trimesh.Trimesh(vertices=stored / 1000, faces=faces, process=True)
        metrics = quality(reference, candidate)
        if metrics is not None:
            return candidate, metrics, decimals
    return None


def convex_extrusion(reference):
    """Safely reduce thin, closed convex plugs without collapsing their thickness.

    Only accept a two-plane extrusion whose hull volume differs by at most 0.1%
    (source circle tessellation has tiny concavities). General platform shells
    and holes cannot enter this path, and the result still passes all gates.
    """
    vertices = reference.vertices
    levels = np.unique(vertices[:, 2])
    if len(levels) != 2 or reference.euler_number != 2:
        return None
    xy = np.unique(vertices[:, :2], axis=0)
    if len(xy) < 4:
        return None
    hull = ConvexHull(xy)
    outline = Polygon(xy[hull.vertices])
    expected_volume = outline.area * float(levels[1] - levels[0])
    if abs(expected_volume - abs(reference.volume)) > expected_volume * .001:
        return None
    outline = outline.simplify(.05, preserve_topology=True)
    ring = np.asarray(outline.exterior.coords)[:-1]
    # Shapely may return either winding after simplification.
    if np.sum(ring[:, 0] * np.roll(ring[:, 1], -1) - ring[:, 1] * np.roll(ring[:, 0], -1)) < 0:
        ring = ring[::-1]
    count = len(ring)
    if count * 4 >= len(reference.faces):
        return None
    center = np.asarray(outline.centroid.coords)[0]
    points = np.vstack([np.column_stack([ring, np.full(count, z)]) for z in levels] + [
        [center[0], center[1], levels[0]], [center[0], center[1], levels[1]]])
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.extend([[2 * count, j, i], [2 * count + 1, count + i, count + j],
                      [i, j, count + j], [i, count + j, count + i]])
    faces = np.asarray(faces)
    if reference.volume < 0:
        faces = faces[:, ::-1]
    return points, faces


def simplify_component(component, target):
    candidates = []
    extruded = convex_extrusion(component)
    if extruded is not None:
        accepted = quantized_candidate(component, *extruded)
        if accepted is not None:
            candidates.append((*accepted, 'convex-extrusion'))
    # Try the requested size first, then less aggressive candidates. Failed
    # candidates are never corrected by scaling the entire primitive.
    for aggression, count in [(7, target), (7, min(len(component.faces), int(target * 1.35))),
                               (7, int(len(component.faces) * .5)), (7, int(len(component.faces) * .75)),
                               (5, target), (4, target)]:
        if count >= len(component.faces):
            continue
        points, faces = fast_simplification.simplify(component.vertices, component.faces,
                                                     target_count=count, agg=aggression)
        if candidates and len(faces) >= min(len(value[0].faces) for value in candidates):
            continue
        accepted = quantized_candidate(component, points, faces)
        if accepted is not None:
            candidates.append((*accepted, f'quadric-{aggression}'))
    baseline = quantized_candidate(component, component.vertices, component.faces)
    if baseline is None:
        raise ValueError('Source component cannot be preserved even at nanometre precision')
    candidates.append((*baseline, 'source'))
    return min(candidates, key=lambda result: (len(result[0].faces), result[2]))


def convert_model(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    source = json.loads(data[20:20 + size])
    binary = data[28 + size:]

    def accessor(index):
        entry = source['accessors'][index]
        view = source['bufferViews'][entry['bufferView']]
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[entry['componentType']]
        width = {'SCALAR': 1, 'VEC3': 3}[entry['type']]
        return np.frombuffer(binary, dtype=dtype, count=entry['count'] * width,
                             offset=view.get('byteOffset', 0) + entry.get('byteOffset', 0)).reshape(-1, width)

    meshes = []
    before = after = 0
    component_reports = []
    max_bounds_error = 0
    for node in source['nodes']:
        if 'mesh' not in node:
            continue
        mesh = source['meshes'][node['mesh']]
        assert not any(key in node for key in ['matrix', 'translation', 'rotation', 'scale']), 'Source geometry must be in assembly coordinates'
        for primitive in mesh['primitives']:
            vertices = accessor(primitive['attributes']['POSITION']).astype(np.float64)
            faces = accessor(primitive['indices']).reshape(-1, 3).astype(np.int32)
            original = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
            assert original.is_watertight and original.is_winding_consistent, f'{path.stem}: source topology is invalid'
            before += len(faces)
            pieces = original.split(only_watertight=False)
            converted = []
            precision = 0
            for component in pieces:
                target = min(len(component.faces), max(64, min(8000 if path.stem == 'P01' else 4200,
                                                               int(len(component.faces) * .24))))
                if path.stem in {'MCDB', 'MCLB', 'MCRB', 'SHB', 'LHB', 'UT01'}:
                    # Doorway planes/fillets are visually sensitive: quadrics drag their
                    # boundary vertices into long fan triangles. Retain CAD topology.
                    preserved = quantized_candidate(component, component.vertices, component.faces)
                    if preserved is None:
                        raise ValueError(f'{path.stem}: wall mesh cannot be preserved')
                    result, metrics, decimals = preserved
                    # The tray's continuous circular entry also needs its original
                    # curve tessellation; aggressive reduction causes shading bands.
                    method = 'source-curve' if path.stem == 'UT01' else 'source-wall'
                else:
                    result, metrics, decimals, method = simplify_component(component, target)
                converted.append(result)
                precision = max(precision, decimals)
                component_reports.append({'sourceTriangles': len(component.faces), 'previewTriangles': len(result.faces),
                                          'method': method, 'sourceBounds': component.bounds.tolist(),
                                          'previewBounds': result.bounds.tolist(), **metrics})
            combined = trimesh.util.concatenate(converted)
            assert len(combined.split(only_watertight=False)) == len(pieces), f'{path.stem}: components merged during conversion'
            assert combined.is_watertight and combined.is_winding_consistent
            max_bounds_error = max(max_bounds_error, float(np.max(np.abs(combined.bounds - original.bounds))))
            stored = np.round(combined.vertices * 1000, precision)
            stored_values = stored.astype(np.int64).reshape(-1).tolist() if precision == 0 else stored.reshape(-1).tolist()
            meshes.append({'name': node.get('name', mesh.get('name', 'mesh')), 'extras': node.get('extras', mesh.get('extras', {})),
                           'p': stored_values, 'i': combined.faces.reshape(-1).tolist(),
                           'material': source['materials'][primitive.get('material', 0)]})
            after += len(combined.faces)
    return meshes, {'sourceTriangles': before, 'previewTriangles': after,
                    'maxBoundsErrorMm': max_bounds_error, 'components': component_reports}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = sorted((ROOT / 'public/models').glob('*.glb'))
    helper = ROOT / 'minitool/scripts/bake-model-normals.mjs'
    report_path = ROOT / 'minitool/generated/model-report.json'
    cache_path = ROOT / 'minitool/generated/model-cache.json'
    dependencies = [Path(__file__), helper, ROOT / 'src/lib/planar-normals.js', ROOT / 'minitool/src/data/offline-model-format.json',
                    ROOT / 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
                    ROOT / 'node_modules/three/package.json']
    digest = hashlib.sha256()
    for path in dependencies + sources:
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    key = digest.hexdigest()
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    if cache.get('key') == key and report_path.exists() and all(
            (OUT / name).exists() and hashlib.sha256((OUT / name).read_bytes()).hexdigest() == sha
            for name, sha in cache.get('files', {}).items()) and len(cache.get('files', {})) == len(sources):
        report = json.loads(report_path.read_text())
    else:
        models, report = {}, {}
        for path in sources:
            models[path.stem], report[path.stem] = convert_model(path)
        result = subprocess.run(['node', str(helper)], input=json.dumps(models), text=True,
                                capture_output=True, check=True)
        baked = json.loads(result.stdout)
        hashes = {}
        for model_id, asset in baked.items():
            payload = json.dumps(asset['meshes'], ensure_ascii=False, separators=(',', ':'))
            content = '(window.HamilyModels=window.HamilyModels||{})[' + json.dumps(model_id) + ']=function(){return ' + payload + ';};\n'
            destination = OUT / (model_id + '.js')
            destination.write_text(content)
            hashes[destination.name] = hashlib.sha256(destination.read_bytes()).hexdigest()
            report[model_id].update(bytes=len(content.encode()), bakedGeometry=asset['reports'], formatVersion=asset['meshes'][0]['v'])
        report_path.write_text(json.dumps(report, indent=2))
        cache_path.write_text(json.dumps({'key': key, 'files': hashes}, indent=2))
    print(json.dumps({'models': len(report), 'sourceTriangles': sum(x['sourceTriangles'] for x in report.values()),
                      'previewTriangles': sum(x['previewTriangles'] for x in report.values()),
                      'assetBytes': sum(x['bytes'] for x in report.values()),
                      'largestAssetBytes': max(x['bytes'] for x in report.values()),
                      'previousGeometryBytes': sum(m['previousGeometryBytes'] for x in report.values() for m in x['bakedGeometry']),
                      'geometryBytes': sum(m['geometryBytes'] for x in report.values() for m in x['bakedGeometry'])}))


if __name__ == '__main__':
    main()
