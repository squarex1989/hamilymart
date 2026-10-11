"""Independent geometry checks for the generated offline model assets.

Run from the repository root with:
    python3 -m unittest discover -s minitool/tests -p 'test_model_conversion.py'

These tests read source GLBs and the shipped JavaScript payload directly. They
deliberately do not import the converter or trust its self-reported metrics.
"""

import json
from pathlib import Path
import struct
import unittest

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
import trimesh


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/models"
GENERATED = ROOT / "minitool/generated/models"
MAX_BOUNDS_DRIFT_MM = 0.1
MAX_VOLUME_RELATIVE_ERROR = 0.01


def read_glb(path):
    """Decode the GLB independently, including accessor stride and offsets."""
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    if (magic, version, length) != (b"glTF", 2, len(data)):
        raise ValueError(f"Invalid GLB header: {path}")
    chunks = {}
    offset = 12
    while offset < len(data):
        size, kind = struct.unpack_from("<I4s", data, offset)
        offset += 8
        chunks[kind] = data[offset:offset + size]
        offset += size
    document = json.loads(chunks[b"JSON"])
    binary = chunks[b"BIN\x00"]

    def accessor(index):
        spec = document["accessors"][index]
        view = document["bufferViews"][spec["bufferView"]]
        dtype = np.dtype({
            5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4",
        }[spec["componentType"]])
        width = {"SCALAR": 1, "VEC3": 3}[spec["type"]]
        start = view.get("byteOffset", 0) + spec.get("byteOffset", 0)
        stride = view.get("byteStride", dtype.itemsize * width)
        return np.ndarray(
            (spec["count"], width), dtype=dtype, buffer=binary,
            offset=start, strides=(stride, dtype.itemsize),
        ).copy()

    parts = []
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        if any(key in node for key in ("matrix", "translation", "rotation", "scale")):
            raise ValueError(f"Source must use assembly coordinates: {path}")
        mesh = document["meshes"][node["mesh"]]
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError(f"Non-triangle primitive: {path}")
            parts.append({
                "name": node.get("name", mesh.get("name", "mesh")),
                "extras": node.get("extras", mesh.get("extras", {})),
                "material": document["materials"][primitive.get("material", 0)],
                "vertices": accessor(primitive["attributes"]["POSITION"]).astype(float),
                "faces": accessor(primitive["indices"]).reshape(-1, 3),
            })
    return parts


def read_generated(path, model_id):
    content = path.read_text()
    prefix = f'(window.HamilyModels=window.HamilyModels||{{}})[{json.dumps(model_id)}]=function(){{return '
    if not content.startswith(prefix) or not content.rstrip().endswith(";};"):
        raise ValueError(f"Unexpected model factory wrapper: {path}")
    payload = json.loads(content[len(prefix):].rstrip()[:-3])
    for part in payload:
        positions = np.asarray(part["p"], dtype=float)
        indices = np.asarray(part["i"])
        if positions.size % 3 or indices.size % 3:
            raise ValueError(f"Incomplete vertex or triangle: {path}")
        if not np.all(np.isfinite(positions)):
            raise ValueError(f"Non-finite vertex: {path}")
        if not np.issubdtype(indices.dtype, np.integer):
            raise ValueError(f"Non-integer index: {path}")
        if indices.size == 0 or indices.min() < 0 or indices.max() >= positions.size // 3:
            raise ValueError(f"Invalid triangle index: {path}")
        # Decimal payload entries are allowed for precision-preserving fallback.
        part["vertices"] = positions.reshape(-1, 3) / 1000
        part["faces"] = indices.reshape(-1, 3)
    return payload


def component_metrics(part):
    """Weld coordinate seams, then measure each vertex-connected shell."""
    mesh = trimesh.Trimesh(
        vertices=part["vertices"], faces=part["faces"], process=False,
    )
    mesh.merge_vertices()
    edges = mesh.edges_unique
    graph = coo_matrix(
        (np.ones(len(edges)), (edges[:, 0], edges[:, 1])),
        shape=(len(mesh.vertices), len(mesh.vertices)),
    ).tocsr()
    _, labels = connected_components(graph, directed=False)
    face_labels = labels[mesh.faces[:, 0]]
    metrics = []
    for label in np.unique(face_labels):
        faces = mesh.faces[face_labels == label]
        used, inverse = np.unique(faces, return_inverse=True)
        component = trimesh.Trimesh(
            vertices=mesh.vertices[used], faces=inverse.reshape(-1, 3),
            process=False,
        )
        _, edge_counts = np.unique(component.edges_sorted, axis=0, return_counts=True)
        # A local origin reduces cancellation for small shells positioned far
        # from assembly zero and remains well-defined for broken zero-volume
        # preview shells (which the assertions below will reject).
        triangles = component.triangles - component.vertices[0]
        volume = np.einsum(
            "ij,ij->i", triangles[:, 0],
            np.cross(triangles[:, 1], triangles[:, 2]),
        ).sum() / 6
        metrics.append({
            "bounds": component.bounds,
            "volume": float(volume),
            "euler": component.euler_number,
            "boundary_edges": int(np.count_nonzero(edge_counts == 1)),
            "nonmanifold_edges": int(np.count_nonzero(edge_counts > 2)),
            "degenerate_faces": int(np.count_nonzero(component.area_faces < 1e-12)),
            "winding_consistent": component.is_winding_consistent,
        })
    return metrics


class ModelConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models = {}
        for path in sorted(SOURCE.glob("*.glb")):
            source = read_glb(path)
            preview = read_generated(GENERATED / f"{path.stem}.js", path.stem)
            cls.models[path.stem] = (source, preview)
        cls.part_metrics = []
        for model_id, (source, preview) in cls.models.items():
            for original, generated in zip(source, preview):
                before = component_metrics(original)
                after = component_metrics(generated)
                # Shells can be emitted in any order. Match by spatial bounds;
                # volume is intentionally excluded from this matching criterion.
                cost = np.array([
                    [np.max(np.abs(a["bounds"] - b["bounds"])) for b in after]
                    for a in before
                ])
                rows, columns = linear_sum_assignment(cost)
                matches = [(before[a], after[b]) for a, b in zip(rows, columns)]
                cls.part_metrics.append((model_id, original["name"], before, after, matches))

    def test_model_inventory_and_part_metadata_are_preserved(self):
        self.assertTrue(self.models, "No source GLBs were found")
        self.assertEqual(
            set(self.models), {path.stem for path in GENERATED.glob("*.js")},
            "Generated inventory must exactly match source models",
        )
        for model_id, (source, preview) in self.models.items():
            with self.subTest(model=model_id):
                self.assertEqual(len(source), len(preview), "Source primitive was lost or duplicated")
            for original, generated in zip(source, preview):
                with self.subTest(model=model_id, part=original["name"]):
                    for field in ("name", "extras", "material"):
                        self.assertEqual(original[field], generated[field], field)
                    for field in ("sourcePart", "colorKey"):
                        self.assertIn(field, generated["extras"])

    def test_closed_components_and_topology_are_preserved(self):
        for model_id, name, before, after, matches in self.part_metrics:
            with self.subTest(model=model_id, part=name, check="component count"):
                self.assertEqual(len(before), len(after), "Connected shells were lost, merged, or split")
            for index, (original, generated) in enumerate(matches):
                with self.subTest(model=model_id, part=name, component=index):
                    # Check the assumptions on the source too: invalid source data
                    # must not silently become the expected topology baseline.
                    for label, value in (("source", original), ("preview", generated)):
                        self.assertEqual(value["boundary_edges"], 0, f"{label}: open boundary")
                        self.assertEqual(value["nonmanifold_edges"], 0, f"{label}: nonmanifold edge")
                        self.assertEqual(value["degenerate_faces"], 0, f"{label}: degenerate face")
                        self.assertTrue(value["winding_consistent"], f"{label}: inconsistent winding")
                    self.assertEqual(original["euler"], generated["euler"], "Hole or handle topology changed")

    def test_each_component_preserves_signed_volume(self):
        for model_id, name, _, _, matches in self.part_metrics:
            for index, (original, generated) in enumerate(matches):
                with self.subTest(model=model_id, part=name, component=index):
                    source_volume = original["volume"]
                    self.assertGreater(abs(source_volume), 1e-12)
                    self.assertEqual(
                        np.sign(source_volume), np.sign(generated["volume"]),
                        "Interior cavity orientation changed",
                    )
                    error = abs(generated["volume"] - source_volume) / abs(source_volume)
                    self.assertLessEqual(error, MAX_VOLUME_RELATIVE_ERROR + 1e-9)

    def test_each_component_stays_in_assembly_position(self):
        for model_id, name, _, _, matches in self.part_metrics:
            for index, (original, generated) in enumerate(matches):
                with self.subTest(model=model_id, part=name, component=index):
                    error = float(np.max(np.abs(original["bounds"] - generated["bounds"])))
                    self.assertLessEqual(error, MAX_BOUNDS_DRIFT_MM + 1e-6)


if __name__ == "__main__":
    unittest.main()
