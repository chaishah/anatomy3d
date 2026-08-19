import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FEATURED_VESSEL_IDS, infoById, matchAnatomyInfo } from './anatomy-data.js';

const ASSET_BASE = './assets/openanatomy/';
const ASSETS = {
  bone: `${ASSET_BASE}head-bones.glb`,
  artery: `${ASSET_BASE}head-arteries.glb`,
  vein: `${ASSET_BASE}head-veins.glb`,
};
const MANIFEST_URL = `${ASSET_BASE}manifest.json`;
const OPEN_ANATOMY_PAGE = 'https://www.openanatomy.org/atlas-pages/atlas-spl-head-and-neck.html';

const EXCLUDED_RUNTIME_STRUCTURES = [
  /muscle/i,
  /arch of aorta/i,
  /brachiocephalic/i,
  /subclavian/i,
  /superior vena cava/i,
];

const COLORS = {
  bone: new THREE.Color(0xe1e4e8),
  artery: new THREE.Color(0xe55555),
  vein: new THREE.Color(0x4d82dc),
  selected: new THREE.Color(0xf2b84b),
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

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
camera.position.set(0, 0, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.35 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;
controls.rotateSpeed = 0.72;
controls.zoomSpeed = 0.85;
controls.panSpeed = 0.75;

scene.add(new THREE.HemisphereLight(0xe5edf5, 0x18202a, 2.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(2.5, 4.5, 5.5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.5);
fillLight.position.set(-4, 1.5, 2);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0x8ab6ff, 1.2);
rimLight.position.set(0, 2, -5);
scene.add(rimLight);

const atlasRoot = new THREE.Group();
scene.add(atlasRoot);

const groups = { bone: new THREE.Group(), artery: new THREE.Group(), vein: new THREE.Group() };
Object.values(groups).forEach((group) => atlasRoot.add(group));

let interactiveMeshes = [];
let selected = null;
let atlasBounds = new THREE.Box3();
let manifest = null;
let pointerDown = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function cleanName(name = '', kind = '') {
  let value = name
    .replace(/^Model\s*\d+\s*/i, '')
    .replace(/^Model[_ -]?\d+[_ -]*/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) value = 'Unnamed structure';
  if (kind === 'artery' && /\b(common|internal|external) carotid$/i.test(value)) value += ' artery';
  if (kind === 'vein' && /\binternal jugular$/i.test(value)) value += ' vein';
  return value.replace(/\b(right|left)\b/i, (side) => side[0].toUpperCase() + side.slice(1).toLowerCase());
}

function shouldExclude(name) {
  return EXCLUDED_RUNTIME_STRUCTURES.some((pattern) => pattern.test(name));
}

function makeMaterial(kind) {
  const isBone = kind === 'bone';
  return new THREE.MeshStandardMaterial({
    color: COLORS[kind],
    roughness: isBone ? 0.72 : 0.46,
    metalness: 0,
    transparent: isBone,
    opacity: isBone ? Number(boneOpacityInput.value) : 1,
    depthWrite: isBone ? Number(boneOpacityInput.value) >= 0.72 : true,
  });
}

function prepareMesh(mesh, kind) {
  const displayName = cleanName(mesh.name, kind);
  mesh.userData.kind = kind;
  mesh.userData.displayName = displayName;
  mesh.userData.baseVisible = !shouldExclude(displayName);
  mesh.userData.hiddenByUser = false;
  mesh.visible = mesh.userData.baseVisible;

  if (!mesh.geometry?.attributes?.normal) mesh.geometry?.computeVertexNormals?.();
  mesh.material = makeMaterial(kind);
  mesh.renderOrder = kind === 'bone' ? 0 : kind === 'vein' ? 2 : 3;
  mesh.frustumCulled = true;

  mesh.userData.baseColor = mesh.material.color.clone();
  interactiveMeshes.push(mesh);
}

function prepareGroup(root, kind) {
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry?.attributes?.position) prepareMesh(obj, kind);
  });
  groups[kind].add(root);
}

function layerEnabled(kind) {
  if (kind === 'bone') return bonesToggle.checked;
  if (kind === 'artery') return arteriesToggle.checked;
  if (kind === 'vein') return veinsToggle.checked;
  return true;
}

function updateMaterialOpacity(mesh) {
  if (mesh.userData.kind !== 'bone') return;
  const opacity = Number(boneOpacityInput.value);
  mesh.material.transparent = opacity < 1;
  mesh.material.opacity = opacity;
  mesh.material.depthWrite = opacity >= 0.72;
  mesh.material.needsUpdate = true;
}

function updateVisibility() {
  for (const mesh of interactiveMeshes) {
    mesh.visible = Boolean(mesh.userData.baseVisible && !mesh.userData.hiddenByUser && layerEnabled(mesh.userData.kind));
    updateMaterialOpacity(mesh);
  }
  if (selected && !selected.visible) clearSelection(false);
  renderStructureList(searchInput.value);
}

function computeBounds(meshes = interactiveMeshes, visibleOnly = false) {
  const box = new THREE.Box3();
  let has = false;
  for (const mesh of meshes) {
    if (!mesh.userData.baseVisible || (visibleOnly && !mesh.visible)) continue;
    const meshBox = new THREE.Box3().setFromObject(mesh);
    if (!meshBox.isEmpty()) {
      box.union(meshBox);
      has = true;
    }
  }
  return has ? box : new THREE.Box3();
}

function fitCamera(box = atlasBounds, direction = new THREE.Vector3(0, 0, 1), padding = 1.22) {
  if (!box || box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(radius / Math.tan(fov / 2), 1) * padding;
  const dir = direction.clone().normalize();
  camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
  controls.target.copy(center);
  camera.near = Math.max(distance / 1500, 0.1);
  camera.far = distance * 30;
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(radius * 0.14, 2);
  controls.maxDistance = distance * 4;
  controls.update();
}

function focusOn(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const direction = camera.position.clone().sub(controls.target).normalize();
  fitCamera(box, direction, 1.65);
}

function clearHighlight() {
  if (!selected?.material?.color) return;
  selected.material.color.copy(selected.userData.baseColor || COLORS[selected.userData.kind]);
  selected.material.emissive?.set?.(0x000000);
  if ('emissiveIntensity' in selected.material) selected.material.emissiveIntensity = 1;
}

function applyHighlight(mesh) {
  if (mesh.material.emissive) {
    mesh.material.emissive.copy(COLORS.selected).multiplyScalar(0.35);
    mesh.material.emissiveIntensity = 1.25;
  } else {
    mesh.material.color.lerp(COLORS.selected, 0.5);
  }
}

function kindLabel(kind) {
  if (kind === 'artery') return 'Artery';
  if (kind === 'vein') return 'Vein';
  return 'Bone';
}

function renderInfo(info, mesh = null) {
  const kind = info?.kind || mesh?.userData?.kind || 'bone';
  selectedKind.textContent = kindLabel(kind);
  selectedKind.dataset.kind = kind;
  selectedName.textContent = info?.title || mesh?.userData?.displayName || 'Nothing selected';

  if (!info && !mesh) {
    selectedMeta.textContent = 'Tap a structure in the model or choose one from the list.';
    selectedOverview.textContent = 'Select a registered Open Anatomy structure to see written information here.';
    infoDetails.innerHTML = '';
    infoSource.replaceChildren();
    return;
  }

  selectedMeta.textContent = `${kindLabel(kind)} · Open Anatomy SPL Head & Neck Atlas`;
  selectedOverview.textContent = info?.overview || `${mesh.userData.displayName} is a registered 3D structure from the SPL Head & Neck Atlas.`;
  infoDetails.innerHTML = '';

  if (info) {
    const rows = [
      ['Course / relationship', info.course],
      [kind === 'vein' ? 'Drainage' : kind === 'artery' ? 'Supply' : 'Role', info.territory],
      ['Clinical relevance', info.clinical],
    ];
    for (const [label, value] of rows) {
      if (!value) continue;
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
  const link = document.createElement('a');
  link.href = info?.source?.[1] || OPEN_ANATOMY_PAGE;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = info?.source?.[0] || 'Open Anatomy SPL Head & Neck Atlas';
  infoSource.append('Reference: ', link);
}

function clearSelection(resetInfo = true) {
  clearHighlight();
  selected = null;
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = true;
  if (resetInfo) renderInfo(null, null);
  renderStructureList(searchInput.value);
}

function selectMesh(mesh, focus = false) {
  if (!mesh?.visible) return;
  clearHighlight();
  selected = mesh;
  applyHighlight(mesh);
  const info = matchAnatomyInfo(mesh.userData.displayName, mesh.userData.kind);
  renderInfo(info, mesh);
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = false;
  renderStructureList(searchInput.value);
  if (focus) focusOn(mesh);
}

function findMeshForInfo(info) {
  if (!info) return null;
  const aliases = info.aliases.map((alias) => alias.toLowerCase());
  return interactiveMeshes.find((mesh) => {
    if (!mesh.userData.baseVisible || mesh.userData.kind !== info.kind) return false;
    const name = mesh.userData.displayName.toLowerCase();
    return aliases.some((alias) => name.includes(alias) || alias.includes(name));
  }) || null;
}

function selectGuide(info) {
  const mesh = findMeshForInfo(info);
  if (mesh) {
    if (mesh.userData.kind === 'artery') arteriesToggle.checked = true;
    if (mesh.userData.kind === 'vein') veinsToggle.checked = true;
    updateVisibility();
    selectMesh(mesh, true);
  } else {
    clearSelection(false);
    renderInfo(info, null);
  }
}

function renderFeaturedVessels(activeId = null) {
  featuredVessels.innerHTML = '';
  for (const id of FEATURED_VESSEL_IDS) {
    const info = infoById(id);
    if (!info || !['artery', 'vein'].includes(info.kind)) continue;
    const mesh = findMeshForInfo(info);
    if (!mesh) continue;
    const button = document.createElement('button');
    button.className = `vessel-chip ${info.kind}${activeId === info.id ? ' active' : ''}`;
    button.textContent = info.title;
    button.addEventListener('click', () => selectGuide(info));
    featuredVessels.appendChild(button);
  }
}

function renderStructureList(query = '') {
  const q = query.trim().toLowerCase();
  const kindOrder = { artery: 0, vein: 1, bone: 2 };
  const items = interactiveMeshes
    .filter((mesh) => mesh.userData.baseVisible)
    .filter((mesh) => !q || mesh.userData.displayName.toLowerCase().includes(q))
    .sort((a, b) => (kindOrder[a.userData.kind] - kindOrder[b.userData.kind]) || a.userData.displayName.localeCompare(b.userData.displayName));

  countEl.textContent = interactiveMeshes.filter((mesh) => mesh.userData.baseVisible).length;
  listEl.innerHTML = '';
  for (const mesh of items) {
    const button = document.createElement('button');
    button.className = `structure-item${mesh === selected ? ' active' : ''}${layerEnabled(mesh.userData.kind) ? '' : ' layer-off'}`;
    const dot = document.createElement('span');
    dot.className = `structure-dot ${mesh.userData.kind}`;
    const text = document.createElement('span');
    text.textContent = mesh.userData.displayName;
    button.append(dot, text);
    button.title = mesh.userData.displayName;
    button.addEventListener('click', () => {
      if (!layerEnabled(mesh.userData.kind)) {
        if (mesh.userData.kind === 'bone') bonesToggle.checked = true;
        if (mesh.userData.kind === 'artery') arteriesToggle.checked = true;
        if (mesh.userData.kind === 'vein') veinsToggle.checked = true;
        updateVisibility();
      }
      selectMesh(mesh, true);
    });
    listEl.appendChild(button);
  }
}

function showAll() {
  for (const mesh of interactiveMeshes) mesh.userData.hiddenByUser = false;
  updateVisibility();
}

function isolateSelected() {
  if (!selected) return;
  for (const mesh of interactiveMeshes) mesh.visible = mesh === selected;
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
  const hits = raycaster.intersectObjects(interactiveMeshes.filter((mesh) => mesh.visible), false);
  if (hits[0]?.object) selectMesh(hits[0].object);
}

function resize() {
  const width = Math.max(viewer.clientWidth, 1);
  const height = Math.max(viewer.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function setPreset(name) {
  const directions = {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(1, 0, 0),
    right: new THREE.Vector3(-1, 0, 0),
  };
  fitCamera(atlasBounds, directions[name] || directions.front);
}

async function loadManifest() {
  try {
    const response = await fetch(`${MANIFEST_URL}?v=oa2`, { cache: 'no-store' });
    if (response.ok) manifest = await response.json();
  } catch (error) {
    console.warn('Manifest unavailable', error);
  }
}

async function loadAsset(kind) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${ASSETS[kind]}?v=oa2`);
  prepareGroup(gltf.scene, kind);
  return gltf.scene;
}

async function boot() {
  renderInfo(null, null);
  await loadManifest();

  try {
    loadingText.textContent = 'Loading registered skull…';
    await loadAsset('bone');
    atlasBounds = computeBounds(interactiveMeshes.filter((mesh) => mesh.userData.kind === 'bone'));
    updateVisibility();
    fitCamera(atlasBounds);

    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 350);

    vesselStatus.textContent = 'Loading registered arteries and veins…';
    const results = await Promise.allSettled([loadAsset('artery'), loadAsset('vein')]);
    const failed = results.filter((r) => r.status === 'rejected').length;

    atlasBounds = computeBounds();
    updateVisibility();
    renderFeaturedVessels();

    const arteryCount = interactiveMeshes.filter((mesh) => mesh.userData.baseVisible && mesh.userData.kind === 'artery').length;
    const veinCount = interactiveMeshes.filter((mesh) => mesh.userData.baseVisible && mesh.userData.kind === 'vein').length;
    const version = manifest?.version ? ` · ${manifest.version}` : '';
    vesselStatus.textContent = failed
      ? `Atlas loaded with ${failed} missing vascular layer${failed > 1 ? 's' : ''}.`
      : `${arteryCount} artery structures · ${veinCount} vein structures${version}`;
    vesselStatus.dataset.state = failed ? 'error' : 'ready';
  } catch (error) {
    console.error(error);
    loadingText.textContent = 'Open Anatomy assets could not load. Please reload after the Pages deployment finishes.';
    vesselStatus.textContent = 'Atlas assets unavailable.';
    vesselStatus.dataset.state = 'error';
  }
}

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
showAllBtn.addEventListener('click', () => { showAll(); fitCamera(atlasBounds); });
document.querySelector('#resetBtn').addEventListener('click', () => { showAll(); fitCamera(atlasBounds); });

document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => setPreset(btn.dataset.view)));
bonesToggle.addEventListener('change', updateVisibility);
arteriesToggle.addEventListener('change', updateVisibility);
veinsToggle.addEventListener('change', updateVisibility);
boneOpacityInput.addEventListener('input', () => {
  boneOpacityValue.textContent = `${Math.round(Number(boneOpacityInput.value) * 100)}%`;
  interactiveMeshes.filter((mesh) => mesh.userData.kind === 'bone').forEach(updateMaterialOpacity);
});

const aboutDialog = document.querySelector('#aboutDialog');
document.querySelector('#aboutBtn').addEventListener('click', () => aboutDialog.showModal());
document.querySelector('#closeAbout').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => { if (event.target === aboutDialog) aboutDialog.close(); });

new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

boot();
