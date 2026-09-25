import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowTexture } from './textures.js';

const glow = glowTexture();

// Sadə low-poly maşın. Maşın +X istiqamətinə baxır.
export function createCar(color = '#e63946', { player = false } = {}) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0d1422', metalness: 0.9, roughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 });

  const body = new THREE.Mesh(new RoundedBoxGeometry(4.1, 0.7, 1.9, 4, 0.32), paint);
  body.position.y = 0.72;
  car.add(body);
  // ön hissə bir az alçaq — idman maşını siluetinə yaxın
  const hood = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.3, 1.8, 3, 0.14), paint);
  hood.position.set(1.35, 1.05, 0);
  hood.rotation.z = -0.12;
  car.add(hood);

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.66, 1.62, 4, 0.3), glass);
  cabin.position.set(-0.35, 1.32, 0);
  car.add(cabin);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.1, 1.5, 2, 0.05), paint);
  roof.position.set(-0.45, 1.66, 0);
  car.add(roof);

  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.36, 20);
  wheelGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.38, 12);
  rimGeo.rotateX(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: 0.9, roughness: 0.25 });
  const wheels = [];
  for (const [x, z] of [
    [1.3, 0.86],
    [1.3, -0.86],
    [-1.25, 0.86],
    [-1.25, -0.86],
  ]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wheelGeo, dark), new THREE.Mesh(rimGeo, rimMat));
    w.position.set(x, 0.44, z);
    car.add(w);
    wheels.push(w);
  }

  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  for (const z of [0.62, -0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.5), headMat);
    h.position.set(2.04, 0.84, z);
    car.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.55), tailMat);
    t.position.set(-2.04, 0.86, z);
    car.add(t);
    for (const [x, color, size] of [
      [2.2, '#fff3cf', 0.8],
      [-2.2, '#ff3030', 0.6],
    ]) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sp.scale.setScalar(size);
      sp.position.set(x, 0.85, z);
      car.add(sp);
    }
  }

  // yerdə yumşaq kölgə
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 3),
    new THREE.MeshBasicMaterial({ map: glow, color: '#000', transparent: true, opacity: 0.6, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.08;
  car.add(shadow);

  if (player) {
    // fara işığı yolda
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 7),
      new THREE.MeshBasicMaterial({
        map: glow,
        color: '#fff2c0',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(7.5, 0.09, 0);
    car.add(pool);

    const spot = new THREE.SpotLight('#fff1c9', 40, 40, 0.5, 0.6, 1.2);
    spot.position.set(1.9, 1, 0);
    spot.target.position.set(12, 0, 0);
    car.add(spot, spot.target);
  }

  car.userData = { wheels, parts: [body, hood, cabin, roof] };
  return car;
}

export function updateCar(car, speed, steer, dt) {
  const { wheels, parts } = car.userData;
  for (const w of wheels) w.rotation.z -= (speed / 0.42) * dt;
  // döngədə yüngül əyilmə
  const lean = -steer * Math.min(1, Math.abs(speed) / 15) * 0.08;
  for (const m of parts) m.rotation.x += (lean - m.rotation.x) * Math.min(1, dt * 6);
}

// ---------- oyunçunun real maşını (Ferrari 458, glTF) ----------
// Model: "Ferrari 458 Italia" — vicent091036, CC BY 4.0 (three.js nümunələrindən)
let carPromise = null;

function loadFerrari() {
  if (!carPromise) {
    carPromise = Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
    ]).then(([{ GLTFLoader }, { DRACOLoader }]) => {
      const draco = new DRACOLoader();
      draco.setDecoderPath('/draco/');
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      return loader.loadAsync('/models/ferrari.glb');
    });
  }
  return carPromise;
}

export async function createPlayerCar(renderer, color) {
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const car = new THREE.Group();
  let wheels = [];
  let front = [];
  try {
    const gltf = await loadFerrari();
    const model = gltf.scene.clone(true);
    const body = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.9,
      roughness: 0.45,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMap: env,
      envMapIntensity: 0.45,
    });
    const details = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.4, envMap: env });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#0b0f18',
      metalness: 0.2,
      roughness: 0,
      transparent: true,
      opacity: 0.55,
      envMap: env,
    });
    model.getObjectByName('body').material = body;
    for (const n of ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim']) {
      const o = model.getObjectByName(n);
      if (o) o.material = details;
    }
    model.getObjectByName('glass').material = glass;
    model.traverse((o) => {
      if (o.isMesh && o.material && !o.material.envMap) {
        o.material = o.material.clone();
        o.material.envMap = env;
      }
    });
    wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => model.getObjectByName(n)).filter(Boolean);
    front = wheels.slice(0, 2);
    for (const w of front) w.rotation.order = 'YXZ';

    // alt kölgə (modelin öz AO teksturu)
    const ao = new THREE.TextureLoader().load('/models/ferrari_ao.png');
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({
        map: ao,
        blending: THREE.MultiplyBlending,
        toneMapped: false,
        transparent: true,
        premultipliedAlpha: true,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    model.add(shadow);

    // modelin önü -z tərəfdədir, oyunda isə maşının önü +x-dir
    model.rotation.y = -Math.PI / 2;
    car.add(model);
  } catch (e) {
    console.warn('Maşın modeli yüklənmədi, sadə model istifadə olunur', e);
    const simple = createCar(color);
    car.add(simple);
  }

  // faralar: yolda işıq ləkəsi, parıltı və spot işıq
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 11),
    new THREE.MeshBasicMaterial({
      map: glow,
      color: '#fff2c0',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(12, 0.2, 0);
  car.add(pool);
  for (const z of [0.62, -0.62]) {
    for (const [x, c, s] of [
      [2.3, '#fff3cf', 0.9],
      [-2.3, '#ff3030', 0.55],
    ]) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: c,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sp.scale.setScalar(s);
      sp.position.set(x, 0.72, z);
      car.add(sp);
    }
  }
  const spot = new THREE.SpotLight('#fff1c9', 60, 60, 0.5, 0.6, 1.2);
  spot.position.set(2, 1, 0);
  spot.target.position.set(15, 0, 0);
  car.add(spot, spot.target);

  return {
    group: car,
    update(speed, steer, dt) {
      for (const w of wheels) w.rotation.x += (speed / 0.34) * dt;
      for (const w of front) w.rotation.y = steer * 0.45;
    },
  };
}
