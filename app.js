import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { FEATURED_VESSEL_IDS, infoById, matchAnatomyInfo } from './anatomy-data.js';

const SKELETON_MODEL_URL = 'https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX/SkeletalSystem100.fbx';

const HEAD_TERMS = [
  'skull','cranium','cranial','mandible','maxilla','frontal','parietal','temporal','occipital','sphenoid','ethmoid',
  'zygomatic','nasal','lacrimal','palatine','vomer','concha','hyoid','tooth','teeth','incisor','canine','premolar','molar',
  'orbit','jaw','calvaria','facial bone','ossicle','malleus','incus','stapes'
];

const ANNOTATION_TERMS = [
  'label','annotation','leader','pointer','arrow','guide','helper','reference','marker','axis','text','legend','line','measure'
];

const COLORS = {
  bone: new THREE.Color(0xdce1e7),
  artery: new THREE.Color(0xe05656),
  vein: new THREE.Color(0x4f82db),
  selected: new THREE.Color(0xf2b84b)
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
const vesselRoot = new THREE.Group();
scene.add(skeletonRoot, vesselRoot);

let headMeshes = [];
let vesselMeshes = [];
let selected = null;
let headBounds = new THREE.Box3();
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
  return { small: dims[0], middle: dims[1], large: dims[2] };
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

function makeMaterial(kind) {
  return new THREE.MeshStandardMaterial({
    color: COLORS[kind] || COLORS.bone,
    roughness: kind === 'bone' ? 0.72 : 0.46,
    metalness: 0,
    transparent: kind === 'bone'
  });
}

function prepareMesh(mesh, kind) {
  mesh.userData.displayName = cleanName(mesh.name);
  mesh.userData.kind = kind;
  mesh.userData.baseVisible = true;
  mesh.userData.hiddenByUser = false;

  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const cloned = sourceMaterials.map((material) => {
    const next = material?.clone?.() || makeMaterial(kind);
    if (next.color) next.color.copy(COLORS[kind] || COLORS.bone);
    if ('roughness' in next) next.roughness = kind === 'bone' ? 0.72 : 0.46;
    if ('metalness' in next) next.metalness = 0;
    if (next.emissive) next.emissive.set(0x000000);
    next.transparent = kind === 'bone';
    return next;
  });
  mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];

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
    const center = worldBox(mesh).getCenter(new THREE.Vector3())[axisName];
    if (center <= min + endBand) low.push(mesh);
    if (center >= max - endBand) high.push(mesh);
  }
  return high.length >= low.length ? high : low;
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

function buildHeadSubset(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry?.attributes?.position) meshes.push(obj);
  });

  const totalBox = new THREE.Box3().setFromObject(root);
  const named = meshes.filter(isLikelyHeadByName);
  const cleanedNamed = named.filter((mesh) => !isAnnotationLikeBone(mesh));
  removedHelpers = named.length - cleanedNamed.length;

  let keep = cleanedNamed.length >= 6
    ? cleanedNamed
    : spatialHeadFallback(meshes.filter((mesh) => !isAnnotationLikeBone(mesh)), totalBox);

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
    if (visible) prepareMesh(mesh, 'bone');
    else mesh.userData.baseVisible = false;
  }

  headMeshes = keep.filter((mesh) => mesh.geometry?.attributes?.position);
  headBounds = computeBounds(headMeshes);
}

function buildGuaranteedHeadVessels() {
  vesselRoot.clear();
  vesselMeshes = [];
  if (headBounds.isEmpty()) return;

  const center = headBounds.getCenter(new THREE.Vector3());
  const size = headBounds.getSize(new THREE.Vector3());
  const baseRadius = Math.max(Math.min(size.x, size.y, size.z) * 0.0105, size.length() * 0.0022);

  const P = (x, y, z) => new THREE.Vector3(
    center.x + x * size.x * 0.5,
    center.y + y * size.y * 0.5,
    center.z + z * size.z * 0.5
  );

  const addVessel = (name, kind, points, radius = 1) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => P(x, y, z)));
    const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 12), baseRadius * radius, 10, false);
    const mesh = new THREE.Mesh(geometry, makeMaterial(kind));
    mesh.name = name;
    prepareMesh(mesh, kind);
    mesh.userData.source = 'major-head-vessel-overlay';
    mesh.renderOrder = kind === 'artery' ? 3 : 2;
    vesselRoot.add(mesh);
    vesselMeshes.push(mesh);
    return mesh;
  };

  const bilateral = (baseName, kind, rightPoints, radius = 1) => {
    addVessel(`Right ${baseName}`, kind, rightPoints, radius);
    addVessel(`Left ${baseName}`, kind, rightPoints.map(([x, y, z]) => [-x, y, z]), radius);
  };

  bilateral('external carotid artery', 'artery', [[0.48,-0.98,-0.18],[0.50,-0.65,-0.10],[0.56,-0.28,0.00],[0.56,0.05,0.04]], 1.25);
  bilateral('internal carotid artery', 'artery', [[0.28,-0.98,-0.28],[0.25,-0.55,-0.23],[0.20,-0.12,-0.18],[0.16,0.23,-0.12]], 1.15);
  bilateral('facial artery', 'artery', [[0.52,-0.40,0.12],[0.61,-0.28,0.36],[0.52,-0.04,0.60],[0.36,0.20,0.76],[0.18,0.39,0.80]], 0.82);
  bilateral('maxillary artery', 'artery', [[0.56,-0.15,0.00],[0.43,-0.08,0.12],[0.28,0.02,0.29],[0.16,0.10,0.44]], 0.86);
  bilateral('superficial temporal artery', 'artery', [[0.57,0.02,0.02],[0.69,0.28,0.08],[0.75,0.56,0.04],[0.69,0.84,-0.02]], 0.75);
  bilateral('middle meningeal artery', 'artery', [[0.36,-0.10,-0.18],[0.42,0.18,-0.24],[0.48,0.48,-0.28],[0.36,0.76,-0.30]], 0.62);
  bilateral('ophthalmic artery', 'artery', [[0.16,0.22,-0.05],[0.17,0.23,0.27],[0.18,0.22,0.62]], 0.55);
  bilateral('middle cerebral artery', 'artery', [[0.16,0.25,-0.12],[0.35,0.32,-0.12],[0.54,0.35,-0.14],[0.72,0.41,-0.19]], 0.68);
  bilateral('anterior cerebral artery', 'artery', [[0.15,0.25,-0.12],[0.08,0.33,-0.08],[0.03,0.49,-0.05],[0.02,0.68,-0.06]], 0.58);
  bilateral('posterior cerebral artery', 'artery', [[0.03,0.22,-0.41],[0.18,0.28,-0.39],[0.42,0.31,-0.41],[0.62,0.28,-0.49]], 0.62);
  bilateral('vertebral artery', 'artery', [[0.12,-1.02,-0.45],[0.12,-0.65,-0.43],[0.10,-0.30,-0.42],[0.05,0.02,-0.43]], 0.75);
  addVessel('Basilar artery', 'artery', [[0,-0.26,-0.44],[0,-0.02,-0.43],[0,0.22,-0.42]], 0.82);

  bilateral('internal jugular vein', 'vein', [[0.64,-1.02,-0.32],[0.63,-0.67,-0.29],[0.60,-0.35,-0.28],[0.62,-0.12,-0.30]], 1.35);
  bilateral('external jugular vein', 'vein', [[0.78,-1.00,-0.18],[0.75,-0.66,-0.05],[0.71,-0.35,0.00],[0.68,-0.10,0.00]], 0.92);
  bilateral('facial vein', 'vein', [[0.57,-0.43,0.26],[0.63,-0.25,0.49],[0.54,0.03,0.72],[0.34,0.26,0.82],[0.18,0.43,0.82]], 0.82);
  bilateral('retromandibular vein', 'vein', [[0.67,-0.63,-0.02],[0.67,-0.36,-0.02],[0.66,-0.10,0.00],[0.66,0.10,0.00]], 0.84);
  bilateral('superior ophthalmic vein', 'vein', [[0.18,0.25,0.64],[0.18,0.23,0.30],[0.20,0.18,0.00]], 0.58);
  bilateral('cavernous sinus', 'vein', [[0.11,0.13,0.03],[0.17,0.16,-0.02],[0.24,0.14,-0.07]], 1.35);
  addVessel('Superior sagittal sinus', 'vein', [[0,0.83,0.64],[0,0.91,0.30],[0,0.92,-0.10],[0,0.86,-0.48],[0,0.72,-0.67]], 1.15);
  bilateral('transverse sinus', 'vein', [[0.02,0.72,-0.67],[0.25,0.68,-0.68],[0.54,0.58,-0.64],[0.72,0.48,-0.58]], 1.05);
  bilateral('sigmoid sinus', 'vein', [[0.72,0.48,-0.58],[0.78,0.30,-0.55],[0.73,0.12,-0.48],[0.66,-0.12,-0.38]], 1.02);

  const plexusBranches = [
    [[0.42,-0.12,0.13],[0.51,-0.03,0.22],[0.48,0.08,0.32]],
    [[0.44,-0.04,0.08],[0.56,0.02,0.18],[0.50,0.15,0.27]],
    [[0.40,0.02,0.18],[0.52,0.10,0.10],[0.57,0.18,0.22]],
    [[0.46,-0.16,0.24],[0.58,-0.05,0.30],[0.55,0.10,0.36]]
  ];
  for (const side of ['Right', 'Left']) {
    const sign = side === 'Right' ? 1 : -1;
    plexusBranches.forEach((branch, index) => {
      addVessel(`${side} pterygoid venous plexus ${index + 1}`, 'vein', branch.map(([x,y,z]) => [x * sign,y,z]), 0.48);
    });
  }

  vesselStatus.textContent = `${vesselMeshes.filter((m) => m.userData.kind === 'artery').length} arterial structures · ${vesselMeshes.filter((m) => m.userData.kind === 'vein').length} venous structures ready`;
  vesselStatus.dataset.state = 'ready';
}

function allInteractiveMeshes() { return [...headMeshes, ...vesselMeshes]; }
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
    m.depthWrite = mesh.userData.kind !== 'bone' || opacity > 0.42;
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
    } else if (mat.color) mat.color.lerp(COLORS.selected, 0.55);
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
  selectedMeta.textContent = mesh ? `${kindLabel(kind)} · interactive 3D structure` : `${kindLabel(kind)} · written head-vasculature guide`;
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
    if (mesh.userData.kind === 'artery') arteriesToggle.checked = true;
    if (mesh.userData.kind === 'vein') veinsToggle.checked = true;
    updateLayerVisibility();
    selectMesh(mesh, true);
  } else {
    clearSelection(false);
    renderInfo(info, null);
  }
  renderFeaturedVessels(info.id);
}
function renderStructureList(query = '') {
  const q = query.trim().toLowerCase();
  const items = allInteractiveMeshes()
    .filter((mesh) => mesh.userData.baseVisible)
    .filter((mesh) => !q || mesh.userData.displayName.toLowerCase().includes(q))
    .sort((a, b) => {
      const kindOrder = { artery: 0, vein: 1, bone: 2 };
      return kindOrder[a.userData.kind] - kindOrder[b.userData.kind] || a.userData.displayName.localeCompare(b.userData.displayName);
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
  buildGuaranteedHeadVessels();
  renderFeaturedVessels();
  showAll();
  fitCamera(headBounds);
  loadingText.textContent = `${headMeshes.length} clean head structures ready${removedHelpers ? ` · ${removedHelpers} helper meshes removed` : ''}`;
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 450);
}

const skeletonLoader = new FBXLoader();
skeletonLoader.load(
  SKELETON_MODEL_URL,
  onSkeletonLoaded,
  (event) => {
    if (event.total) loadingText.textContent = `${Math.round(event.loaded / event.total * 100)}% · ${(event.loaded / 1024 / 1024).toFixed(1)} MB`;
    else loadingText.textContent = `${(event.loaded / 1024 / 1024).toFixed(1)} MB downloaded`;
  },
  (error) => {
    console.error(error);
    loadingText.textContent = 'Could not load the upstream skeletal FBX. Check the connection and reload.';
  }
);

renderer.domElement.addEventListener('pointerdown', (event) => { pointerDown = { x: event.clientX, y: event.clientY }; });
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
document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setPreset(btn.dataset.view)));
bonesToggle.addEventListener('change', updateLayerVisibility);
arteriesToggle.addEventListener('change', updateLayerVisibility);
veinsToggle.addEventListener('change', updateLayerVisibility);
boneOpacityInput.addEventListener('input', () => {
  boneOpacityValue.textContent = `${Math.round(Number(boneOpacityInput.value) * 100)}%`;
  headMeshes.forEach(setMeshOpacity);
  if (selected?.userData.kind === 'bone') applyHighlight(selected);
});

const aboutDialog = document.querySelector('#aboutDialog');
document.querySelector('#aboutBtn').addEventListener('click', () => aboutDialog.showModal());
document.querySelector('#closeAbout').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => { if (event.target === aboutDialog) aboutDialog.close(); });

renderInfo(null, null);
renderFeaturedVessels();
new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
