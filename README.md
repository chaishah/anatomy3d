# Anatomy3D — Head & Vessels

A static, mobile-friendly interactive 3D head anatomy explorer built for GitHub Pages using Three.js and Z-Anatomy data.

## Current features

- Loads the upstream Z-Anatomy skeletal FBX and filters it to the head.
- Removes annotation/helper-like long thin meshes to keep the skull view clean.
- Loads the upstream Z-Anatomy cardiovascular FBX after the skull and filters it to the head/skull-base region.
- Separate layers for bones, arteries and veins/dural venous sinuses.
- Standardized vessel colours: arteries red, veins/sinuses blue, bones neutral.
- Adjustable bone opacity so vessels remain visible through the skull.
- Rotate, zoom and pan with mouse/touch.
- Click/tap structures to identify and highlight them.
- Search loaded 3D structures.
- Focus, isolate, hide and restore structures.
- Written anatomy information for major head arteries, veins, dural sinuses and key skull structures.
- Head-vessel study shortcuts for important vessels such as the facial artery, maxillary artery, internal jugular vein and cavernous sinus.
- Responsive desktop/mobile layout.
- No backend and no database.

## Live site

GitHub Pages deploys automatically from `main` through `.github/workflows/pages.yml` when Pages is configured to use GitHub Actions.

Expected URL:

`https://chaishah.github.io/anatomy3d/`

## Architecture

The app intentionally remains build-free and static:

- HTML/CSS/JavaScript
- Three.js via jsDelivr
- Z-Anatomy `SkeletalSystem100.fbx` loaded from upstream
- Z-Anatomy `CardioVascular41.fbx` loaded from upstream
- GitHub Pages hosting

## Performance note

This proof of concept still downloads the full upstream skeletal and cardiovascular FBX files and filters them client-side. The skull becomes usable first; the larger cardiovascular model loads afterward.

The production optimization should extract only the selected head bones and head vessels into compressed GLB assets. That will reduce transfer size substantially and also allow tighter control over naming, vessel grouping and geometry cleanup.

## Educational information

The written anatomy summaries are short educational reference notes based on standard anatomy sources, including NCBI Bookshelf/StatPearls. Source links are shown in the app for the corresponding structures. They are not medical advice.

## Source and licensing

Upstream model paths:

- `LluisV/Z-Anatomy/Resources/Models/FBX/SkeletalSystem100.fbx`
- `LluisV/Z-Anatomy/Resources/Models/FBX/CardioVascular41.fbx`

See `ATTRIBUTION.md` before redistributing extracted model assets.
