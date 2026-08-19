import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { FEATURED_VESSEL_IDS, infoById, matchAnatomyInfo } from './anatomy-data.js';

const SKELETON_MODEL_URL = 'https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX/SkeletalSystem100.fbx';
const VASCULAR_MODEL_URL = 'https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX/CardioVascular41.fbx';

const HEAD_TERMS = [
  'skull','cranium','cranial','mandible','maxilla','frontal','parietal','temporal','occipital','sphenoid','ethmoid',
  'zygomatic','nasal','lacrimal','palatine','vomer','concha','hyoid','tooth','teeth','incisor','canine','premolar','molar',
  'orbit','jaw','calvaria','facial bone','ossicle','malleus','incus','stapes'
];

const ANNOTATION_TERMS = [
  'label','annotation','leader','pointer','arrow','guide','helper','reference','marker','axis','text','legend','line','measure'
];

const HEAD_VESSEL_TERMS = [
  'carotid','facial','maxillary','temporal','meningeal','ophthalmic','orbital','supraorbital','supratrochlear','infraorbital',
  'alveolar','sphenopalatine','palatine','labial','angular','occipital','auricular','cerebral','communicating','basilar',
  'vertebral','cerebellar','jugular','retromandibular','pterygoid','sagittal','transverse sinus','sigmoid','cavernous',
  'petrosal','straight sinus','occipital sinus','galen','trolard','labbe'
];

const COLORS = {
  bone: new THREE.Color(0xd9dde3),
  artery: new THREE.Color(0xd95757),
  vein: new THREE.Color(0x4d7fd6),
  selected: new THREE.Color(0xf0b64a)
};

const viewer = document.querySelector('#viewer');
const overlay = document.querySelector('#loadingOverlay');
const loadingText = document.querySelector('#loadingText');
const listEl = document.querySelector('#structureList');
const countEl = document.querySelector('#structureCount');
const searchInput = document.querySelector('#searchInput');
const selectedName = document.querySelector('#selectedName');
const selectedMeta = document.querySelector('#selectedMeta');
const selectedKind = document.querySelector('#selectedKind');
const selectedOverview = document.querySelector('#selectedOverview');
const infoDetails = document.querySelector('#infoDetails');
const infoSource = document.querySelector('#infoSource');
const focusBtn = document.querySelector('#focusBtn');
const isolateBtn = document.querySelector('#isolateBtn');
const hideBtn = document.querySelector('#hideBtn');
const showAllBtn = document.querySelector('#showAllBtn');
const bonesToggle = document.querySelector('#bonesToggle');
const arteriesToggle = document.querySelector('#arteriesToggle');
const veinsToggle = document.querySelector('#veinsToggle');
const boneOpacityInput = document.querySelector('#boneOpacityInput');
const boneOpacityValue = document.querySelector('#boneOpacityValue');
const vesselStatus = document.querySelector('#vesselStatus');
const featuredVessels = document.querySelector('#featuredVessels');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1017);
scene.fog = new THREE.Fog(0x0b1017, 120, 500);

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;
controls.minDistance = 0.02;
controls.maxDistance = 1000;

scene.add(new THREE.HemisphereLight(0xdbe9f7, 0x111820, 2.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
keyLight.position.set(5, 8, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x86b8ff, 1.6);
rimLight.position.set(-7, 3, -6);
scene.add(rimLight);

const skeletonRoot = new THREE.Group();
const vascularRoot = new THREE.Group();
scene.add(skeletonRoot, vascularRoot);

let headMeshes = [];
let vesselMeshes = [];
let selected = null;
let headBounds = new THREE.Box3();
let skeletonBodyBox = new THREE.Box3();
let bodyAxis = 'y';
let vesselLoadPromise = null;
let vesselLoaded = false;
let removedHelpers = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

function cleanName(name = '') {
  return name
    .replace(/^mixamorig[:_]?/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Unnamed structure';
}

function meshNameBlob(mesh) {
  return `${mesh.name || ''} ${mesh.parent?.name || ''}`.toLowerCase();
}

function worldBox(mesh) {
  return new THREE.Box3().setFromObject(mesh);
}

function getBoxShape(box) {
  const size = box.getSize(new THREE.Vector3());
  const dims = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)].sort((a, b) => a - b);
  return { size, small: dims[0], middle: dims[1], large: dims[2] };
}

function boxVolume(box) {
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, 0) * Math.max(size.y, 0) * Math.max(size.z, 0);
}

function isAnnotationLikeBone(mesh) {
  const name = meshNameBlob(mesh);
  if (ANNOTATION_TERMS.some((term) => name.includes(term))) return true;

  const positions = mesh.geometry?.attributes?.position;
  if (!positions || positions.count < 18) return true;

  const box = worldBox(mesh);
  const { small, middle, large } = getBoxShape(box);
  if (!Number.isFinite(large) || large <= 0) return true;

  const lineLike = middle / large < 0.035 && positions.count < 700;
  const flatLeader = small / large < 0.0025 && middle / large < 0.075 && positions.count < 900;
  return lineLike || flatLeader;
}

function cloneMaterial(material, kind) {
  const clone = material.clone();
  clone.transparent = true;
  clone.depthWrite = true;

  if (clone.color) clone.color.copy(COLORS[kind] || COLORS.bone);
  if ('roughness' in clone) clone.roughness = kind === 'bone' ? 0.72 : 0.55;
  if ('metalness' in clone) clone.metalness = 0;
  if (clone.emissive) clone.emissive.set(0x000000);
  return clone;
}

function prepareMesh(mesh, kind) {
  mesh.userData.displayName = cleanName(mesh.name);
  mesh.userData.kind = kind;
  mesh.userData.baseVisible = true;
  mesh.userData.hiddenByUser = false;
  mesh.material = Array.isArray(mesh.material)
    ? mesh.material.map((m) => cloneMaterial(m, kind))
    : cloneMaterial(mesh.material, kind);

  if (kind === 'bone' && mesh.geometry?.attributes?.position && !mesh.geometry.attributes.normal) {
    mesh.geometry.computeVertexNormals();
  }

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.userData.originalMaterials = mats.map((m) => ({
    color: m.color?.clone?.(),
    emissive: m.emissive?.clone?.(),
    emissiveIntensity: m.emissiveIntensity ?? 1
  }));
}

function isLikelyHeadByName(mesh) {
  const n = meshNameBlob(mesh);
  return HEAD_TERMS.some((term) => n.includes(term));
}

function spatialHeadFallback(meshes, totalBox) {
  const size = totalBox.getSize(new THREE.Vector3());
  const spans = [size.x, size.y, size.z];
  const axis = spans.indexOf(Math.max(...spans));
  const axisName = ['x', 'y', 'z'][axis];
  const min = totalBox.min[axisName];
  const max = totalBox.max[axisName];
  const span = max - min;
  const endBand = span * 0.24;

  const low = [];
  const high = [];
  for (const mesh of meshes) {
    const b = worldBox(mesh);
    const c = b.getCenter(new THREE.Vector3())[axisName];
    if (c <= min + endBand) low.push(mesh);
    if (c >= max - endBand) high.push(mesh);
  }

  return high.length >= low.length ? high : low;
}

function buildHeadSubset(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry?.attributes?.position) meshes.push(obj);
  });

  skeletonBodyBox = new THREE.Box3().setFromObject(root);
  const bodySize = skeletonBodyBox.getSize(new THREE.Vector3());
  bodyAxis = ['x', 'y', 'z'][[bodySize.x, bodySize.y, bodySize.z].indexOf(Math.max(bodySize.x, bodySize.y, bodySize.z))];

  const named = meshes.filter(isLikelyHeadByName);
  const cleanedNamed = named.filter((mesh) => !isAnnotationLikeBone(mesh));
  removedHelpers = named.length - cleanedNamed.length;

  let keep = cleanedNamed.length >= 6
    ? cleanedNamed
    : spatialHeadFallback(meshes.filter((mesh) => !isAnnotationLikeBone(mesh)), skeletonBodyBox);

  const substantial = [...keep]
    .map((mesh) => ({ mesh, box: worldBox(mesh) }))
    .sort((a, b) => boxVolume(b.box) - boxVolume(a.box))
    .slice(0, Math.min(24, keep.length));

  if (substantial.length) {
    const core = new THREE.Box3();
    substantial.forEach(({ box }) => core.union(box));
    const diag = core.getSize(new THREE.Vector3()).length();
    core.expandByScalar(diag * 0.16);
    keep = keep.filter((mesh) => worldBox(mesh).intersectsBox(core));
  }

  const keepSet = new Set(keep);
  for (const mesh of meshes) {
    const visible = keepSet.has(mesh);
    mesh.visible = visible;
    if (visible) {
      prepareMesh(mesh, 'bone');
    } else {
      mesh.userData.baseVisible = false;
    }
  }

  headMeshes = keep.filter((mesh) => mesh.geometry?.attributes?.position);
  headBounds = computeBounds(headMeshes);
}

function computeBounds(meshes, onlyVisible = false) {
  const box = new THREE.Box3();
  let hasAny = false;
  for (const mesh of meshes) {
    if (onlyVisible && !mesh.visible) continue;
    const b = worldBox(mesh);
    if (!b.isEmpty()) {
      box.union(b);
      hasAny = true;
    }
  }
  return hasAny ? box : new THREE.Box3();
}

function allInteractiveMeshes() {
  return [...headMeshes, ...vesselMeshes];
}

function layerEnabled(kind) {
  if (kind === 'bone') return bonesToggle.checked;
  if (kind === 'artery') return arteriesToggle.checked;
  if (kind === 'vein') return veinsToggle.checked;
  return true;
}

function setMeshOpacity(mesh) {
  const opacity = mesh.userData.kind === 'bone' ? Number(boneOpacityInput.value) : 1;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    m.transparent = opacity < 1;
    m.opacity = opacity;
    m.depthWrite = opacity > 0.42 || mesh.userData.kind !== 'bone';
    m.needsUpdate = true;
  });
}

function updateLayerVisibility() {
  for (const mesh of allInteractiveMeshes()) {
    mesh.visible = Boolean(mesh.userData.baseVisible && !mesh.userData.hiddenByUser && layerEnabled(mesh.userData.kind));
    setMeshOpacity(mesh);
  }
  if (selected && !selected.visible) clearSelection(false);
  renderStructureList(searchInput.value);
}

function fitCamera(box = headBounds, direction = new THREE.Vector3(0, 0, 1)) {
  if (!box || box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.58;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(radius / Math.tan(fov / 2), 0.5) * 1.27;

  const dir = direction.clone().normalize();
  camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
  camera.near = Math.max(distance / 1000, 0.001);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = Math.max(radius * 0.18, 0.02);
  controls.maxDistance = distance * 4;
  controls.update();
}

function focusOn(mesh) {
  const box = worldBox(mesh);
  const direction = camera.position.clone().sub(controls.target).normalize();
  fitCamera(box, direction);
}

function clearHighlight() {
  if (!selected) return;
  const mats = Array.isArray(selected.material) ? selected.material : [selected.material];
  mats.forEach((mat, i) => {
    const original = selected.userData.originalMaterials?.[i];
    if (mat.color && original?.color) mat.color.copy(original.color);
    if (mat.emissive && original?.emissive) mat.emissive.copy(original.emissive);
    if ('emissiveIntensity' in mat && original) mat.emissiveIntensity = original.emissiveIntensity;
  });
  setMeshOpacity(selected);
}

function applyHighlight(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mat) => {
    if (mat.emissive) {
      mat.emissive.copy(COLORS.selected).multiplyScalar(0.42);
      mat.emissiveIntensity = 1.35;
    } else if (mat.color) {
      mat.color.lerp(COLORS.selected, 0.55);
    }
  });
}

function kindLabel(kind) {
  if (kind === 'artery') return 'Artery';
  if (kind === 'vein') return 'Vein / venous sinus';
  return 'Bone';
}

function renderInfo(info, mesh = null) {
  const kind = info?.kind || mesh?.userData?.kind || 'bone';
  selectedKind.textContent = kindLabel(kind);
  selectedKind.dataset.kind = kind;
  selectedName.textContent = info?.title || mesh?.userData?.displayName || 'Nothing selected';

  if (!info && !mesh) {
    selectedMeta.textContent = 'Tap a structure in the model, choose one from the list, or open a vessel guide below.';
    selectedOverview.textContent = 'Select an anatomical structure to see written information here.';
    infoDetails.innerHTML = '';
    infoSource.replaceChildren();
    return;
  }

  selectedMeta.textContent = mesh
    ? `${kindLabel(kind)} · 3D structure selected`
    : `${kindLabel(kind)} · written head-vasculature guide`;

  selectedOverview.textContent = info?.overview || `${mesh?.userData?.displayName || 'This structure'} is part of the head anatomy model.`;
  infoDetails.innerHTML = '';

  if (info) {
    const details = [
      ['Course / relationship', info.course],
      [kind === 'vein' ? 'Drainage' : kind === 'artery' ? 'Supply' : 'Role', info.territory],
      ['Clinical relevance', info.clinical]
    ];
    for (const [label, value] of details) {
      const section = document.createElement('section');
      section.className = 'detail-block';
      const heading = document.createElement('h3');
      heading.textContent = label;
      const paragraph = document.createElement('p');
      paragraph.textContent = value;
      section.append(heading, paragraph);
      infoDetails.appendChild(section);
    }
  }

  infoSource.replaceChildren();
  if (info?.source) {
    const sourceLink = document.createElement('a');
    sourceLink.href = info.source[1];
    sourceLink.target = '_blank';
    sourceLink.rel = 'noreferrer';
    sourceLink.textContent = info.source[0];
    infoSource.append('Educational reference: ', sourceLink);
  }
}

function clearSelection(resetInfo = true) {
  clearHighlight();
  selected = null;
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = true;
  if (resetInfo) renderInfo(null, null);
}

function selectMesh(mesh, fromList = false) {
  if (!mesh) return;
  clearHighlight();
  selected = mesh;
  applyHighlight(mesh);
  const info = matchAnatomyInfo(mesh.userData.displayName, mesh.userData.kind);
  renderInfo(info, mesh);
  focusBtn.disabled = false;
  isolateBtn.disabled = false;
  hideBtn.disabled = false;
  renderStructureList(searchInput.value);
  if (fromList) focusOn(mesh);
}

function findLoadedMeshForInfo(info) {
  if (!info) return null;
  const aliases = info.aliases.map((alias) => alias.toLowerCase());
  return allInteractiveMeshes().find((mesh) => {
    if (mesh.userData.kind !== info.kind) return false;
    const name = mesh.userData.displayName.toLowerCase();
    return aliases.some((alias) => name.includes(alias) || alias.includes(name));
  }) || null;
}

function selectGuide(info) {
  if (!info) return;
  const mesh = findLoadedMeshForInfo(info);
  if (mesh) {
    if (!layerEnabled(mesh.userData.kind)) {
      if (mesh.userData.kind === 'artery') arteriesToggle.checked = true;
      if (mesh.userData.kind === 'vein') veinsToggle.checked = true;
      updateLayerVisibility();
    }
    selectMesh(mesh, true);
    return;
  }

  clearSelection(false);
  renderInfo(info, null);
  if (info.kind === 'artery' || info.kind === 'vein') ensureVesselsLoaded().catch(() => {});
  renderFeaturedVessels(info.id);
}

function renderStructureList(query = '') {
  const q = query.trim().toLowerCase();
  const items = allInteractiveMeshes()
    .filter((mesh) => mesh.userData.baseVisible)
    .filter((mesh) => !q || mesh.userData.displayName.toLowerCase().includes(q))
    .sort((a, b) => {
      const kindOrder = { artery: 0, vein: 1, bone: 2 };
      const kindDiff = kindOrder[a.userData.kind] - kindOrder[b.userData.kind];
      return kindDiff || a.userData.displayName.localeCompare(b.userData.displayName);
    });

  countEl.textContent = allInteractiveMeshes().filter((mesh) => mesh.userData.baseVisible).length;
  listEl.innerHTML = '';

  for (const mesh of items.slice(0, 350)) {
    const button = document.createElement('button');
    button.className = `structure-item${mesh === selected ? ' active' : ''}${layerEnabled(mesh.userData.kind) ? '' : ' layer-off'}`;
    button.title = mesh.userData.displayName;

    const dot = document.createElement('span');
    dot.className = `structure-dot ${mesh.userData.kind}`;
    const text = document.createElement('span');
    text.textContent = mesh.userData.displayName;
    button.append(dot, text);
    button.addEventListener('click', () => selectMesh(mesh, true));
    listEl.appendChild(button);
  }
}

function renderFeaturedVessels(activeId = null) {
  featuredVessels.innerHTML = '';
  for (const id of FEATURED_VESSEL_IDS) {
    const info = infoById(id);
    if (!info) continue;
    const button = document.createElement('button');
    button.className = `vessel-chip ${info.kind}${activeId === info.id ? ' active' : ''}`;
    button.textContent = info.title;
    button.addEventListener('click', () => selectGuide(info));
    featuredVessels.appendChild(button);
  }
}

function showAll() {
  for (const mesh of allInteractiveMeshes()) mesh.userData.hiddenByUser = false;
  updateLayerVisibility();
}

function isolateSelected() {
  if (!selected) return;
  for (const mesh of allInteractiveMeshes()) mesh.visible = mesh === selected;
  focusOn(selected);
}

function hideSelected() {
  if (!selected) return;
  const mesh = selected;
  clearSelection(false);
  mesh.userData.hiddenByUser = true;
  mesh.visible = false;
  renderInfo(null, null);
  renderStructureList(searchInput.value);
}

function inferVesselKind(mesh) {
  const n = meshNameBlob(mesh);
  if (/\b(artery|arterial|arteria|a\.)\b/i.test(n)) return 'artery';
  if (/\b(vein|venous|vena|sinus)\b/i.test(n)) return 'vein';

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const colors = mats.map((m) => m?.color).filter(Boolean);
  if (colors.length) {
    const avg = colors.reduce((acc, c) => acc.add(c), new THREE.Color()).multiplyScalar(1 / colors.length);
    if (avg.r > avg.b * 1.18 && avg.r > avg.g * 1.05) return 'artery';
    if (avg.b > avg.r * 1.12) return 'vein';
  }
  return null;
}

function isExplicitHeadVessel(mesh) {
  const n = meshNameBlob(mesh);
  return HEAD_VESSEL_TERMS.some((term) => n.includes(term));
}

function alignVascularToSkeleton(root) {
  root.updateMatrixWorld(true);
  let vascularBox = new THREE.Box3().setFromObject(root);
  if (vascularBox.isEmpty() || skeletonBodyBox.isEmpty()) return;

  const skeletalSize = skeletonBodyBox.getSize(new THREE.Vector3());
  const vascularSize = vascularBox.getSize(new THREE.Vector3());
  const skeletalSpan = skeletalSize[bodyAxis];
  const vascularSpan = vascularSize[bodyAxis];
  if (!skeletalSpan || !vascularSpan) return;

  const scaleRatio = skeletalSpan / vascularSpan;
  if (scaleRatio > 0.2 && scaleRatio < 5 && Math.abs(1 - scaleRatio) > 0.015) {
    root.scale.multiplyScalar(scaleRatio);
    root.updateMatrixWorld(true);
    vascularBox = new THREE.Box3().setFromObject(root);
  }

  const skeletalCenter = skeletonBodyBox.getCenter(new THREE.Vector3());
  const vascularCenter = vascularBox.getCenter(new THREE.Vector3());
  const offset = skeletalCenter.sub(vascularCenter);
  const bodyDiag = skeletonBodyBox.getSize(new THREE.Vector3()).length();
  if (offset.length() < bodyDiag * 0.35) {
    root.position.add(offset);
    root.updateMatrixWorld(true);
  }
}

function buildHeadVessels(root) {
  alignVascularToSkeleton(root);
  const headDiag = headBounds.getSize(new THREE.Vector3()).length();
  const region = headBounds.clone().expandByScalar(headDiag * 0.28);
  const kept = [];

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position || obj.geometry.attributes.position.count < 8) return;
    const n = meshNameBlob(obj);
    if (ANNOTATION_TERMS.some((term) => n.includes(term))) return;

    const kind = inferVesselKind(obj);
    if (!kind) return;

    const box = worldBox(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const { large } = getBoxShape(box);
    const explicitlyHead = isExplicitHeadVessel(obj);
    const inHeadRegion = region.containsPoint(center);
    const reasonableSpan = large < headDiag * 2.6;

    if (!(inHeadRegion || (explicitlyHead && reasonableSpan))) return;

    prepareMesh(obj, kind);
    kept.push(obj);
  });

  const keepSet = new Set(kept);
  root.traverse((obj) => {
    if (obj.isMesh && !keepSet.has(obj)) obj.visible = false;
  });

  vesselMeshes = kept;
  updateLayerVisibility();
  renderStructureList(searchInput.value);
}

function ensureVesselsLoaded() {
  if (vesselLoaded) return Promise.resolve();
  if (vesselLoadPromise) return vesselLoadPromise;

  vesselStatus.textContent = 'Loading head arteries and veins…';
  vesselStatus.dataset.state = 'loading';
  const loader = new FBXLoader();

  vesselLoadPromise = new Promise((resolve, reject) => {
    loader.load(
      VASCULAR_MODEL_URL,
      (fbx) => {
        vascularRoot.add(fbx);
        buildHeadVessels(fbx);
        vesselLoaded = true;
        vesselStatus.textContent = `${vesselMeshes.filter((m) => m.userData.kind === 'artery').length} arteries · ${vesselMeshes.filter((m) => m.userData.kind === 'vein').length} veins/sinuses`;
        vesselStatus.dataset.state = 'ready';
        resolve();
      },
      (event) => {
        const mb = (event.loaded / 1024 / 1024).toFixed(1);
        vesselStatus.textContent = event.total
          ? `Loading vessels ${Math.round(event.loaded / event.total * 100)}% · ${mb} MB`
          : `Loading vessels · ${mb} MB`;
      },
      (error) => {
        console.error(error);
        vesselStatus.textContent = 'Vessel model could not load. Reload or check the connection.';
        vesselStatus.dataset.state = 'error';
        vesselLoadPromise = null;
        reject(error);
      }
    );
  });

  return vesselLoadPromise;
}

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(allInteractiveMeshes().filter((mesh) => mesh.visible), false);
  if (hits[0]?.object) selectMesh(hits[0].object);
}

function resize() {
  const { clientWidth, clientHeight } = viewer;
  camera.aspect = Math.max(clientWidth, 1) / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

function setPreset(name) {
  const directions = {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0)
  };
  fitCamera(headBounds, directions[name] || new THREE.Vector3(0, 0, 1));
}

function onSkeletonLoaded(fbx) {
  skeletonRoot.add(fbx);
  buildHeadSubset(fbx);
  renderStructureList();
  showAll();
  fitCamera(headBounds);

  loadingText.textContent = `${headMeshes.length} clean head structures ready${removedHelpers ? ` · ${removedHelpers} helper meshes removed` : ''}`;
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 450);

  renderFeaturedVessels();
  if (arteriesToggle.checked || veinsToggle.checked) ensureVesselsLoaded().catch(() => {});
}

const skeletonLoader = new FBXLoader();
skeletonLoader.load(
  SKELETON_MODEL_URL,
  onSkeletonLoaded,
  (event) => {
    if (event.total) {
      const pct = Math.round((event.loaded / event.total) * 100);
      loadingText.textContent = `${pct}% · ${(event.loaded / 1024 / 1024).toFixed(1)} MB`;
    } else {
      loadingText.textContent = `${(event.loaded / 1024 / 1024).toFixed(1)} MB downloaded`;
    }
  },
  (error) => {
    console.error(error);
    loadingText.textContent = 'Could not load the upstream skeletal FBX. Check the connection and reload.';
  }
);

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown || event.button !== 0) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved < 6) pick(event);
});

searchInput.addEventListener('input', () => renderStructureList(searchInput.value));
focusBtn.addEventListener('click', () => selected && focusOn(selected));
isolateBtn.addEventListener('click', isolateSelected);
hideBtn.addEventListener('click', hideSelected);
showAllBtn.addEventListener('click', () => { showAll(); fitCamera(headBounds); });
document.querySelector('#resetBtn').addEventListener('click', () => { showAll(); fitCamera(headBounds); });

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => setPreset(btn.dataset.view));
});

bonesToggle.addEventListener('change', updateLayerVisibility);
arteriesToggle.addEventListener('change', () => {
  if (arteriesToggle.checked) ensureVesselsLoaded().catch(() => {});
  updateLayerVisibility();
});
veinsToggle.addEventListener('change', () => {
  if (veinsToggle.checked) ensureVesselsLoaded().catch(() => {});
  updateLayerVisibility();
});
boneOpacityInput.addEventListener('input', () => {
  boneOpacityValue.textContent = `${Math.round(Number(boneOpacityInput.value) * 100)}%`;
  headMeshes.forEach(setMeshOpacity);
  if (selected?.userData.kind === 'bone') applyHighlight(selected);
});

const aboutDialog = document.querySelector('#aboutDialog');
document.querySelector('#aboutBtn').addEventListener('click', () => aboutDialog.showModal());
document.querySelector('#closeAbout').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});

renderInfo(null, null);
renderFeaturedVessels();
new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
