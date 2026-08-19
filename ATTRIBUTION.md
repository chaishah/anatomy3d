# Attribution and model licensing

## Runtime 3D anatomy source

The current Anatomy3D runtime uses modified/exported geometry from the **Open Anatomy Project SPL Head & Neck Atlas**.

Source atlas:

- Open Anatomy Project — SPL Head & Neck Atlas
- https://www.openanatomy.org/atlas-pages/atlas-spl-head-and-neck.html
- Source archive used by the build pipeline: `https://www.openanatomy.org/atlases/nac/head-neck-2016-09.zip`

The atlas is distributed under the licensing terms referenced by the Open Anatomy/3D Slicer project. The generated asset manifest records the source version and modifications made for this viewer.

See:

- `assets/openanatomy/manifest.json`
- `assets/openanatomy/build-report.json`

## Modifications made for Anatomy3D

The repository's build pipeline creates derivative web assets by:

- selecting head/neck bone and vascular structures from the atlas;
- preserving/applying model transforms from the Slicer MRML scene where present;
- converting the Slicer RAS coordinate basis to the Three.js basis used by the viewer;
- triangulating and cleaning the model surfaces;
- conservatively decimating high-density meshes for browser performance;
- exporting the registered structures to GLB;
- standardizing runtime display colours for bones, arteries and veins.

The generated files are clearly identified as modified derivatives and are not presented as the original atlas distribution.

## Generated runtime files

- `assets/openanatomy/head-bones.glb`
- `assets/openanatomy/head-arteries.glb`
- `assets/openanatomy/head-veins.glb`

## 3D Slicer

3D Slicer is not bundled into the website. The source atlas uses Slicer/MRML conventions and the build pipeline consumes those scene/model files to produce web-native assets.

## Previous prototype source

Earlier prototype revisions experimented with Z-Anatomy. The current runtime no longer loads the Z-Anatomy skeletal or cardiovascular FBX files. Historical commits may still reference those experiments.

## Written educational summaries

The application contains original short-form anatomy summaries based on standard anatomy references. Structure-specific source links point primarily to NCBI Bookshelf/StatPearls pages where available. These summaries are for educational reference and are not medical advice.
