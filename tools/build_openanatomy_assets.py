#!/usr/bin/env python3
"""Build browser-friendly head anatomy GLBs from the official Open Anatomy SPL Head & Neck atlas.

The script downloads the upstream atlas bundle, reads the Slicer MRML model hierarchy,
selects head bones plus arterial and venous structures, applies any linear MRML transforms,
converts Slicer RAS coordinates into the Three.js basis used by Anatomy3D, decimates meshes
within conservative triangle budgets, and exports three registered GLB files.

Designed to run in GitHub Actions. It intentionally fails if no real artery or vein models
can be identified, so the site never silently falls back to schematic geometry.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import trimesh
import vtk
from vtk.util.numpy_support import vtk_to_numpy

ATLAS_URL = "https://www.openanatomy.org/atlases/nac/head-neck-2016-09.zip"
ATLAS_PAGE = "https://www.openanatomy.org/atlas-pages/atlas-spl-head-and-neck.html"
ATLAS_VIEWER = "https://www.openanatomy.org/atlases/nac/head-neck-2016-09/viewer/"
ATLAS_NAME = "SPL Head and Neck Atlas"

BONE_TERMS = (
    "skull", "cranium", "cranial bone", "mandible", "maxilla", "maxillary bone",
    "frontal bone", "parietal bone", "temporal bone", "occipital bone", "sphenoid",
    "ethmoid", "zygomatic", "nasal bone", "lacrimal", "palatine", "vomer",
    "inferior nasal concha", "hyoid", "tooth", "teeth", "incisor", "canine",
    "premolar", "molar", "calvar", "facial bone"
)
ARTERY_TERMS = (
    "artery", "arteries", "arterial", "carotid", "basilar", "vertebral artery",
    "facial artery", "maxillary artery", "temporal artery", "meningeal artery",
    "ophthalmic artery", "cerebral artery", "communicating artery", "circle of willis",
    "circulus arteriosus", "a. carot", "a_carot"
)
VEIN_TERMS = (
    "vein", "veins", "venous", "jugular", "vena ", "vena_", "dural sinus",
    "venous sinus", "cavernous sinus", "sagittal sinus", "transverse sinus",
    "sigmoid sinus", "straight sinus", "petrosal sinus", "occipital sinus",
    "pterygoid plexus", "venous plexus"
)
VASCULAR_TERMS = ("blood vessel", "blood vessels", "vascular", "vasculature", "vessels")
EXCLUDE_TERMS = (
    "label", "annotation", "fiducial", "marker", "reference", "helper", "skin",
    "muscle", "cartilage", "gland", "spine", "vertebra", "rib", "larynx", "trachea"
)

FACE_BUDGET = {"bone": 280_000, "artery": 190_000, "vein": 190_000}
MAX_SINGLE_MESH_FACES = {"bone": 120_000, "artery": 90_000, "vein": 90_000}

@dataclass
class Record:
    node_id: str
    name: str
    hierarchy_names: list[str]
    path: Path
    color: tuple[float, float, float] | None
    opacity: float
    transform: np.ndarray
    kind: str | None = None
    source_faces: int = 0
    output_faces: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join([self.name, *self.hierarchy_names]).replace("_", " ").lower()


def tag_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def attr_first(node: ET.Element | None, *keys: str) -> str | None:
    if node is None:
        return None
    for key in keys:
        value = node.get(key)
        if value:
            return value
    return None


def parse_color(value: str | None) -> tuple[float, float, float] | None:
    if not value:
        return None
    try:
        parts = [float(x) for x in value.replace(",", " ").split()[:3]]
        if len(parts) == 3:
            return tuple(max(0.0, min(1.0, x)) for x in parts)
    except ValueError:
        pass
    return None


def parse_matrix(value: str | None) -> np.ndarray:
    if not value:
        return np.eye(4, dtype=float)
    try:
        values = [float(x) for x in value.replace(",", " ").split()]
        if len(values) == 16:
            return np.asarray(values, dtype=float).reshape(4, 4)
    except ValueError:
        pass
    return np.eye(4, dtype=float)


def read_color_tables(root: Path) -> dict[str, dict[str, object]]:
    table: dict[str, dict[str, object]] = {}
    for path in root.rglob("*.ctbl"):
        try:
            for raw in path.read_text(errors="ignore").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) < 6 or not parts[0].lstrip("-+").isdigit():
                    continue
                index = parts[0]
                name = parts[1].replace("_", " ")
                try:
                    rgb = tuple(float(v) / 255.0 for v in parts[2:5])
                    alpha = float(parts[5]) / 255.0
                except ValueError:
                    continue
                table.setdefault(index, {"name": name, "color": rgb, "opacity": alpha})
        except OSError:
            continue
    return table


def download_and_extract(url: str, work: Path) -> Path:
    archive = work / "atlas.zip"
    print(f"Downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "Anatomy3D-OpenAnatomy-Builder/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, archive.open("wb") as output:
        total = int(response.headers.get("Content-Length") or 0)
        read = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            read += len(chunk)
            if total:
                print(f"  {read / total * 100:5.1f}% ({read / 1024 / 1024:.1f} MB)", end="\r")
        print(f"  downloaded {read / 1024 / 1024:.1f} MB")
    extracted = work / "atlas"
    extracted.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(extracted)
    return extracted


def choose_mrml(root: Path) -> Path:
    candidates = list(root.rglob("*.mrml"))
    if not candidates:
        raise RuntimeError("The upstream archive contains no MRML scene file")
    scored: list[tuple[int, int, Path]] = []
    for path in candidates:
        try:
            tree = ET.parse(path)
            nodes = list(tree.getroot())
            score = sum(1 for n in nodes if tag_name(n) in {"Model", "ModelHierarchy", "vtkMRMLModelNode", "vtkMRMLModelHierarchyNode"})
            scored.append((score, path.stat().st_size, path))
        except Exception:
            continue
    if not scored:
        raise RuntimeError("MRML files were found but none could be parsed")
    scored.sort(reverse=True)
    path = scored[0][2]
    print(f"Using MRML scene: {path.relative_to(root)} ({scored[0][0]} model/hierarchy nodes)")
    return path


def locate_file(filename: str, scene_dir: Path, atlas_root: Path) -> Path | None:
    decoded = urllib.parse.unquote(filename).replace("\\", "/")
    for direct in ((scene_dir / decoded).resolve(), (atlas_root / decoded).resolve()):
        if direct.exists() and direct.is_file():
            return direct
    basename = Path(decoded).name.lower()
    matches = [p for p in atlas_root.rglob("*") if p.is_file() and p.name.lower() == basename]
    if matches:
        matches.sort(key=lambda p: len(p.parts))
        return matches[0]
    return None


def build_records(mrml_path: Path, atlas_root: Path) -> tuple[list[Record], list[str]]:
    root = ET.parse(mrml_path).getroot()
    nodes = list(root)
    by_id = {n.get("id"): n for n in nodes if n.get("id")}
    color_table = read_color_tables(atlas_root)
    hierarchy_for_model: dict[str, ET.Element] = {}
    for node in nodes:
        if tag_name(node) not in {"ModelHierarchy", "vtkMRMLModelHierarchyNode"}:
            continue
        associated = attr_first(node, "associatedNodeRef", "associatedNodeID")
        if associated:
            hierarchy_for_model[associated] = node

    def hierarchy_chain(model_id: str) -> list[str]:
        result: list[str] = []
        current = hierarchy_for_model.get(model_id)
        seen: set[str] = set()
        while current is not None:
            hid = current.get("id") or ""
            if hid in seen:
                break
            seen.add(hid)
            name = current.get("name")
            if name and not name.lower().startswith("modelhierarchy"):
                result.append(name.replace("_", " "))
            parent_id = attr_first(current, "parentNodeRef", "parentNodeID")
            parent = by_id.get(parent_id) if parent_id else None
            if parent is None or tag_name(parent) not in {"ModelHierarchy", "vtkMRMLModelHierarchyNode"}:
                break
            current = parent
        return result

    transform_cache: dict[str, np.ndarray] = {}
    def world_transform(transform_id: str | None, active: set[str] | None = None) -> np.ndarray:
        if not transform_id:
            return np.eye(4, dtype=float)
        if transform_id in transform_cache:
            return transform_cache[transform_id].copy()
        active = set(active or ())
        if transform_id in active:
            return np.eye(4, dtype=float)
        active.add(transform_id)
        node = by_id.get(transform_id)
        if node is None:
            return np.eye(4, dtype=float)
        to_parent = attr_first(node, "matrixTransformToParent", "transformToParent")
        from_parent = attr_first(node, "matrixTransformFromParent", "transformFromParent")
        local = parse_matrix(to_parent or from_parent)
        if not to_parent and from_parent:
            try:
                local = np.linalg.inv(local)
            except np.linalg.LinAlgError:
                local = np.eye(4, dtype=float)
        parent_id = attr_first(node, "transformNodeRef", "parentTransformNodeRef")
        result = world_transform(parent_id, active) @ local
        transform_cache[transform_id] = result
        return result.copy()

    records: list[Record] = []
    unresolved: list[str] = []
    model_tags = {"Model", "vtkMRMLModelNode"}
    for model in nodes:
        if tag_name(model) not in model_tags:
            continue
        model_id = model.get("id") or ""
        storage_id = attr_first(model, "storageNodeRef", "storageNodeID")
        storage = by_id.get(storage_id) if storage_id else None
        filename = attr_first(storage, "fileName", "filename")
        if not filename:
            continue
        path = locate_file(filename, mrml_path.parent, atlas_root)
        if path is None or path.suffix.lower() not in {".vtk", ".vtp", ".stl", ".obj", ".ply"}:
            unresolved.append(filename)
            continue
        semantic_name = model.get("name") or path.stem
        match = re.match(r"Model[_ -]?(\d+)$", semantic_name, flags=re.I)
        ctbl_entry = color_table.get(match.group(1)) if match else None
        if ctbl_entry and ctbl_entry.get("name"):
            semantic_name = str(ctbl_entry["name"])
        hierarchy = hierarchy_chain(model_id)
        hierarchy_node = hierarchy_for_model.get(model_id)
        display_id = attr_first(model, "displayNodeRef", "displayNodeID") or attr_first(hierarchy_node, "displayNodeRef", "displayNodeID")
        display = by_id.get(display_id) if display_id else None
        if display is not None and tag_name(display) in model_tags:
            nested = attr_first(display, "displayNodeRef", "displayNodeID")
            display = by_id.get(nested) if nested else display
        color = parse_color(attr_first(display, "color"))
        try:
            opacity = float(attr_first(display, "opacity") or 1.0)
        except ValueError:
            opacity = 1.0
        if ctbl_entry:
            color = color or ctbl_entry.get("color")
            if opacity == 1.0 and ctbl_entry.get("opacity") is not None:
                opacity = float(ctbl_entry["opacity"])
        transform_id = attr_first(model, "transformNodeRef", "parentTransformNodeRef")
        records.append(Record(model_id, semantic_name.replace("_", " "), hierarchy, path, color, max(0.0, min(1.0, opacity)), world_transform(transform_id)))

    if len(records) < 3:
        seen = {r.path.resolve() for r in records}
        for path in atlas_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".vtk", ".vtp", ".stl", ".obj", ".ply"} or path.resolve() in seen:
                continue
            records.append(Record(f"file:{path.name}", path.stem.replace("_", " "), [], path, None, 1.0, np.eye(4)))
    return records, unresolved


def color_kind(color: tuple[float, float, float] | None) -> str | None:
    if color is None:
        return None
    r, g, b = color
    if r > b * 1.25 and r > g * 1.08:
        return "artery"
    if b > r * 1.18 and b > g * 1.02:
        return "vein"
    return None


def classify(record: Record) -> str | None:
    text = re.sub(r"\s+", " ", record.text)
    if any(term in text for term in EXCLUDE_TERMS):
        direct = record.name.lower().replace("_", " ")
        if not any(term in direct for term in (*BONE_TERMS, *ARTERY_TERMS, *VEIN_TERMS)):
            return None
    if any(term in text for term in VEIN_TERMS):
        return "vein"
    if any(term in text for term in ARTERY_TERMS):
        return "artery"
    if any(term in text for term in BONE_TERMS):
        return "bone"
    if any(term in text for term in VASCULAR_TERMS):
        return color_kind(record.color)
    return None


def read_polydata(path: Path) -> vtk.vtkPolyData:
    ext = path.suffix.lower()
    if ext == ".vtk": reader = vtk.vtkGenericDataObjectReader()
    elif ext == ".vtp": reader = vtk.vtkXMLPolyDataReader()
    elif ext == ".stl": reader = vtk.vtkSTLReader()
    elif ext == ".obj": reader = vtk.vtkOBJReader()
    elif ext == ".ply": reader = vtk.vtkPLYReader()
    else: raise ValueError(f"Unsupported geometry format: {ext}")
    reader.SetFileName(str(path)); reader.Update(); output = reader.GetOutput()
    if not isinstance(output, vtk.vtkPolyData):
        geometry = vtk.vtkGeometryFilter(); geometry.SetInputData(output); geometry.Update(); output = geometry.GetOutput()
    triangle = vtk.vtkTriangleFilter(); triangle.SetInputData(output); triangle.PassLinesOff(); triangle.PassVertsOff(); triangle.Update()
    clean = vtk.vtkCleanPolyData(); clean.SetInputData(triangle.GetOutput()); clean.Update()
    return clean.GetOutput()


def decimate(poly: vtk.vtkPolyData, target_faces: int) -> vtk.vtkPolyData:
    faces = poly.GetNumberOfPolys()
    if faces <= target_faces or target_faces <= 0:
        return poly
    reduction = max(0.0, min(0.96, 1.0 - target_faces / float(faces)))
    dec = vtk.vtkQuadricDecimation(); dec.SetInputData(poly); dec.SetTargetReduction(reduction)
    if hasattr(dec, "VolumePreservationOn"): dec.VolumePreservationOn()
    dec.Update(); result = dec.GetOutput()
    return result if result.GetNumberOfPolys() > 0 else poly


def poly_to_trimesh(poly: vtk.vtkPolyData, transform: np.ndarray, color: tuple[float, float, float] | None, opacity: float) -> trimesh.Trimesh:
    points = poly.GetPoints()
    if points is None or poly.GetNumberOfPolys() == 0:
        raise ValueError("Empty polygon data")
    vertices = vtk_to_numpy(points.GetData()).astype(np.float64, copy=False)
    cell_data = vtk_to_numpy(poly.GetPolys().GetData()).astype(np.int64, copy=False)
    faces = []; i = 0
    while i < len(cell_data):
        count = int(cell_data[i]); ids = cell_data[i+1:i+1+count]
        if count == 3: faces.append(ids.tolist())
        elif count > 3:
            for j in range(1, count-1): faces.append([int(ids[0]), int(ids[j]), int(ids[j+1])])
        i += count + 1
    if not faces: raise ValueError("No triangle faces")
    homogeneous = np.column_stack([vertices, np.ones(len(vertices))])
    transformed = (transform @ homogeneous.T).T[:, :3]
    converted = np.column_stack([-transformed[:, 0], transformed[:, 2], transformed[:, 1]])
    mesh = trimesh.Trimesh(vertices=converted, faces=np.asarray(faces, dtype=np.int64), process=False)
    mesh.remove_unreferenced_vertices()
    rgb = color or (0.82, 0.82, 0.82)
    rgba = np.asarray([int(max(0,min(1,rgb[0]))*255), int(max(0,min(1,rgb[1]))*255), int(max(0,min(1,rgb[2]))*255), int(max(0,min(1,opacity))*255)], dtype=np.uint8)
    mesh.visual.face_colors = np.tile(rgba, (len(mesh.faces), 1))
    return mesh


def safe_name(name: str, existing: set[str]) -> str:
    base = re.sub(r"\s+", " ", name.replace("_", " ")).strip() or "Unnamed structure"
    value = base; index = 2
    while value.lower() in existing:
        value = f"{base} {index}"; index += 1
    existing.add(value.lower()); return value


def build_kind(records: list[Record], kind: str, output_path: Path) -> dict[str, object]:
    selected = [r for r in records if r.kind == kind]
    if not selected: raise RuntimeError(f"No {kind} models identified in upstream atlas")
    loaded = []; total_faces = 0
    for record in selected:
        try:
            poly = read_polydata(record.path); faces = int(poly.GetNumberOfPolys())
            if faces <= 0: record.warnings.append("empty geometry"); continue
            record.source_faces = faces; total_faces += faces; loaded.append((record, poly))
        except Exception as exc:
            record.warnings.append(f"read failed: {exc}"); print(f"WARNING: could not read {record.path}: {exc}")
    if not loaded: raise RuntimeError(f"All identified {kind} models had empty or unreadable geometry")
    budget = FACE_BUDGET[kind]; scale = min(1.0, budget / max(total_faces,1)); scene = trimesh.Scene(); names=set(); exported=[]; output_faces=0
    for record, poly in loaded:
        proportional=max(900,int(record.source_faces*scale)); target=min(record.source_faces, proportional, MAX_SINGLE_MESH_FACES[kind])
        if record.source_faces < 6000: target=record.source_faces
        simplified=decimate(poly,target)
        try: mesh=poly_to_trimesh(simplified,record.transform,record.color,record.opacity)
        except Exception as exc: record.warnings.append(f"conversion failed: {exc}"); continue
        record.output_faces=int(len(mesh.faces)); output_faces += record.output_faces; node_name=safe_name(record.name,names)
        scene.add_geometry(mesh,node_name=node_name,geom_name=node_name)
        exported.append({"name":node_name,"hierarchy":record.hierarchy_names,"sourceFile":record.path.name,"sourceFaces":record.source_faces,"faces":record.output_faces,"color":record.color,"opacity":record.opacity,"warnings":record.warnings})
    if not exported: raise RuntimeError(f"No {kind} geometry survived conversion")
    output_path.parent.mkdir(parents=True,exist_ok=True); output_path.write_bytes(scene.export(file_type="glb"))
    return {"kind":kind,"models":len(exported),"sourceFaces":total_faces,"faces":output_faces,"bytes":output_path.stat().st_size,"file":output_path.name,"structures":exported}


def write_report(output: Path, all_records: list[Record], unresolved: list[str], build_results: dict[str, object] | None=None, error: str | None=None) -> None:
    classified={"bone":[],"artery":[],"vein":[],"unclassified":[]}
    for r in all_records:
        key=r.kind if r.kind in classified else "unclassified"
        classified[key].append({"name":r.name,"hierarchy":r.hierarchy_names,"file":r.path.name,"color":r.color})
    report={"atlas":ATLAS_NAME,"source":ATLAS_URL,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"error":error,"counts":{k:len(v) for k,v in classified.items()},"classified":classified,"unresolvedStorageFiles":sorted(set(unresolved)),"results":build_results or {}}
    output.mkdir(parents=True,exist_ok=True); (output/"build-report.json").write_text(json.dumps(report,indent=2,sort_keys=True))


def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--output",type=Path,default=Path("assets/openanatomy")); parser.add_argument("--atlas-url",default=os.environ.get("OPENANATOMY_ATLAS_URL",ATLAS_URL)); parser.add_argument("--work",type=Path,default=None); args=parser.parse_args()
    temp=tempfile.TemporaryDirectory(prefix="anatomy3d-openanatomy-") if args.work is None else None; work=Path(temp.name) if temp else args.work; assert work is not None; work.mkdir(parents=True,exist_ok=True)
    records=[]; unresolved=[]; results={}
    try:
        atlas_root=download_and_extract(args.atlas_url,work); mrml=choose_mrml(atlas_root); records,unresolved=build_records(mrml,atlas_root)
        if not records: raise RuntimeError("No model records could be extracted from the atlas")
        for record in records: record.kind=classify(record)
        print("Classified models:")
        for kind in ("bone","artery","vein"):
            values=[r for r in records if r.kind==kind]; print(f"  {kind}: {len(values)}")
            for r in values[:30]: print(f"    - {r.name} :: {' > '.join(reversed(r.hierarchy_names))}")
        for required in ("bone","artery","vein"):
            if not any(r.kind==required for r in records):
                candidates=[r for r in records if any(t in r.text for t in VASCULAR_TERMS)]
                print("Potential vascular candidates:")
                for r in candidates[:80]: print(f"  - {r.name} | {r.hierarchy_names} | color={r.color}")
                raise RuntimeError(f"No real {required} structures identified; refusing to generate an incomplete atlas")
        args.output.mkdir(parents=True,exist_ok=True); file_map={"bone":"head-bones.glb","artery":"head-arteries.glb","vein":"head-veins.glb"}
        for kind,filename in file_map.items(): results[kind]=build_kind(records,kind,args.output/filename)
        manifest={"name":ATLAS_NAME,"version":"head-neck-2016-09","sourceUrl":args.atlas_url,"sourcePage":ATLAS_PAGE,"sourceViewer":ATLAS_VIEWER,"license":"3D Slicer License section B","modified":True,"modifications":["Selected head bone and vascular structures only","Applied model linear transforms from the Slicer MRML scene when present","Converted Slicer RAS coordinates to the Anatomy3D Three.js coordinate basis","Triangulated, cleaned and conservatively decimated meshes for web performance","Exported registered structures to GLB while preserving individual mesh names"],"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"coordinateSystem":"Three.js: X=patient left, Y=superior, Z=anterior","assets":results}
        (args.output/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)); write_report(args.output,records,unresolved,results)
        for kind,result in results.items(): print(f"{kind}: {result['models']} models, {result['faces']} faces, {result['bytes']/1024/1024:.2f} MB")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}",file=sys.stderr)
        try: write_report(args.output,records,unresolved,results,str(exc))
        except Exception: pass
        return 1
    finally:
        if temp is not None: temp.cleanup()

if __name__ == "__main__": raise SystemExit(main())
