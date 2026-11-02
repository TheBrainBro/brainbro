// The Blob in the hero: the 3D mascot, blinking, turning toward the pointer.
// Light comes from a studio environment map plus a key light with soft
// shadows (the cap on the head) and two rim lights in the hero's lavender
// and pink, so it sits in the hero instead of on top of it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const hero = document.querySelector('.hero');
const canvas = hero.querySelector('.mascot');
const { reduceMotion, onScreen } = Stage;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral keeps the brand violets as they are; ACES pushes them to blue.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.85;

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(0, 1.45, 6.4);
camera.lookAt(0, 1.0, 0);

// Key light, up and to the left, the one that casts the shadows. A wide
// radius blurs their edges like a big softbox would.
const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
key.position.set(-1.6, 6, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 10;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
Object.assign(key.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 1, far: 14 });
scene.add(key);

// Rim lights from behind, pink and lavender.
const pink = new THREE.DirectionalLight(0xf39bbf, 2.4);
pink.position.set(3, 2.5, -3);
const lavender = new THREE.DirectionalLight(0xb9a2ee, 2.0);
lavender.position.set(-3.5, 1.5, -2.5);
scene.add(pink, lavender);

// No floor: only a small blurred spot right under the feet, where no light
// reaches, so the mascot stands on something instead of floating.
function contactShadow() {
  const size = 128;
  const spot = document.createElement('canvas');
  spot.width = spot.height = size;
  const ctx = spot.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(10, 4, 24, 0.55)');
  gradient.addColorStop(0.45, 'rgba(10, 4, 24, 0.2)');
  gradient.addColorStop(1, 'rgba(26, 8, 56, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.8),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(spot), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}
scene.add(contactShadow());

// glTF materials are plain PBR. A little sheen and clearcoat make the skin
// read as soft vinyl, and sheen alone makes the cap read as cloth.
function upgrade(material) {
  const finish = {
    Skin: { sheen: 0.6, sheenRoughness: 0.5, sheenColor: 0xffffff, clearcoat: 0.3, clearcoatRoughness: 0.35 },
    Feet: { sheen: 0.5, sheenRoughness: 0.5, sheenColor: 0xffffff, clearcoat: 0.2, clearcoatRoughness: 0.4 },
    Cap: { sheen: 1, sheenRoughness: 0.8, sheenColor: 0x9b7ef0 },
    CapDark: { sheen: 1, sheenRoughness: 0.8, sheenColor: 0x7c5ae0 },
    Eye: { clearcoat: 1, clearcoatRoughness: 0.05 },
  }[material.name];
  if (!finish) return material;
  const physical = new THREE.MeshPhysicalMaterial();
  // Copies the standard properties only; the physical ones come next.
  THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
  physical.type = 'MeshPhysicalMaterial';
  for (const [name, value] of Object.entries(finish)) {
    if (physical[name]?.isColor) physical[name].set(value);
    else physical[name] = value;
  }
  return physical;
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(resize).observe(canvas);

// The mascot turns toward the pointer: a few degrees, eased.
const turn = new THREE.Group();
scene.add(turn);
let target = { x: 0, y: 0 };
hero.addEventListener('pointermove', (event) => {
  const box = canvas.getBoundingClientRect();
  const x = (event.clientX - (box.left + box.width / 2)) / window.innerWidth;
  const y = (event.clientY - (box.top + box.height / 2)) / window.innerHeight;
  target = { x: THREE.MathUtils.clamp(y, -0.5, 0.5) * 0.25, y: THREE.MathUtils.clamp(x, -0.6, 0.6) * 0.6 };
});
hero.addEventListener('pointerleave', () => (target = { x: 0, y: 0 }));

const draco = new DRACOLoader().setDecoderPath(new URL('./vendor/three/addons/libs/draco/', import.meta.url).href);
const loader = new GLTFLoader().setDRACOLoader(draco);
const clock = new THREE.Clock();
let mixer = null;

function frame() {
  const delta = Math.min(clock.getDelta(), 0.1);
  mixer?.update(delta);
  turn.rotation.y += (target.y - turn.rotation.y) * 0.06;
  turn.rotation.x += (target.x - turn.rotation.x) * 0.06;
  renderer.render(scene, camera);
}

loader.load(
  'models/brainbro-mascot.glb',
  (gltf) => {
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.material = upgrade(node.material);
    });
    turn.add(gltf.scene);
    draco.dispose();

    mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = THREE.AnimationClip.findByName(gltf.animations, 'BlinkIdle');
    if (clip) mixer.clipAction(clip).play();

    canvas.classList.add('ready');
    if (reduceMotion) {
      mixer.update(0);
      frame();
      return;
    }
    clock.start();
    onScreen(
      hero,
      () => {
        clock.getDelta(); // No jump after being off screen.
        renderer.setAnimationLoop(frame);
      },
      () => renderer.setAnimationLoop(null),
      0,
    );
  },
  undefined,
  (error) => {
    console.error('BrainBro mascot: the model did not load.', error);
    canvas.remove();
  },
);
