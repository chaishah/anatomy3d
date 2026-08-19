# Anatomy3D — Head Explorer

A static, mobile-friendly interactive 3D head/skull anatomy prototype built for GitHub Pages using Three.js and Z-Anatomy data.

## Current features

- Loads the upstream Z-Anatomy skeletal FBX in-browser.
- Filters the scene down to skull/head structures.
- Rotate, zoom and pan with mouse/touch.
- Click/tap structures to identify and highlight them.
- Search visible structures on desktop.
- Focus, isolate, hide and restore structures.
- Adjust opacity.
- Front, left, right and back camera presets.
- Responsive mobile layout.
- No backend and no database.

## Live site

Once GitHub Pages is enabled for this repository with **GitHub Actions** as its publishing source, the site is deployed automatically by `.github/workflows/pages.yml`.

Expected URL:

`https://chaishah.github.io/anatomy3d/`

## Architecture

This MVP intentionally uses a build-free static architecture:

- HTML/CSS/JavaScript
- Three.js via jsDelivr
- Z-Anatomy `SkeletalSystem100.fbx` loaded from the upstream GitHub repository
- GitHub Pages hosting

## Performance note

The current proof of concept downloads the full upstream skeletal FBX (about 41 MB) and filters it client-side. This validates the interaction model quickly, but it is not the final performance architecture.

The next production step should extract only the head/skull meshes into a compressed `.glb` asset and host that optimized model with this repository.

## Source and licensing

Upstream model path:

`LluisV/Z-Anatomy/Resources/Models/FBX/SkeletalSystem100.fbx`

See `ATTRIBUTION.md` before redistributing any extracted model assets.
