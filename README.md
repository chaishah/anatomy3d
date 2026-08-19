# Anatomy3D — Open Anatomy Head & Vessels

A static, mobile-friendly interactive 3D head and neck anatomy explorer for GitHub Pages using Three.js and the **Open Anatomy SPL Head & Neck Atlas**.

## Current runtime

The browser no longer generates schematic vessels and no longer downloads the large Z-Anatomy FBX files.

It loads three compact, registered GLB assets generated from the official SPL Head & Neck Slicer/MRML scene:

- `assets/openanatomy/head-bones.glb`
- `assets/openanatomy/head-arteries.glb`
- `assets/openanatomy/head-veins.glb`

The three files preserve the atlas registration, so bones and vessels share the same coordinate system.

## Features

- Registered skull/mandible/hyoid geometry from the SPL atlas.
- Registered major head and neck arteries from the same atlas.
- Registered venous anatomy from the same atlas.
- Separate Bones, Arteries and Veins layers.
- Adjustable bone opacity for viewing vessels through the skull.
- Rotate, zoom and pan with mouse or touch.
- Click/tap structures to identify and highlight them.
- Search loaded structures.
- Focus, isolate, hide and restore structures.
- Written educational anatomy information for supported vessels and bones.
- Front/left/right/back camera presets.
- Mobile-friendly interface.
- No backend or database.

## Live site

`https://chaishah.github.io/anatomy3d/`

GitHub Pages deploys from `main` using `.github/workflows/pages.yml`.

The Open Anatomy asset workflow also deploys its generated checkout directly. This is intentional because commits created by `GITHUB_TOKEN` do not trigger a second workflow automatically.

## Open Anatomy build pipeline

`tools/build_openanatomy_assets.py` performs the one-time conversion used by the site:

1. Download the official Open Anatomy SPL Head & Neck atlas archive.
2. Parse the Slicer MRML scene and model hierarchy.
3. Resolve the atlas VTK model files.
4. Apply linear MRML model transforms when present.
5. Convert Slicer RAS coordinates to the Three.js coordinate basis used by the viewer.
6. Select bone, artery and vein structures.
7. Clean and conservatively decimate the meshes for browser performance.
8. Export registered GLB files plus `manifest.json` and `build-report.json`.

The generated runtime files are roughly 5 MB total, instead of loading large whole-body FBX files in the browser.

## Why Slicer is not bundled into the website

The source atlas is a 3D Slicer scene, but running Slicer in the browser is unnecessary and would make the site much heavier. Slicer remains useful for inspecting or editing the source atlas. The website consumes the pre-exported GLB assets for fast WebGL rendering.

## Atlas scope

The SPL Head & Neck Atlas contains a limited set of vascular structures. The current viewer intentionally shows the **real vessels present in this atlas** rather than inventing missing facial or intracranial branches. Runtime filtering removes non-head-focused proximal structures such as the aortic arch, superior vena cava and subclavian vessels from the interactive list.

## Educational information

The written anatomy summaries are short educational reference notes based on standard sources, including NCBI Bookshelf/StatPearls where available. They are not medical advice.

## Source and licensing

See `ATTRIBUTION.md` and `assets/openanatomy/manifest.json` for source, modification and licensing information.
