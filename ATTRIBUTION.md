# Attribution and model licensing

## Runtime 3D anatomy source

The current Anatomy3D runtime uses modified/exported geometry from **BodyParts3D / Anatomography**, maintained by the Database Center for Life Science (DBCLS).

Official database:

- BodyParts3D — Database Center for Life Science
- https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- Official license page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html

Required attribution for the database:

> **BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International**

The current official BodyParts3D license is **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

## Detailed v4.3 geometry pipeline

The public LSDB bulk download exposes the older BodyParts3D 4.0 OBJ set with a 99% polygon reduction. For this detailed head viewer, the build pipeline instead selects version-4.3 FJ model components, validates them against the version-stamped BodyParts3D `FMA2Obj` object universe, and downloads the geometry from the BodyParts3D / Anatomography service at `lifesciencedb.jp/bp3d`.

A public v4.3 mesh index from `olivercase/body_parts_3d_api` is used only to obtain convenient human-readable FJ/FMA selection metadata. It is **not** the geometry source bundled by Anatomy3D. The build independently validates requested FJ IDs against the BodyParts3D v4.3 manifest before downloading geometry from the BodyParts3D service.

## Modifications made for Anatomy3D

The repository build pipeline creates web derivatives by:

- selecting head-focused structures from the BodyParts3D v4.3 component universe;
- preserving the shared BodyParts3D millimetre coordinate system across all systems;
- converting coordinates from `(X=patient left, Y=posterior, Z=superior)` to the Three.js basis `(X=patient left, Y=superior, Z=anterior)`;
- grouping selected components into bones/teeth, arteries, veins, nerves, muscles and brain/organ layers;
- conservatively simplifying only individual meshes above per-system web face budgets;
- exporting each system to GLB while preserving FJ and FMA identity in mesh metadata/manifests;
- standardizing runtime display materials for interactive educational use.

The generated files are modified web derivatives and are not presented as the original BodyParts3D distribution.

## Generated runtime files

- `assets/bodyparts3d/head-bones.glb`
- `assets/bodyparts3d/head-arteries.glb`
- `assets/bodyparts3d/head-veins.glb`
- `assets/bodyparts3d/head-nerves.glb`
- `assets/bodyparts3d/head-muscles.glb`
- `assets/bodyparts3d/head-organs.glb`
- `assets/bodyparts3d/manifest.json`

## Previous prototype sources

Historical revisions experimented with Z-Anatomy and the Open Anatomy SPL Head & Neck Atlas. The current live viewer no longer depends on those model files. Historical commits and unused legacy assets may still document those experiments until repository cleanup is complete.

## Written educational summaries

The application contains original short-form anatomy summaries based on standard anatomy references. Structure-specific source links point primarily to NCBI Bookshelf/StatPearls pages where available. These summaries are for educational reference and are not medical advice.
