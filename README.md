# Anatomy3D — Detailed BodyParts3D Head Atlas

A static, mobile-friendly interactive 3D head anatomy explorer for GitHub Pages using Three.js and detailed **BodyParts3D / Anatomography v4.3 component meshes**.

## Current runtime

The live viewer uses BodyParts3D assets under `assets/bodyparts3d/`. All systems are converted from the same shared atlas coordinate system; vessels, nerves, muscles and organs are not procedurally drawn and are not independently realigned in the browser.

Validated web layers:

- **Bones & teeth:** 80 meshes, ~8.2 MB
- **Arteries:** 435 meshes, ~10.4 MB
- **Veins & venous structures:** 66 meshes, ~4.2 MB
- **Nerves:** 165 meshes, ~8.6 MB
- **Muscles:** 63 meshes, ~9.1 MB
- **Brain / eye / related organs:** 155 meshes, ~34.5 MB

The manifest indexes **964 detailed selectable components** with FJ/FMA identifiers.

## Performance strategy

The browser does not download all ~76 MB at startup.

- Bones load first so the viewer becomes usable quickly.
- Arteries and veins then load in parallel.
- Nerves, muscles and brain/organs are lazy-loaded only when their layer is enabled or a search result requires them.
- Device pixel ratio is capped on mobile and desktop for smoother rotation.
- Individual very large source meshes are conservatively decimated; smaller structures keep their original detailed geometry.

## Features

- Six independently controlled anatomy systems.
- Detailed facial, deep-face, cerebral and carotid arterial component meshes where present in BodyParts3D.
- Detailed venous structures and venous sinuses where present.
- Cranial/head nerve structures and branches.
- Skull, facial bones and teeth.
- Head/facial/masticatory muscles.
- Brain, eye and related head structures.
- Global search by anatomical name, **FMA ID**, or **FJ mesh ID**.
- Selecting an unloaded search result automatically loads the required anatomical system.
- Rotate, zoom and pan with mouse/touch.
- Focus, isolate, hide and restore individual meshes.
- Adjustable bone opacity.
- Written educational information for curated major structures plus BodyParts3D source identity and mesh detail for every component.
- Mobile system controls.
- No backend and no database.

## Live site

`https://chaishah.github.io/anatomy3d/`

GitHub Pages deploys from `main` using `.github/workflows/pages.yml`.

## BodyParts3D build pipeline

The production asset workflow is `.github/workflows/build-bodyparts3d-assets.yml`.

`tools/build_bodyparts3d_assets.py` plus `tools/build_bodyparts3d_head.py`:

1. Read the BodyParts3D v4.3 structure index to select head-focused component IDs.
2. Validate selected FJ IDs against the official version-stamped v4.3 `FMA2Obj` object universe.
3. Download the actual component OBJ geometry from the BodyParts3D / Anatomography service.
4. Preserve the common BodyParts3D millimetre coordinate system.
5. Convert `(X=left, Y=posterior, Z=superior)` to the viewer basis `(X=left, Y=superior, Z=anterior)` once for every system.
6. Conservatively simplify only meshes above per-system face budgets.
7. Export six independently lazy-loadable GLBs while preserving FJ/FMA identity.
8. Generate `manifest.json` and a validation report.

A full build is exercised in GitHub Actions before the runtime is changed, and the workflow fails if required anatomical categories are missing.

## Educational scope

This is an educational atlas, not patient-specific imaging and not a diagnostic application.

## Source and licensing

See `ATTRIBUTION.md` and `assets/bodyparts3d/manifest.json` for source, license and modification details.
