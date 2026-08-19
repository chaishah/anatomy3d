import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const MODEL_URL = 'https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX/SkeletalSystem100.fbx';
const HEAD_TERMS = [
  'skull','cranium','cranial','mandible','maxilla','frontal','parietal','temporal','occipital','sphenoid','ethmoid',
  'zygomatic','nasal','lacrimal','palatine','vomer','concha','hyoid','tooth','teeth','incisor','canine','premolar','molar',
  'orbit','jaw','calvaria','facial bone','ossicle','malleus','incus','stapes'
];

const viewer = document.querySelector('#viewer');
const overlay = document.querySelector('#loadingOverlay');
const loadingText = document.querySelector('#loadingText');
const listEl = document.querySelector('#structureList');
const countEl = document.querySelector('#structureCount');
const searchInput = document.querySelector('#searchInput');
const selectedName = document.querySelector('#selectedName');
const selectedMeta = document.querySelector('#selectedMeta');
const focusBtn = document.querySelector('#focusBtn');
const isolateBtn = document.querySelector('#isolateBtn');
const hideBtn = document.querySelector('#hideBtn');
const showAllBtn = document.querySelector('#showAllBtn');
const opacityInput = document.querySelector('#opacityInput');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1017);
scene.fog = new THREE.Fog(0x0b1017, 120, 500);

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;
controls.minDistance = 0.02;
controls.maxDistance = 1000;

scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x141b21, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(5, 8, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9ac4ff, 1.9);
rimLight.position.set(-7, 3, -6);
scene.add(rimLight);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

let headMeshes = [];
let selected = null;
let currentOpacity = 1;
let headBounds = new THREE.Box3();
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

function cloneMaterial(material) {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = currentOpacity;
  clone.depthWrite = currentOpacity > 0.45;
  return clone;
}

function prepareMesh(mesh) {
  mesh.userData.displayName = cleanName(mesh.name);
  mesh.userData.baseVisible = true;
  mesh.userData.hiddenByUser = false;
  mesh.material = Array.isArray(mesh.material)
    ? mesh.material.map(cloneMaterial)
    : cloneMaterial(mesh.material);

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.userData.originalMaterials = mats.map((m) => ({
    color: m.color?.clone?.(),
    emissive: m.emissive?.clone?.(),
    emissiveIntensity: m.emissiveIntensity ?? 1
  }));
}

function isLikelyHeadByName(mesh) {
  const n = `${mesh.name} ${mesh.parent?.name || ''}`.toLowerCase();
  return HEAD_TERMS.some((term) => n.includes(term));
}

function spatialHeadFallback(meshes, totalBox) {
  const size = totalBox.getSize(new THREE.Vector3());
  const spans = [size.x, size.y, size.z];
  const axis = spans.indexOf(Math.max(...spans));
  const axisName = ['x','y','z'][axis];
  const min = totalBox.min[axisName];
  const max = totalBox.max[axisName];
  const span = max - min;
  const endBand = span * 0.24;

  const low = [];
  const high = [];
  for (const mesh of meshes) {
    const b = new THREE.Box3().setFromObject(mesh);
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
    if (obj.isMesh) {
      prepareMesh(obj);
      meshes.push(obj);
    }
  });

  const named = meshes.filter(isLikelyHeadByName);
  const totalBox = new THREE.Box3().setFromObject(root);
  const keep = named.length >= 6 ? named : spatialHeadFallback(meshes, totalBox);
  const keepSet = new Set(keep);

  for (const mesh of meshes) {
    mesh.visible = keepSet.has(mesh);
    mesh.userData.baseVisible = keepSet.has(mesh);
  }

  headMeshes = keep.filter((m) => m.geometry?.attributes?.position);
  headBounds = computeVisibleBounds();
}

function computeVisibleBounds() {
  const box = new THREE.Box3();
  let hasAny = false;
  for (const mesh of headMeshes) {
    if (!mesh.visible) continue;
    const b = new THREE.Box3().setFromObject(mesh);
    if (!b.isEmpty()) {
      box.union(b);
      hasAny = true;
    }
  }
  if (!hasAny) return new THREE.Box3().setFromObject(modelRoot);
  return box;
}

function fitCamera(box = computeVisibleBounds(), direction = new THREE.Vector3(0, 0, 1)) {
  if (!box || box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.58;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(radius / Math.tan(fov / 2), 0.5) * 1.25;

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
  const box = new THREE.Box3().setFromObject(mesh);
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
}

function applyHighlight(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mat) => {
    if (mat.emissive) {
      mat.emissive.set(0x8c5a00);
      mat.emissiveIntensity = 1.25;
    } else if (mat.color) {
      mat.color.lerp(new THREE.Color(0xf2b84b), 0.55);
    }
  });
}

function selectMesh(mesh, fromList = false) {
  if (!mesh) return;
  clearHighlight();
  selected = mesh;
  applyHighlight(mesh);
  selectedName.textContent = mesh.userData.displayName;
  selectedMeta.textContent = `Mesh: ${mesh.name || 'unnamed'} · Use Focus to center the camera.`;
  focusBtn.disabled = false;
  isolateBtn.disabled = false;
  hideBtn.disabled = false;
  renderStructureList(searchInput.value);
  if (fromList) focusOn(mesh);
}

function setMeshOpacity(mesh, opacity) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => {
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = opacity > 0.45;
    m.needsUpdate = true;
  });
}

function renderStructureList(query = '') {
  const q = query.trim().toLowerCase();
  const items = [...headMeshes]
    .filter((m) => !q || m.userData.displayName.toLowerCase().includes(q))
    .sort((a,b) => a.userData.displayName.localeCompare(b.userData.displayName));

  countEl.textContent = headMeshes.length;
  listEl.innerHTML = '';
  for (const mesh of items.slice(0, 250)) {
    const button = document.createElement('button');
    button.className = `structure-item${mesh === selected ? ' active' : ''}`;
    button.textContent = mesh.userData.displayName;
    button.title = mesh.userData.displayName;
    button.addEventListener('click', () => selectMesh(mesh, true));
    listEl.appendChild(button);
  }
}

function showAll() {
  for (const mesh of headMeshes) {
    mesh.userData.hiddenByUser = false;
    mesh.visible = mesh.userData.baseVisible;
    setMeshOpacity(mesh, currentOpacity);
  }
  headBounds = computeVisibleBounds();
}

function isolateSelected() {
  if (!selected) return;
  for (const mesh of headMeshes) mesh.visible = mesh === selected;
  focusOn(selected);
}

function hideSelected() {
  if (!selected) return;
  selected.userData.hiddenByUser = true;
  selected.visible = false;
  clearHighlight();
  selected = null;
  selectedName.textContent = 'Nothing selected';
  selectedMeta.textContent = 'Tap a bone in the model or choose one from the list.';
  focusBtn.disabled = isolateBtn.disabled = hideBtn.disabled = true;
  renderStructureList(searchInput.value);
}

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(headMeshes.filter((m) => m.visible), false);
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
  fitCamera(computeVisibleBounds(), directions[name] || new THREE.Vector3(0,0,1));
}

function onLoaded(fbx) {
  modelRoot.add(fbx);
  buildHeadSubset(fbx);
  renderStructureList();
  showAll();
  fitCamera(headBounds);

  loadingText.textContent = `${headMeshes.length} head structures ready`;
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 450);
}

const loader = new FBXLoader();
loader.load(
  MODEL_URL,
  onLoaded,
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
    loadingText.textContent = 'Could not load the upstream FBX. Check the connection and reload.';
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
showAllBtn.addEventListener('click', () => { showAll(); fitCamera(computeVisibleBounds()); });
document.querySelector('#resetBtn').addEventListener('click', () => { showAll(); fitCamera(headBounds); });

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => setPreset(btn.dataset.view));
});

opacityInput.addEventListener('input', () => {
  currentOpacity = Number(opacityInput.value);
  headMeshes.forEach((mesh) => setMeshOpacity(mesh, currentOpacity));
  if (selected) applyHighlight(selected);
});

const aboutDialog = document.querySelector('#aboutDialog');
document.querySelector('#aboutBtn').addEventListener('click', () => aboutDialog.showModal());
document.querySelector('#closeAbout').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});

new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
