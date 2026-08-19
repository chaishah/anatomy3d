import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FEATURED_VESSEL_IDS, infoById, matchAnatomyInfo } from './anatomy-data.js';

const ASSET_BASE = './assets/bodyparts3d/';
const MANIFEST_URL = `${ASSET_BASE}manifest.json`;
const BODY_PARTS_PAGE = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/';

const LAYERS = {
  bone:   { file: 'head-bones.glb', label: 'Bones & teeth', color: 0xe2dccb, defaultOn: true, opacity: () => Number(document.querySelector('#boneOpacityInput').value) },
  artery: { file: 'head-arteries.glb', label: 'Arteries', color: 0xe34d4d, defaultOn: true, opacity: () => 1 },
  vein:   { file: 'head-veins.glb', label: 'Veins & sinuses', color: 0x4e7fdb, defaultOn: true, opacity: () => 1 },
  nerve:  { file: 'head-nerves.glb', label: 'Nerves', color: 0xf0bf3f, defaultOn: false, opacity: () => 1 },
  muscle: { file: 'head-muscles.glb', label: 'Muscles', color: 0xa94c52, defaultOn: false, opacity: () => 0.76 },
  organ:  { file: 'head-organs.glb', label: 'Brain & organs', color: 0xb37691, defaultOn: false, opacity: () => 0.78 },
};
const KIND_ORDER = { artery: 0, vein: 1, nerve: 2, bone: 3, muscle: 4, organ: 5 };
const SELECTED = new THREE.Color(0xf2b84b);

const $ = (selector) => document.querySelector(selector);
const viewer = $('#viewer');
const overlay = $('#loadingOverlay');
const loadingText = $('#loadingText');
const listEl = $('#structureList');
const countEl = $('#structureCount');
const searchInput = $('#searchInput');
const selectedName = $('#selectedName');
const selectedMeta = $('#selectedMeta');
const selectedKind = $('#selectedKind');
const selectedOverview = $('#selectedOverview');
const infoDetails = $('#infoDetails');
const infoSource = $('#infoSource');
const focusBtn = $('#focusBtn');
const isolateBtn = $('#isolateBtn');
const hideBtn = $('#hideBtn');
const showAllBtn = $('#showAllBtn');
const boneOpacityInput = $('#boneOpacityInput');
const boneOpacityValue = $('#boneOpacityValue');
const atlasStatus = $('#vesselStatus');
const featuredVessels = $('#featuredVessels');
const layerToggles = Object.fromEntries(Object.keys(LAYERS).map((kind) => [kind, $(`#${kind}Toggle`)]));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 6000);
camera.position.set(0, 0, 420);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.25 : 1.65));
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;
controls.rotateSpeed = 0.68;
controls.zoomSpeed = 0.82;
controls.panSpeed = 0.72;

scene.add(new THREE.HemisphereLight(0xe9f1f8, 0x111821, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.0);
key.position.set(3, 5, 6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd4ff, 1.35);
fill.position.set(-5, 1.5, 3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x8eb8ff, 1.15);
rim.position.set(1, 2, -5);
scene.add(rim);

const atlasRoot = new THREE.Group();
scene.add(atlasRoot);
const groups = Object.fromEntries(Object.keys(LAYERS).map((kind) => [kind, new THREE.Group()]));
Object.values(groups).forEach((group) => atlasRoot.add(group));
const layerState = Object.fromEntries(Object.keys(LAYERS).map((kind) => [kind, { loaded: false, loading: null, error: null, meshes: [] }]));

let catalog = [];
let catalogByFj = new Map();
let interactiveMeshes = [];
let selected = null;
let headBounds = new THREE.Box3();
let pointerDown = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new GLTFLoader();

function normalize(value = '') {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function prettyName(value = '') {
  return value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b(left|right)\b/i, (s) => s[0].toUpperCase() + s.slice(1).toLowerCase());
}
function parseIds(name = '') {
  return { fj: name.match(/\bFJ\d+\b/i)?.[0]?.toUpperCase() || null, fma: name.match(/\bFMA\d+\b/i)?.[0]?.toUpperCase() || null };
}
function kindLabel(kind) { return LAYERS[kind]?.label || 'Structure'; }

function buildCatalog(data) {
  catalog = [];
  catalogByFj = new Map();
  for (const [kind, asset] of Object.entries(data.assets || {})) {
    if (!LAYERS[kind]) continue;
    for (const item of asset.structures || []) {
      const entry = {
        kind,
        name: prettyName(item.name),
        fj: item.fj_id || null,
        fma: item.fma_id || null,
        bp: item.bp_id || null,
        faces: item.faces || null,
        sourceFaces: item.sourceFaces || null,
        mesh: null,
      };
      catalog.push(entry);
      if (entry.fj) catalogByFj.set(entry.fj, entry);
    }
  }
  catalog.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.name.localeCompare(b.name));
}

function materialFor(kind) {
  const opacity = LAYERS[kind].opacity();
  return new THREE.MeshStandardMaterial({
    color: LAYERS[kind].color,
    roughness: kind === 'bone' ? 0.78 : kind === 'muscle' ? 0.67 : 0.5,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity > 0.68 || ['artery', 'vein', 'nerve'].includes(kind),
  });
}

function prepareMesh(mesh, kind) {
  const ids = parseIds(mesh.name);
  const entry = ids.fj ? catalogByFj.get(ids.fj) : null;
  const rawName = entry?.name || mesh.name.split('·')[0] || mesh.name;
  mesh.userData.kind = kind;
  mesh.userData.displayName = prettyName(rawName);
  mesh.userData.fj = entry?.fj || ids.fj;
  mesh.userData.fma = entry?.fma || ids.fma;
  mesh.userData.bp = entry?.bp || null;
  mesh.userData.faces = entry?.faces || Math.round((mesh.geometry?.index?.count || mesh.geometry?.attributes?.position?.count || 0) / 3) || null;
  mesh.userData.hiddenByUser = false;
  mesh.material = materialFor(kind);
  mesh.userData.baseColor = mesh.material.color.clone();
  mesh.renderOrder = { organ: 0, muscle: 1, bone: 2, vein: 4, artery: 5, nerve: 6 }[kind] || 2;
  mesh.frustumCulled = true;
  if (!mesh.geometry?.attributes?.normal) mesh.geometry?.computeVertexNormals?.();
  interactiveMeshes.push(mesh);
  layerState[kind].meshes.push(mesh);
  if (entry) entry.mesh = mesh;
}

function layerVisible(kind) { return Boolean(layerToggles[kind]?.checked); }
function updateMeshOpacity(mesh) {
  const opacity = LAYERS[mesh.userData.kind].opacity();
  mesh.material.opacity = opacity;
  mesh.material.transparent = opacity < 1;
  mesh.material.depthWrite = opacity > 0.68 || ['artery', 'vein', 'nerve'].includes(mesh.userData.kind);
  mesh.material.needsUpdate = true;
}
function updateVisibility() {
  for (const mesh of interactiveMeshes) {
    mesh.visible = layerVisible(mesh.userData.kind) && !mesh.userData.hiddenByUser;
    updateMeshOpacity(mesh);
  }
  if (selected && !selected.visible) clearSelection(false);
  renderStructureList(searchInput.value);
  syncMobileButtons();
}

function setLayerStateUI(kind, state) {
  const row = document.querySelector(`[data-layer-row="${kind}"]`);
  if (row) row.dataset.state = state;
}
function loadGLB(url, onProgress) { return new Promise((resolve, reject) => loader.load(url, resolve, onProgress, reject)); }

async function loadLayer(kind) {
  const state = layerState[kind];
  if (state.loaded) return state;
  if (state.loading) return state.loading;
  setLayerStateUI(kind, 'loading');
  state.error = null;
  state.loading = loadGLB(`${ASSET_BASE}${LAYERS[kind].file}`, (event) => {
    if (event.total) setLayerStateUI(kind, `loading-${Math.round(event.loaded / event.total * 100)}`);
  }).then((gltf) => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry?.attributes?.position) prepareMesh(obj, kind);
    });
    groups[kind].add(gltf.scene);
    state.loaded = true;
    state.loading = null;
    setLayerStateUI(kind, 'ready');
    updateVisibility();
    renderFeaturedVessels();
    return state;
  }).catch((error) => {
    console.error(`Could not load ${kind}`, error);
    state.error = error;
    state.loading = null;
    setLayerStateUI(kind, 'error');
    throw error;
  });
  return state.loading;
}

function computeBounds(meshes = interactiveMeshes, visibleOnly = false) {
  const box = new THREE.Box3();
  let has = false;
  for (const mesh of meshes) {
    if (visibleOnly && !mesh.visible) continue;
    const b = new THREE.Box3().setFromObject(mesh);
    if (!b.isEmpty()) { box.union(b); has = true; }
  }
  return has ? box : new THREE.Box3();
}
function fitCamera(box = headBounds, direction = new THREE.Vector3(0, 0, 1), padding = 1.2) {
  if (!box || box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const distance = Math.max(radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), 1) * padding;
  camera.position.copy(center.clone().add(direction.clone().normalize().multiplyScalar(distance)));
  camera.near = Math.max(distance / 1600, 0.05);
  camera.far = distance * 35;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = Math.max(radius * 0.11, 1);
  controls.maxDistance = distance * 4.2;
  controls.update();
}
function focusOn(mesh) {
  const direction = camera.position.clone().sub(controls.target).normalize();
  fitCamera(new THREE.Box3().setFromObject(mesh), direction, 1.7);
}

function clearHighlight() {
  if (!selected?.material?.color) return;
  selected.material.color.copy(selected.userData.baseColor);
  selected.material.emissive?.set?.(0x000000);
}
function highlight(mesh) {
  if (mesh.material.emissive) {
    mesh.material.emissive.copy(SELECTED).multiplyScalar(0.38);
    mesh.material.emissiveIntensity = 1.2;
  } else {
    mesh.material.color.lerp(SELECTED, 0.52);
  }
}

function appendDetail(label, value) {
  if (!value) return;
  const section = document.createElement('section');
  section.className = 'detail-block';
  const heading = document.createElement('h3');
  heading.textContent = label;
  const paragraph = document.createElement('p');
  paragraph.textContent = value;
  section.append(heading, paragraph);
  infoDetails.appendChild(section);
}

function renderInfo(info = null, mesh = null, entry = null) {
  const kind = info?.kind || mesh?.userData?.kind || entry?.kind || 'bone';
  const name = info?.title || mesh?.userData?.displayName || entry?.name || 'Nothing selected';
  selectedKind.textContent = kindLabel(kind);
  selectedKind.dataset.kind = kind;
  selectedName.textContent = name;
  infoDetails.innerHTML = '';
  infoSource.replaceChildren();
  if (!mesh && !entry && !info) {
    selectedMeta.textContent = 'Select a detailed BodyParts3D structure.';
    selectedOverview.textContent = 'Search the atlas or tap a structure to see its anatomical and source information.';
    return;
  }
  const source = entry || (mesh ? catalogByFj.get(mesh.userData.fj) : null);
  const ids = [source?.fj || mesh?.userData?.fj, source?.fma || mesh?.userData?.fma].filter(Boolean).join(' · ');
  selectedMeta.textContent = `${kindLabel(kind)}${ids ? ` · ${ids}` : ''}`;
  selectedOverview.textContent = info?.overview || `${name} is represented by a detailed BodyParts3D v4.3 component mesh in the shared anatomical coordinate system.`;
  if (info) {
    appendDetail('Course / relationship', info.course);
    appendDetail(kind === 'vein' ? 'Drainage' : kind === 'artery' ? 'Supply' : 'Role', info.territory);
    appendDetail('Clinical relevance', info.clinical);
  }
  appendDetail('BodyParts3D identity', [source?.fj, source?.bp, source?.fma].filter(Boolean).join(' · '));
  if (source?.faces) appendDetail('3D mesh detail', `${Number(source.faces).toLocaleString()} faces in the web asset${source.sourceFaces && source.sourceFaces !== source.faces ? ` (${Number(source.sourceFaces).toLocaleString()} source faces)` : ''}.`);
  const link = document.createElement('a');
  link.href = info?.source?.[1] || BODY_PARTS_PAGE;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = info?.source?.[0] || 'BodyParts3D / Database Center for Life Science';
  infoSource.append('Reference: ', link);
}

function clearSelection(resetInfo = true) {
  clearHighlight();
  selected = null;
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = true;
  if (resetInfo) renderInfo();
  renderStructureList(searchInput.value);
}
function selectMesh(mesh, focus = false) {
  if (!mesh?.visible) return;
  clearHighlight();
  selected = mesh;
  highlight(mesh);
  const entry = mesh.userData.fj ? catalogByFj.get(mesh.userData.fj) : null;
  const info = matchAnatomyInfo(mesh.userData.displayName, mesh.userData.kind);
  renderInfo(info, mesh, entry);
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = false;
  renderStructureList(searchInput.value);
  if (focus) focusOn(mesh);
}

async function selectCatalogEntry(entry) {
  if (!layerVisible(entry.kind)) layerToggles[entry.kind].checked = true;
  if (!layerState[entry.kind].loaded) {
    atlasStatus.textContent = `Loading ${LAYERS[entry.kind].label.toLowerCase()}…`;
    atlasStatus.dataset.state = 'loading';
    try { await loadLayer(entry.kind); }
    catch { atlasStatus.textContent = `Could not load ${LAYERS[entry.kind].label.toLowerCase()}.`; atlasStatus.dataset.state = 'error'; return; }
  }
  updateVisibility();
  const mesh = entry.mesh || (entry.fj ? catalogByFj.get(entry.fj)?.mesh : null);
  if (mesh) selectMesh(mesh, true);
  else renderInfo(matchAnatomyInfo(entry.name, entry.kind), null, entry);
}

function renderStructureList(query = '') {
  const q = normalize(query);
  const items = catalog.filter((entry) => !q || normalize(`${entry.name} ${entry.fj || ''} ${entry.fma || ''}`).includes(q));
  countEl.textContent = catalog.length;
  listEl.innerHTML = '';
  for (const entry of items.slice(0, 500)) {
    const button = document.createElement('button');
    button.className = `structure-item${entry.mesh === selected ? ' active' : ''}${layerVisible(entry.kind) ? '' : ' layer-off'}`;
    const dot = document.createElement('span');
    dot.className = `structure-dot ${entry.kind}`;
    const label = document.createElement('span');
    label.textContent = entry.name;
    const meta = document.createElement('small');
    meta.textContent = entry.fma || entry.fj || '';
    button.append(dot, label, meta);
    button.title = `${entry.name}${entry.fma ? ` · ${entry.fma}` : ''}`;
    button.addEventListener('click', () => selectCatalogEntry(entry));
    listEl.appendChild(button);
  }
  if (items.length > 500) {
    const note = document.createElement('p');
    note.className = 'list-note';
    note.textContent = `Showing first 500 of ${items.length}. Refine the search to narrow the atlas.`;
    listEl.appendChild(note);
  }
}

function findCatalogForInfo(info) {
  if (!info) return null;
  const aliases = info.aliases.map(normalize);
  return catalog.find((entry) => entry.kind === info.kind && aliases.some((alias) => normalize(entry.name).includes(alias) || alias.includes(normalize(entry.name)))) || null;
}
function renderFeaturedVessels() {
  featuredVessels.innerHTML = '';
  for (const id of FEATURED_VESSEL_IDS) {
    const info = infoById(id);
    if (!info || !['artery', 'vein'].includes(info.kind)) continue;
    const entry = findCatalogForInfo(info);
    if (!entry) continue;
    const button = document.createElement('button');
    button.className = `vessel-chip ${info.kind}`;
    button.textContent = info.title;
    button.addEventListener('click', () => selectCatalogEntry(entry));
    featuredVessels.appendChild(button);
  }
}

function updateLayerSummary() {
  const loaded = Object.entries(layerState).filter(([, state]) => state.loaded).map(([kind]) => LAYERS[kind].label);
  atlasStatus.textContent = `${catalog.length.toLocaleString()} detailed structures indexed · loaded: ${loaded.join(', ') || 'none'}`;
  atlasStatus.dataset.state = 'ready';
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
  renderInfo();
}

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactiveMeshes.filter((mesh) => mesh.visible), false);
  if (hits[0]?.object) selectMesh(hits[0].object);
  else clearSelection();
}
function setPreset(name) {
  const dirs = { front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1), left: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(-1, 0, 0) };
  fitCamera(headBounds, dirs[name] || dirs.front);
}
function resize() {
  const { clientWidth, clientHeight } = viewer;
  camera.aspect = Math.max(clientWidth, 1) / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, clientWidth < 900 ? 1.25 : 1.65));
  renderer.setSize(clientWidth, clientHeight, false);
}
function syncMobileButtons() {
  for (const button of document.querySelectorAll('[data-mobile-layer]')) {
    const on = layerVisible(button.dataset.mobileLayer);
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  }
}
async function onLayerToggle(kind) {
  if (layerVisible(kind) && !layerState[kind].loaded) {
    atlasStatus.textContent = `Loading ${LAYERS[kind].label.toLowerCase()}…`;
    atlasStatus.dataset.state = 'loading';
    try { await loadLayer(kind); }
    catch { atlasStatus.textContent = `Could not load ${LAYERS[kind].label.toLowerCase()}.`; atlasStatus.dataset.state = 'error'; return; }
  }
  updateVisibility();
  updateLayerSummary();
}

async function boot() {
  try {
    loadingText.textContent = 'Reading BodyParts3D structure manifest…';
    const response = await fetch(`${MANIFEST_URL}?v=bp43`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const manifest = await response.json();
    buildCatalog(manifest);
    renderStructureList();
    renderFeaturedVessels();

    loadingText.textContent = 'Loading detailed skull, teeth and mandible…';
    await loadLayer('bone');
    headBounds = computeBounds(layerState.bone.meshes);
    fitCamera(headBounds);
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 420);

    atlasStatus.textContent = 'Loading detailed arteries and veins…';
    atlasStatus.dataset.state = 'loading';
    await Promise.allSettled([loadLayer('artery'), loadLayer('vein')]);
    updateLayerSummary();
  } catch (error) {
    console.error(error);
    loadingText.textContent = 'BodyParts3D assets could not be loaded. Reload the page after the asset build completes.';
    atlasStatus.textContent = 'BodyParts3D asset load failed.';
    atlasStatus.dataset.state = 'error';
  }
}

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
$('#resetBtn').addEventListener('click', () => { showAll(); fitCamera(headBounds); });
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.view)));

for (const [kind, toggle] of Object.entries(layerToggles)) {
  toggle.checked = LAYERS[kind].defaultOn;
  toggle.addEventListener('change', () => onLayerToggle(kind));
}
document.querySelectorAll('[data-mobile-layer]').forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.mobileLayer;
    const toggle = layerToggles[kind];
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
});
boneOpacityInput.addEventListener('input', () => {
  boneOpacityValue.textContent = `${Math.round(Number(boneOpacityInput.value) * 100)}%`;
  layerState.bone.meshes.forEach(updateMeshOpacity);
});

const aboutDialog = $('#aboutDialog');
$('#aboutBtn').addEventListener('click', () => aboutDialog.showModal());
$('#closeAbout').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => { if (event.target === aboutDialog) aboutDialog.close(); });

renderInfo();
syncMobileButtons();
new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
boot();
