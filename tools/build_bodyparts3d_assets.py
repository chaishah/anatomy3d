#!/usr/bin/env python3
"""Build detailed, registered BodyParts3D head assets for Anatomy3D.

Geometry is downloaded from the BodyParts3D / Anatomography service at
lifesciencedb.jp. The v4.3 FJ object universe is validated against the official
version-stamped FMA2Obj manifest. A public v4.3 mesh index is used only to select
human-readable head structures; it is not used as the geometry source.

BodyParts3D uses a shared millimetre coordinate system. We convert its coordinates
from (X=left, Y=posterior, Z=superior) to Three.js (X=left, Y=superior,
Z=anterior) with (x, y, z) -> (x, z, -y). No per-layer registration is performed,
so bones, vessels, nerves and soft tissues remain in the same atlas coordinates.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import re
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

VERSION = "4.3"
BASE = "https://lifesciencedb.jp/bp3d"
VIEWER = f"{BASE}/?lng=en"
INFO_CGI = f"{BASE}/get-info.cgi"
DOWNLOAD_CGI = f"{BASE}/download.cgi"
INDEX_URL = "https://raw.githubusercontent.com/olivercase/body_parts_3d_api/main/MANIFEST.csv"
OFFICIAL_PAGE = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/"
OFFICIAL_LICENSE = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"
UA = "Mozilla/5.0 Anatomy3D-BodyParts3D-Builder/1.0"

CATEGORY_FILES = {
    "bone": "head-bones.glb",
    "artery": "head-arteries.glb",
    "vein": "head-veins.glb",
    "nerve": "head-nerves.glb",
    "muscle": "head-muscles.glb",
    "organ": "head-organs.glb",
}
CATEGORY_COLORS = {
    "bone": [0.88, 0.86, 0.78, 1.0],
    "artery": [0.88, 0.16, 0.16, 1.0],
    "vein": [0.16, 0.38, 0.82, 1.0],
    "nerve": [0.96, 0.72, 0.18, 1.0],
    "muscle": [0.66, 0.20, 0.22, 1.0],
    "organ": [0.72, 0.48, 0.58, 1.0],
}
MAX_MESH_FACES = {
    "bone": 90_000,
    "artery": 40_000,
    "vein": 40_000,
    "nerve": 28_000,
    "muscle": 45_000,
    "organ": 75_000,
}
MIN_COUNTS = {"bone": 18, "artery": 35, "vein": 22, "nerve": 35, "muscle": 20, "organ": 25}

BONE_TERMS = (
    "skull", "cranium", "calvar", "mandible", "maxilla", "frontal bone", "parietal bone",
    "temporal bone", "occipital bone", "sphenoid bone", "ethmoid", "zygomatic bone", "nasal bone",
    "lacrimal bone", "palatine bone", "vomer", "inferior nasal concha", "hyoid", "tooth", "teeth",
    "incisor", "canine tooth", "premolar", "molar tooth", "gingiva",
)

ARTERY_CONTEXT = (
    "carotid", "vertebral", "basilar", "cerebral", "cerebellar", "communicating", "ophthalmic",
    "retinal", "meningeal", "facial", "maxillary", "temporal", "labial", "nasal", "palatine",
    "alveolar", "mental", "lingual", "occipital", "auricular", "supra-orbital", "supraorbital",
    "supratrochlear", "infra-orbital", "infraorbital", "sphenopalatine", "pterygo", "pharyngeal",
    "laryngeal", "hypophyseal", "choroidal", "lacrimal", "ciliary", "angular", "submental",
    "sublingual", "mylohyoid", "masseteric", "buccal", "dental", "palpebral", "tympanic",
    "stylomastoid", "pericallosal", "callosomarginal", "thalam", "pontine", "insular",
    "central sulcus", "paracentral", "orbitofrontal", "frontopolar", "parieto-occipital",
    "posterior communicating", "anterior communicating", "ascending palatine", "ascending pharyngeal",
)

VEIN_CONTEXT = (
    "jugular", "facial", "cerebral", "ophthalmic", "retinal", "retromandibular", "maxillary",
    "temporal", "labial", "angular", "supra-orbital", "supraorbital", "supratrochlear",
    "pterygoid", "pharyngeal", "sublingual", "submental", "lingual", "occipital", "auricular",
    "cavernous", "sagittal", "transverse sinus", "sigmoid sinus", "straight sinus", "petrosal",
    "sphenoparietal", "intercavernous", "sinus confluence", "confluence of sinus", "basilar venous",
    "great cerebral", "superficial middle cerebral", "deep middle cerebral", "superior anastomotic",
    "inferior anastomotic", "vein of galen", "trolard", "labbe",
)

NERVE_CONTEXT = (
    "olfactory", "optic nerve", "optic chiasm", "optic tract", "oculomotor", "trochlear nerve",
    "trigeminal", "ophthalmic nerve", "maxillary nerve", "mandibular nerve", "abducens", "facial nerve",
    "vestibulocochlear", "glossopharyngeal", "vagus", "accessory nerve", "hypoglossal", "ciliary",
    "lacrimal nerve", "frontal nerve", "supra-orbital", "supraorbital", "supratrochlear", "infratrochlear",
    "nasociliary", "ethmoidal nerve", "infra-orbital", "infraorbital", "alveolar nerve", "dental nerve",
    "mental nerve", "lingual nerve", "buccal nerve", "auriculotemporal", "masseteric nerve",
    "pterygoid nerve", "mylohyoid nerve", "palatine nerve", "nasal nerve", "zygomatic nerve",
    "greater petrosal", "lesser petrosal", "chorda tympani", "geniculate ganglion", "trigeminal ganglion",
    "otic ganglion", "pterygopalatine ganglion", "submandibular ganglion", "superior cervical ganglion",
    "laryngeal nerve", "tympanic nerve", "stylomastoid", "posterior auricular nerve", "marginal mandibular",
    "temporal branch of facial", "zygomatic branch of facial", "cervical branch of facial",
)

MUSCLE_CONTEXT = (
    "masseter", "temporalis", "temporal muscle", "medial pterygoid", "lateral pterygoid", "digastric",
    "mylohyoid", "geniohyoid", "stylohyoid", "genioglossus", "hyoglossus", "styloglossus", "palatoglossus",
    "orbicularis oculi", "orbicularis oris", "buccinator", "zygomatic", "risorius", "levator labii",
    "levator anguli", "depressor labii", "depressor anguli", "mentalis", "nasalis", "procerus", "corrugator",
    "frontalis", "occipitalis", "epicrani", "auricular muscle", "platysma", "superior constrictor",
    "middle constrictor", "inferior constrictor", "stylopharyngeus", "salpingopharyngeus", "palatopharyngeus",
    "tensor veli", "levator veli", "superior oblique", "inferior oblique", "superior rectus", "inferior rectus",
    "medial rectus", "lateral rectus", "levator palpebrae", "intrinsic muscle of tongue", "tongue muscle",
)

ORGAN_CONTEXT = (
    "cerebr", "cerebell", "brainstem", "brain stem", "pons", "medulla oblongata", "midbrain", "mesencephalon",
    "thalam", "hypothalam", "hippocamp", "amygdala", "caudate", "putamen", "globus pallidus", "claustrum",
    "ventricle", "corpus callosum", "fornix", "pineal", "pituitary", "hypophysis", "choroid plexus",
    "frontal lobe", "parietal lobe", "temporal lobe", "occipital lobe", "insula", "gyrus", "cortex",
    "cornea", "sclera", "retina", "iris", "lens", "choroid", "ciliary body", "vitreous", "eyeball",
    "lacrimal gland", "parotid", "submandibular gland", "sublingual gland", "tongue", "tonsil",
    "nasal cavity", "nasal septum", "pharynx", "soft palate", "hard palate", "external ear", "auricle",
    "cochlea", "vestibule", "semicircular", "tympanic membrane", "middle ear", "inner ear",
)

EXCLUDE = (
    "coronary", "renal", "femoral", "iliac", "popliteal", "brachial artery", "radial artery", "ulnar artery",
    "mesenteric", "splenic", "hepatic", "gastric", "pancrea", "uter", "ovarian", "testicular", "pulmonary",
    "aorta", "vena cava", "subclavian", "axillary", "thoracic", "abdominal", "pelvic", "lower limb", "upper limb",
)

logger = logging.getLogger("bodyparts3d_builder")

@dataclass(frozen=True)
class IndexRow:
    fj_id: str
    bp_id: str
    fma_id: str
    name: str
    faces: int
    verts: int


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").replace("-", " ").lower()).strip()


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term.replace("-", " ") in text for term in terms)


def classify(name: str) -> str | None:
    text = norm(name)
    if contains_any(text, EXCLUDE):
        return None
    # Classify named vessels/nerves/muscles before bones so, for example,
    # "maxillary artery" cannot be mistaken for the maxilla.
    if ("artery" in text or "arterial" in text) and contains_any(text, ARTERY_CONTEXT):
        return "artery"
    if ("vein" in text or "venous" in text or "plexus" in text or "sinus" in text) and contains_any(text, VEIN_CONTEXT):
        return "vein"
    if ("nerve" in text or "ganglion" in text or "optic tract" in text or "optic chiasm" in text) and contains_any(text, NERVE_CONTEXT):
        return "nerve"
    if "muscle" in text and contains_any(text, MUSCLE_CONTEXT):
        return "muscle"
    if contains_any(text, BONE_TERMS):
        return "bone"
    if contains_any(text, ORGAN_CONTEXT):
        if any(token in text for token in (" artery", " vein", " nerve", " muscle")):
            return None
        return "organ"
    return None


def http_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8", errors="replace")


def load_index() -> list[IndexRow]:
    logger.info("Fetching v4.3 structure index")
    text = http_text(INDEX_URL)
    rows: list[IndexRow] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            rows.append(IndexRow(
                fj_id=row["fj_id"].strip(),
                bp_id=row.get("bp_id", "").strip(),
                fma_id=row.get("fma_id", "").strip(),
                name=row["name"].strip(),
                faces=int(row.get("faces") or 0),
                verts=int(row.get("verts") or 0),
            ))
        except (KeyError, ValueError):
            continue
    if len(rows) < 3000:
        raise RuntimeError(f"Unexpected BodyParts3D v4.3 index size: {len(rows)}")
    return rows


def curl(args: list[str], retries: int = 4, timeout: int = 600) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            proc = subprocess.run(args, capture_output=True, timeout=timeout)
            if proc.returncode == 0:
                return proc.stdout
            last = RuntimeError(proc.stderr.decode(errors="replace")[:500])
        except subprocess.TimeoutExpired as exc:
            last = exc
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"curl failed after {retries} attempts: {last}")


def base_curl(cookies: Path) -> list[str]:
    return ["curl", "-A", UA, "-e", VIEWER, "-b", str(cookies), "-c", str(cookies), "-s", "--compressed"]


def get_session(cookies: Path) -> None:
    curl(["curl", "-A", UA, "-c", str(cookies), "-s", "-o", "/dev/null", VIEWER])


def fetch_official_fj_universe(work: Path, cookies: Path) -> set[str]:
    blob = curl(base_curl(cookies) + [f"{INFO_CGI}?version={VERSION}&cmd=concept-objfiles-list"])
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        name = next(name for name in zf.namelist() if name.lower().endswith(".txt"))
        text = zf.read(name).decode("utf-8", errors="replace")
    (work / "FMA2Obj.txt").write_text(text)
    fj: set[str] = set()
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        for component in cols[2].split("+"):
            component = component.strip()
            if component.startswith("FJ"):
                fj.add(component)
    if len(fj) < 3000:
        raise RuntimeError(f"Unexpected official 4.3 FJ universe size: {len(fj)}")
    return fj


def fetch_fj_to_bp(work: Path, cookies: Path) -> dict[str, str]:
    blob = curl(base_curl(cookies) + [
        "-X", "POST",
        "--data-urlencode", "cmd=upload-all-list",
        "--data-urlencode", "load=1",
        "--data-urlencode", "md_abbr=bp3d",
        "--data-urlencode", "title=obj2FMA",
        "--data-urlencode", "tree=isa",
        "--data-urlencode", f"version={VERSION}",
        INFO_CGI,
    ])
    text = blob.decode("utf-8", errors="replace")
    (work / "obj2FMA.html").write_text(text)
    mapping: dict[str, str] = {}
    for html_row in re.findall(r"<tr>\s*(.*?)\s*</tr>", text, re.DOTALL | re.I):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", html_row, re.DOTALL | re.I)
        if len(cells) >= 7:
            fj = re.sub(r"<[^>]+>", "", cells[1]).strip()
            bp = re.sub(r"<[^>]+>", "", cells[2]).strip()
            if fj.startswith("FJ") and bp:
                mapping[fj] = bp
    if len(mapping) < 3000:
        raise RuntimeError(f"Unexpected FJ→BP lookup size: {len(mapping)}")
    return mapping


def zip_ok(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            return bool(zf.namelist()) and zf.testzip() is None
    except (OSError, zipfile.BadZipFile):
        return False


def download_chunk(fj_ids: list[str], fj_to_bp: dict[str, str], dest: Path, cookies: Path) -> None:
    bp_ids = sorted({fj_to_bp[fj] for fj in fj_ids if fj in fj_to_bp})
    args = base_curl(cookies) + [
        "-o", str(dest),
        "--data-urlencode", f"ids={json.dumps(fj_ids)}",
        "--data-urlencode", f"rep_id={json.dumps(bp_ids)}",
        "--data-urlencode", f"filename={dest.stem}",
        "--data-urlencode", "type=art_file",
        "--data-urlencode", "all_downloads=1",
        DOWNLOAD_CGI,
    ]
    curl(args, timeout=900)
    if not zip_ok(dest):
        raise RuntimeError(f"BodyParts3D returned an invalid ZIP for {len(fj_ids)} meshes")


def download_selected(rows: list[IndexRow], work: Path, chunk_size: int) -> dict[str, Path]:
    cookies = work / "cookies.txt"
    get_session(cookies)
    official = fetch_official_fj_universe(work, cookies)
    fj_to_bp = fetch_fj_to_bp(work, cookies)
    requested = sorted({row.fj_id for row in rows if row.fj_id in official and row.fj_id in fj_to_bp})
    rejected = sorted({row.fj_id for row in rows} - set(requested))
    if rejected:
        logger.warning("%d selected IDs are not downloadable v4.3 FJ IDs", len(rejected))
    if len(requested) < 100:
        raise RuntimeError(f"Too few detailed head meshes selected: {len(requested)}")

    chunks_dir = work / "chunks"
    objs_dir = work / "objs"
    chunks_dir.mkdir(exist_ok=True)
    objs_dir.mkdir(exist_ok=True)
    wanted = set(requested)

    for index in range(0, len(requested), chunk_size):
        chunk = requested[index:index + chunk_size]
        zpath = chunks_dir / f"chunk_{index // chunk_size:03d}.zip"
        logger.info("Downloading BodyParts3D chunk %d/%d (%d structures)", index // chunk_size + 1, (len(requested) + chunk_size - 1) // chunk_size, len(chunk))
        download_chunk(chunk, fj_to_bp, zpath, cookies)
        with zipfile.ZipFile(zpath) as zf:
            for member in zf.namelist():
                if not member.lower().endswith(".obj"):
                    continue
                basename = Path(member).name
                fj = basename.split("_", 1)[0]
                if fj not in wanted:
                    continue
                out = objs_dir / basename
                if not out.exists():
                    out.write_bytes(zf.read(member))
        time.sleep(0.25)

    by_fj: dict[str, Path] = {}
    for path in objs_dir.glob("*.obj"):
        fj = path.name.split("_", 1)[0]
        if fj in wanted:
            by_fj[fj] = path
    missing = sorted(wanted - set(by_fj))
    if missing:
        raise RuntimeError(f"Missing {len(missing)} requested meshes after download: {missing[:20]}")
    return by_fj


def load_mesh(path: Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, force="mesh", process=False, maintain_order=True)
    if isinstance(loaded, trimesh.Scene):
        loaded = loaded.to_geometry()
    if not isinstance(loaded, trimesh.Trimesh) or loaded.vertices.size == 0 or loaded.faces.size == 0:
        raise ValueError("empty/non-mesh OBJ")
    mesh = loaded.copy()
    mesh.remove_unreferenced_vertices()
    transform = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])
    mesh.apply_transform(transform)
    return mesh


def simplify(mesh: trimesh.Trimesh, target_faces: int) -> tuple[trimesh.Trimesh, str | None]:
    if len(mesh.faces) <= target_faces:
        return mesh, None
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=target_faces)
        if isinstance(simplified, trimesh.Trimesh) and len(simplified.faces) > 0:
            simplified.remove_unreferenced_vertices()
            return simplified, f"decimated {len(mesh.faces)}→{len(simplified.faces)} faces"
    except Exception as exc:
        return mesh, f"decimation skipped: {exc}"
    return mesh, None


def export_category(kind: str, rows: list[IndexRow], paths: dict[str, Path], output: Path) -> dict[str, object]:
    scene = trimesh.Scene()
    structures: list[dict[str, object]] = []
    warnings: list[str] = []
    source_faces = output_faces = 0
    seen: set[str] = set()

    for row in sorted(rows, key=lambda r: (norm(r.name), r.fj_id)):
        if row.fj_id in seen or row.fj_id not in paths:
            continue
        seen.add(row.fj_id)
        try:
            mesh = load_mesh(paths[row.fj_id])
            before = len(mesh.faces)
            mesh, warning = simplify(mesh, MAX_MESH_FACES[kind])
            after = len(mesh.faces)
            source_faces += before
            output_faces += after
            rgba = np.array(CATEGORY_COLORS[kind]) * 255
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=np.tile(rgba.astype(np.uint8), (after, 1)))
            display_name = row.name.replace("_", " ").strip()
            node_name = f"{display_name} · {row.fj_id} · {row.fma_id}"
            scene.add_geometry(mesh, geom_name=node_name, node_name=node_name)
            info = {
                "name": display_name,
                "fj_id": row.fj_id,
                "bp_id": row.bp_id,
                "fma_id": row.fma_id,
                "sourceFaces": before,
                "faces": after,
            }
            if warning:
                info["warning"] = warning
            structures.append(info)
        except Exception as exc:
            warnings.append(f"{row.fj_id} {row.name}: {exc}")

    if len(structures) < MIN_COUNTS[kind]:
        raise RuntimeError(f"{kind}: only {len(structures)} usable meshes; expected >= {MIN_COUNTS[kind]}")

    payload = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    file_name = CATEGORY_FILES[kind]
    path = output / file_name
    path.write_bytes(payload)
    return {
        "kind": kind,
        "file": file_name,
        "models": len(structures),
        "sourceFaces": source_faces,
        "faces": output_faces,
        "bytes": path.stat().st_size,
        "structures": structures,
        "warnings": warnings,
    }


def select_rows(rows: list[IndexRow]) -> dict[str, list[IndexRow]]:
    selected: dict[str, list[IndexRow]] = defaultdict(list)
    for row in rows:
        kind = classify(row.name)
        if kind:
            selected[kind].append(row)
    result: dict[str, list[IndexRow]] = {}
    for kind in CATEGORY_FILES:
        unique: dict[str, IndexRow] = {}
        for row in selected.get(kind, []):
            unique.setdefault(row.fj_id, row)
        result[kind] = list(unique.values())
        logger.info("Selected %-6s: %d structures", kind, len(result[kind]))
        if len(result[kind]) < MIN_COUNTS[kind]:
            raise RuntimeError(f"Selection for {kind} produced only {len(result[kind])} rows")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("assets/bodyparts3d"))
    parser.add_argument("--chunk-size", type=int, default=70)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args.output.mkdir(parents=True, exist_ok=True)

    rows = load_index()
    selected = select_rows(rows)
    all_rows = [row for group in selected.values() for row in group]

    with tempfile.TemporaryDirectory(prefix="bodyparts3d-") as temp:
        work = Path(temp)
        paths = download_selected(all_rows, work, args.chunk_size)
        assets = {}
        for kind in CATEGORY_FILES:
            assets[kind] = export_category(kind, selected[kind], paths, args.output)

    manifest = {
        "name": "BodyParts3D / Anatomography detailed head atlas",
        "version": VERSION,
        "coordinateSystem": "Three.js: X=patient left, Y=superior, Z=anterior",
        "sourceCoordinateSystem": "BodyParts3D millimetres: X=left, Y=posterior, Z=superior",
        "geometrySource": BASE,
        "officialPage": OFFICIAL_PAGE,
        "officialLicense": OFFICIAL_LICENSE,
        "license": "Creative Commons Attribution 4.0 International (current BodyParts3D database license)",
        "attribution": "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "indexSource": INDEX_URL,
        "indexUsage": "Selection metadata only; geometry was downloaded from the BodyParts3D / Anatomography service and validated against the official v4.3 FMA2Obj object universe.",
        "modified": True,
        "modifications": [
            "Selected head-focused structures from the BodyParts3D v4.3 object universe",
            "Converted atlas coordinates from (X left, Y posterior, Z superior) to Three.js (X left, Y superior, Z anterior)",
            "Conservatively decimated only individual meshes exceeding web face budgets",
            "Grouped structures into independently lazy-loadable GLB layers while preserving FJ/FMA identity",
        ],
        "assets": assets,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    (args.output / "build-report.json").write_text(json.dumps({
        "selected": {kind: len(values) for kind, values in selected.items()},
        "built": {kind: assets[kind]["models"] for kind in assets},
        "warnings": {kind: assets[kind]["warnings"] for kind in assets if assets[kind]["warnings"]},
    }, indent=2, sort_keys=True))

    for kind, asset in assets.items():
        logger.info("Built %-6s %3d meshes %7d faces %.2f MB", kind, asset["models"], asset["faces"], asset["bytes"] / 1024 / 1024)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
