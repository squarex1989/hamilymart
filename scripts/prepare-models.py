#!/usr/bin/env python3
"""Generate HamilyMart web assets from the approved assembly (never print STL poses).

Requires Python 3.11+, numpy, trimesh, fast-simplification and rtree.
`--thumbnails` additionally uses a local Blender executable, without add-ons.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

import numpy as np
import trimesh
import fast_simplification

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path('/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_8x4_v4/assembly_meshes.json')


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


# Read the runtime catalogue directly so thumbnails follow the same product bundles,
# default stock colours, and primary/trim colour rules as the interactive scene.
def thumbnail_catalog() -> dict:
    exporter = """
import { COLORS, PRODUCTS, getBaseParts, SOURCE_TRIM_COLORS, PRIMARY_COLOR_KEYS } from './src/data/catalog.ts';
const base = getBaseParts(100, false);
const pool = getBaseParts(100, true).find(part => part.id === 'B01');
console.log(JSON.stringify({
  colors: Object.fromEntries(COLORS.map(color => [color.id, color.hex])),
  trimColors: SOURCE_TRIM_COLORS,
  primaryColorKeys: PRIMARY_COLOR_KEYS,
  groups: Object.fromEntries([
    ['base', base], ...PRODUCTS.map(product => [product.id, product.parts]),
    ['pool', [pool]],
    ['small-cover', [base.find(part => part.id === 'H01')]],
    ['large-cover', [base.find(part => part.id === 'H06')]],
  ]),
}));
"""
    runner = ROOT / 'node_modules/.bin/tsx'
    if not runner.exists():
        raise RuntimeError('Run npm install in the app before rendering catalogue thumbnails.')
    result = subprocess.run([str(runner), '--eval', exporter], cwd=ROOT,
                            capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    payload['modelIndex'] = json.loads((ROOT / 'src/data/model-index.json').read_text())
    return payload


BLENDER_RENDER = r'''
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
source, output, groups_path = map(Path, args)
catalog = json.loads(groups_path.read_text())
groups = catalog['groups']
def linear_rgba(hex_color):
    values = [int(hex_color[i:i+2], 16) / 255 for i in (1,3,5)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in values) + (1,)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 480
scene.render.resolution_y = 400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new('Soft studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.85,0.9,0.85,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .55
scene.view_settings.view_transform = 'AgX'
for product, product_parts in groups.items():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    parts = []
    for part in product_parts:
        group_id = part['id']
        primary_key = catalog['primaryColorKeys'].get(group_id, catalog['modelIndex'][group_id]['components'][0]['colorKey'])
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(source / (group_id + '.glb')))
        added = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        # glTF importer assumes Y-up. Our deliberately Z-up web assets need undoing.
        for obj in added:
            obj.rotation_mode = 'XYZ'
            obj.rotation_euler = (-math.pi / 2,0,0)
            obj.location = part.get('offset', [0,0,0])
            source_key = obj.get('colorKey')
            color_id = part['defaultColor'] if not source_key or source_key == primary_key else catalog['trimColors'].get(source_key, part['defaultColor'])
            rgba = linear_rgba(catalog['colors'][color_id])
            for slot in obj.material_slots:
                material = slot.material.copy()
                slot.material = material
                material.diffuse_color = rgba
                if material.use_nodes:
                    for node in material.node_tree.nodes:
                        if node.type == 'BSDF_PRINCIPLED':
                            node.inputs['Base Color'].default_value = rgba
                            node.inputs['Metallic'].default_value = 0
                            node.inputs['Roughness'].default_value = .72
            parts.append(obj)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(v) for obj in parts for v in obj.bound_box]
    low = Vector([min(v[i] for v in corners) for i in range(3)])
    high = Vector([max(v[i] for v in corners) for i in range(3)])
    center = (low + high) / 2
    span = max(high.x-low.x, high.y-low.y, high.z-low.z)
    camera_data = bpy.data.cameras.new('Camera')
    camera = bpy.data.objects.new('Camera', camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.3,-1.8,1.25)) * span
    direction = center - camera.location
    camera.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
    camera_data.type = 'ORTHO'
    # Fit the actual projected bounds, including portrait-like small houses.
    # A fixed scale based only on the longest world axis clips tall thumbnails.
    orientation = camera.rotation_euler.to_quaternion()
    right = orientation @ Vector((1,0,0))
    up = orientation @ Vector((0,1,0))
    horizontal = [(v-center).dot(right) for v in corners]
    vertical = [(v-center).dot(up) for v in corners]
    camera.location += right * ((min(horizontal)+max(horizontal))/2) + up * ((min(vertical)+max(vertical))/2)
    aspect = scene.render.resolution_x / scene.render.resolution_y
    camera_data.ortho_scale = max(max(horizontal)-min(horizontal), (max(vertical)-min(vertical))*aspect) * 1.14
    camera_data.clip_end = 10000
    scene.camera = camera
    for name, delta, power, size in [('Key', (0.2,-1.5,2.2),1200000,2),('Fill',(-1.6,-0.2,1.0),600000,2.0),('Rim',(0.8,1.5,1.8),800000,1.4)]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = power * (span/300)**2
        data.shape = 'DISK'
        data.size = span * size
        light = bpy.data.objects.new(name,data)
        scene.collection.objects.link(light)
        light.location = center + Vector(delta) * span
        light.rotation_euler = (center-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(output/(product+'.png'))
    bpy.ops.render.render(write_still=True)
    print('HAMILY_THUMBNAIL '+product, flush=True)
'''


def thumbnails(models_dir: Path, output: Path, blender: str):
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='hamilymart-thumbnails-') as temporary:
        render_script = Path(temporary) / 'render.py'
        groups_path = Path(temporary) / 'groups.json'
        render_script.write_text(BLENDER_RENDER)
        groups_path.write_text(json.dumps(thumbnail_catalog()))
        # Blender logging includes scene internals; keep only useful output on success.
        result = subprocess.run([blender, '--background', '--python', str(render_script), '--', str(models_dir), str(output), str(groups_path)], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout[-4000:] + result.stderr[-4000:])
        for line in result.stdout.splitlines():
            if line.startswith('HAMILY_THUMBNAIL '):
                print(line, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--thumbnails', action='store_true')
    parser.add_argument('--thumbnails-only', action='store_true')
    parser.add_argument('--blender', default=shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender')
    args = parser.parse_args()
    models_dir = ROOT / 'public/models'
    models_dir.mkdir(parents=True, exist_ok=True)
    if not args.thumbnails_only:
        source_bytes = args.source.read_bytes()
        source = json.loads(source_bytes)
        index, metrics = {}, {}
        for group in source['groups']:
            meshes, checks = [], []
            for component in group['components']:
                mesh, stats = simplified_mesh(component)
                meshes.append(mesh)
                checks.append({'id': component['id'], **stats})
            file = models_dir / (group['id'] + '.glb')
            write_glb(file, group, meshes)
            index[group['id']] = {'url': '/models/' + file.name, 'bounds': group['assembly_bounds_mm'],
                                  'components': [{'id': c['id'], 'colorKey': c['color_key'], 'color': c['color']} for c in group['components']],
                                  'nameZh': group['name_zh']}
            metrics[group['id']] = {'bytes': file.stat().st_size, 'components': checks}
            print(f"{group['id']}: {sum(c['sourceTriangles'] for c in checks):,} → {sum(c['triangles'] for c in checks):,} triangles, {file.stat().st_size / 1000:.1f} KB", flush=True)
        (ROOT / 'src/data/model-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
        (models_dir / 'validation.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
            'sourceVersion': source.get('version'), 'units': 'millimeter', 'upAxis': 'Z', 'groups': metrics}, ensure_ascii=False, indent=2) + '\n')
        print(f"Total: {sum(v['bytes'] for v in metrics.values()) / 1e6:.2f} MB", flush=True)
    if args.thumbnails or args.thumbnails_only:
        thumbnails(models_dir, ROOT / 'public/thumbnails', args.blender)


if __name__ == '__main__':
    main()
