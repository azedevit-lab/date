import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PLACES, DATA, loadMap, nearestOnRoad, route, project } from './map.js';
import { buildWorld } from './world3d.js';
import { createPlayerCar } from './car3d.js';
import { buildMinimap, drawMinimap } from './minimap.js';
import { createAudio } from './audio.js';
import TaskModal from './TaskModal.jsx';

// fizika metr və saniyə ilə
const DEFAULT_KMH = 160; // admin paneldən dəyişdirilir
const MAX_REVERSE = 9;
const ACCEL = 15;
const BRAKE = 32;
const DRAG = 3;
const SHOULDER = 2.5; // yolun kənarından bu qədər çıxmaq olar (səki)
const WHEELBASE = 2.65;
const STOP_RADIUS = 16;
const MINI = 130;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// tapşırıq zamanı kamera: [məsafə, kamera hündürlüyü, baxış hündürlüyü]
const TASK_CAMERA = {
  flame: [330, 90, 75],
  hac: [260, 70, 25],
  crystal: [200, 55, 15],
  eye: [110, 30, 28],
  tower: [70, 22, 12],
  gallery: [125, 34, 26],
  fountains: [45, 16, 3],
};

const formatDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m / 10) * 10)} m`);

function pointAlong(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (s <= seg && seg > 0)
      return { x: ax + ((bx - ax) * s) / seg, y: ay + ((by - ay) * s) / seg, a: Math.atan2(by - ay, bx - ax) };
    s -= seg;
  }
  const [x, y] = pts[pts.length - 1];
  return { x, y, a: 0 };
}

// əsas yollar boyunca ulduzlar
function makeStars(avoid) {
  const stars = [];
  const nodes = DATA.roads.nodes;
  for (const w of DATA.roads.ways) {
    if (w.c > 2) continue;
    const pts = w.p.map((i) => nodes[i]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    for (let s = 60; s < len - 30; s += 140) {
      const p = pointAlong(pts, s);
      if (avoid.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60)) continue;
      if (stars.some((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < 90)) continue;
      stars.push({ x: p.x, y: p.y, taken: false });
      if (stars.length >= 320) return stars;
    }
  }
  return stars;
}

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.25,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
  });
  g.center();
  g.scale(1.6, 1.6, 1.6);
  return g;
}

export default function DriveGame({ c, intro, message, avatarName, arrived, onStart, onArrive, children }) {
  const mountRef = useRef(null);
  const miniRef = useRef(null);
  const joyRef = useRef(null);
  const knobRef = useRef(null);
  const audioRef = useRef(null);
  const [phase, setPhase] = useState(arrived ? 'arrived' : 'intro');
  const [stopIdx, setStopIdx] = useState(0);
  const [hud, setHud] = useState({ dist: 0, stars: 0, moved: false });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [muted, setMuted] = useState(false);
  const [radio, setRadio] = useState(null);

  // dayanacaqlar + sonda son ünvan (yol nöqtələri xəritə yüklənəndən sonra bəlli olur)
  const stops = useMemo(() => {
    if (!ready) return [];
    const dest = PLACES[c.destination] || PLACES.hac;
    return [
      ...c.stops
        .filter((s) => PLACES[s.place])
        .map((s) => ({
          ...s,
          id: s.place,
          placeName: PLACES[s.place].name,
          placeEmoji: PLACES[s.place].emoji,
          pos: PLACES[s.place].stop,
        })),
      { final: true, id: c.destination, placeName: dest.name, placeEmoji: dest.emoji, pos: dest.stop },
    ];
  }, [ready, c.stops, c.destination]);

  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  const state = useRef({ phase, stopIdx, input: { joy: null, keys: new Set() } });
  state.current.phase = phase;
  state.current.stopIdx = stopIdx;
  state.current.stops = stops;
  if (import.meta.env.DEV) {
    // yalnız avtomatik testlər üçün
    window.__drive = state.current;
    window.__map = { project, nearestOnRoad, PLACES };
  }

  useEffect(() => {
    loadMap()
      .then(() => setReady(true))
      .catch((e) => {
        console.error(e);
        setLoadError(e.message);
      });
  }, []);

  // məkan mahnıları; brauzer səsi yalnız ilk toxunuşdan sonra açır
  useEffect(() => {
    // köhnə "fon musiqisi" ayarı varsa, onu radionun ilk mahnısı kimi götürürük
    const radioCfg = c.radio?.tracks?.length
      ? c.radio
      : c.bgMusic?.url
        ? { name: c.radio?.name || 'Radio', tracks: [c.bgMusic], volume: c.bgMusic.volume ?? 0.5 }
        : c.radio;
    const audio = createAudio({
      places: c.music || [],
      radio: radioCfg,
      carVolume: c.carVolume ?? 0.5,
      onRadioChange: setRadio,
    });
    audioRef.current = audio;
    setRadio(audio.hasRadio ? audio.radioInfo() : null);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.dispose();
      audioRef.current = null;
    };
  }, [c.music, c.bgMusic, c.radio, c.carVolume]);

  useEffect(() => audioRef.current?.setMuted(muted), [muted]);

  // oyun zamanı səhifə sürüşməsin
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => (document.body.style.overflow = prev);
  }, []);

  // klaviatura
  useEffect(() => {
    const keys = state.current.input.keys;
    const map = {
      ArrowUp: 'u',
      KeyW: 'u',
      ArrowDown: 'd',
      KeyS: 'd',
      ArrowLeft: 'l',
      KeyA: 'l',
      ArrowRight: 'r',
      KeyD: 'r',
    };
    const down = (e) => {
      if (!map[e.code] || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      keys.add(map[e.code]);
    };
    const up = (e) => map[e.code] && keys.delete(map[e.code]);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 3D səhnə və oyun dövrü
  useEffect(() => {
    if (!ready) return;
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = 'game-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 2500);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.86);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // admin paneldəki maksimum sürət (km/saat → m/s); sürətlənmə də ona uyğun artır
    const maxSpeed = clamp((Number(c.maxSpeed) || DEFAULT_KMH) / 3.6, 15, 90);
    const accel = ACCEL * Math.max(1, maxSpeed / 44);

    let disposed = false;
    let world = null;
    let car = null;
    const s = state.current;

    // maşının başlanğıc vəziyyəti
    const dest = PLACES[c.destination] || PLACES.hac;
    const start = PLACES[c.start] || PLACES.flame;
    const [sx, sy] = s.phase === 'arrived' ? dest.stop : start.stop;
    const near = nearestOnRoad([sx, sy]);
    s.car = {
      x: sx,
      y: sy,
      a: Math.atan2(near.seg[1][1] - near.seg[0][1], near.seg[1][0] - near.seg[0][0]),
      v: 0,
      steer: 0,
    };
    s.stars = makeStars([start.stop, dest.stop, ...stops.map((st) => st.pos)]);
    s.starsTaken = 0;
    s.route = { path: [], length: 0 };
    s.distance = 0;
    s.startedAt = null;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
      camera.aspect = w / h;
      camera.fov = w < h ? 70 : 58;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // ulduzlar (bir InstancedMesh)
    const starMesh = new THREE.InstancedMesh(
      starGeometry(),
      new THREE.MeshStandardMaterial({
        color: '#ffcc33',
        emissive: '#ffb300',
        emissiveIntensity: 1,
        metalness: 0.4,
        roughness: 0.3,
      }),
      s.stars.length,
    );
    scene.add(starMesh);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const hidden = new THREE.Vector3(0, 0, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const tmpPos = new THREE.Vector3();

    const miniLayer = buildMinimap();
    const mini = miniRef.current;
    const mctx = mini.getContext('2d');
    mini.width = MINI * 2;
    mini.height = MINI * 2;

    // şriftlər (yazılar üçün) və maşın modeli yüklənəndən sonra dünyanı qururuq
    const fontsReady = Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    Promise.all([fontsReady, createPlayerCar(renderer, c.carColor || '#e63946')]).then(([, playerCar]) => {
      if (disposed) return;
      world = buildWorld(scene);
      if (import.meta.env.DEV) window.__world = world;
      // bilbordlar: onun marşrutu üzərində (başlanğıc → dayanacaqlar → son ünvan)
      if (c.billboards?.length) {
        const pts = [start.stop, ...stops.map((st) => st.pos)];
        const path = [];
        for (let i = 1; i < pts.length; i++) path.push(...route(pts[i - 1], pts[i]).path);
        const placed = world.addBillboards(c.billboards, path);
        if (import.meta.env.DEV) window.__billboards = placed;
      }
      car = playerCar;
      scene.add(car.group);
      const [dx, dy] = dest.stop;
      const [px, py] = dest.pos;
      const d = Math.hypot(px - dx, py - dy) || 1;
      const avatarPos = [dx + ((px - dx) / d) * 14, dy + ((py - dy) / d) * 14];
      const setAvatar = (img) => world.setAvatar(img, c.avatarEmoji, avatarName, avatarPos);
      setAvatar(null);
      if (c.avatar) {
        const img = new Image();
        img.onload = () => !disposed && setAvatar(img);
        img.src = c.avatar;
      }
      if (c.herPhoto) {
        const img = new Image();
        img.onload = () => !disposed && world.setHerPhoto(img);
        img.src = c.herPhoto;
      }
      setHud((h) => ({ ...h, loaded: true }));
    });

    let raf;
    let last = performance.now();
    let routeTimer = 0;
    let hudTimer = 0;
    let highlighted = null;
    const t0 = last;
    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    const lookNow = new THREE.Vector3();
    let camInit = false;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const { car: cs, input } = s;
      const driving = s.phase === 'drive' && world;

      // --- idarəetmə ---
      let steer = 0;
      let throttle = 0;
      if (driving && input.joy) {
        // toxunmaq = qaz; yana sürüşdürmək = sükan; aşağı çəkmək = əyləc / geri
        const jx = input.joy.x - input.joy.ox;
        const jy = input.joy.y - input.joy.oy;
        steer = clamp(jx / 70, -1, 1);
        throttle = jy > 30 ? -clamp((jy - 30) / 50, 0, 1) : 0.75 + clamp(-jy / 60, 0, 1) * 0.25;
      } else if (driving && input.keys.size) {
        steer = (input.keys.has('r') ? 1 : 0) - (input.keys.has('l') ? 1 : 0);
        throttle = (input.keys.has('u') ? 1 : 0) - (input.keys.has('d') ? 1 : 0);
      }
      cs.steer += (steer - cs.steer) * Math.min(1, dt * 8);

      if (throttle > 0) {
        cs.v = Math.min(maxSpeed * throttle, cs.v + accel * throttle * dt * (cs.v < 0 ? 3 : 1));
        if (!s.startedAt) s.startedAt = now;
      } else if (throttle < 0) {
        cs.v = cs.v > 0 ? Math.max(0, cs.v - BRAKE * dt) : Math.max(-MAX_REVERSE, cs.v - accel * 0.6 * dt);
      } else {
        cs.v -= Math.sign(cs.v) * Math.min(Math.abs(cs.v), DRAG * dt);
      }

      // velosiped modeli: sürət artdıqca sükan bucağı azalır
      const maxSteer = 0.55 / (1 + Math.abs(cs.v) / 12);
      cs.a += (cs.v / WHEELBASE) * Math.tan(cs.steer * maxSteer) * dt;

      // zolaq köməkçisi: sükan buraxılanda maşın yola paralel düzəlsin
      if (Math.abs(steer) < 0.05 && Math.abs(cs.v) > 8) {
        const n = nearestOnRoad([cs.x, cs.y]);
        let roadA = Math.atan2(n.seg[1][1] - n.seg[0][1], n.seg[1][0] - n.seg[0][0]);
        let diff = Math.atan2(Math.sin(roadA - cs.a), Math.cos(roadA - cs.a));
        if (Math.abs(diff) > Math.PI / 2) {
          roadA += Math.PI;
          diff = Math.atan2(Math.sin(roadA - cs.a), Math.cos(roadA - cs.a));
        }
        // yalnız demək olar paralel olanda və yavaşca — sükana qarışmasın
        if (Math.abs(diff) < 0.22 && Math.abs(cs.v) > 8) cs.a += clamp(diff, -0.5 * dt, 0.5 * dt);
      }

      if (cs.v !== 0) {
        const nx = cs.x + Math.cos(cs.a) * cs.v * dt;
        const ny = cs.y + Math.sin(cs.a) * cs.v * dt;
        const n = nearestOnRoad([nx, ny]);
        const lim = n.seg.half + SHOULDER;
        let px = nx;
        let py = ny;
        if (n.d > lim) {
          // yoldan çıxmasın: kənarda saxla və maşını yol boyunca yönəlt ki, ilişməsin
          px = n.x + ((nx - n.x) / n.d) * lim;
          py = n.y + ((ny - n.y) / n.d) * lim;
          let roadA = Math.atan2(n.seg[1][1] - n.seg[0][1], n.seg[1][0] - n.seg[0][0]);
          const dirA = cs.v >= 0 ? cs.a : cs.a + Math.PI;
          let diff = Math.atan2(Math.sin(roadA - dirA), Math.cos(roadA - dirA));
          if (Math.abs(diff) > Math.PI / 2)
            diff = Math.atan2(Math.sin(roadA + Math.PI - dirA), Math.cos(roadA + Math.PI - dirA));
          cs.a += clamp(diff, -3 * dt, 3 * dt);
          cs.v *= 1 - 0.6 * dt;
        }
        s.distance += Math.hypot(px - cs.x, py - cs.y);
        cs.x = px;
        cs.y = py;
      }

      // --- ulduzlar ---
      s.stars.forEach((st, i) => {
        if (!st.taken && Math.abs(st.x - cs.x) < 6 && Math.abs(st.y - cs.y) < 6) {
          st.taken = true;
          s.starsTaken++;
          audioRef.current?.ding();
          navigator.vibrate?.(10);
        }
        if (st.taken) {
          m4.compose(tmpPos.set(st.x, -5, st.y), q, hidden);
        } else {
          q.setFromAxisAngle(up, t * 2 + i);
          m4.compose(tmpPos.set(st.x, 2 + Math.sin(t * 3 + i) * 0.4, st.y), q, one);
        }
        starMesh.setMatrixAt(i, m4);
      });
      starMesh.instanceMatrix.needsUpdate = true;

      // --- dayanacaq ---
      const stop = s.stops[s.stopIdx];
      if (driving && stop && Math.hypot(stop.pos[0] - cs.x, stop.pos[1] - cs.y) < STOP_RADIUS) {
        cs.v = 0;
        input.joy = null;
        if (joyRef.current) joyRef.current.style.display = 'none';
        if (stop.final) {
          s.phase = 'arrived';
          setPhase('arrived');
          world.startFireworks(dest.pos);
          onArriveRef.current({
            seconds: Math.round((now - (s.startedAt || now)) / 1000),
            stars: s.starsTaken,
            km: +(s.distance / 1000).toFixed(1),
          });
        } else {
          s.phase = 'task';
          setPhase('task');
        }
      }

      // --- GPS ---
      routeTimer -= dt;
      if (world && routeTimer <= 0) {
        routeTimer = 0.4;
        const show = stop && (s.phase === 'drive' || s.phase === 'tutorial');
        s.route = show ? route([cs.x, cs.y], stop.pos) : { path: [], length: 0 };
        world.setRoute(s.route.path);
        world.setTarget(stop && !stop.final && s.phase === 'drive' ? stop.pos : null);
        const hl = stop && s.phase !== 'arrived' && !stop.final ? stop.id : null;
        if (hl !== highlighted) {
          highlighted = hl;
          world.setHighlight(hl);
        }
      }
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.2;
        setHud((h) => {
          const next = {
            ...h,
            dist: Math.round(s.route.length),
            stars: s.starsTaken,
            moved: !!s.startedAt,
            kmh: Math.round(Math.abs(cs.v) * 3.6),
          };
          return h.dist === next.dist && h.stars === next.stars && h.moved === next.moved && h.kmh === next.kmh
            ? h
            : next;
        });
      }

      // --- maşın ---
      if (car) {
        car.group.position.set(cs.x, 0, cs.y);
        car.group.rotation.y = -cs.a;
        car.update(cs.v, cs.steer, dt);
      }

      // --- kamera ---
      const fx = Math.cos(cs.a);
      const fz = Math.sin(cs.a);
      if (s.phase === 'task' && stop && PLACES[stop.id]) {
        // tapşırıq zamanı kamera məkana dönür; pəncərə ekranın aşağısını tutduğu üçün məkan yuxarıda görünür
        const place = PLACES[stop.id];
        const [lx, ly] = place.pos;
        const dl = Math.hypot(stop.pos[0] - lx, stop.pos[1] - ly) || 1;
        const [dist, camH, lookH] = TASK_CAMERA[stop.id] || [80, 25, 8];
        camPos.set(lx + ((stop.pos[0] - lx) / dl) * dist, camH, ly + ((stop.pos[1] - ly) / dl) * dist);
        camLook.set(lx, lookH, ly);
      } else if (s.phase === 'intro') {
        // giriş: kamera maşının arxasında, yol boyunca yavaşca yırğalanır (binaların içinə girmir)
        const sway = Math.sin(t * 0.4) * 0.5;
        const ca = cs.a + Math.PI + sway;
        camPos.set(cs.x + Math.cos(ca) * 10, 3.6, cs.y + Math.sin(ca) * 10);
        camLook.set(cs.x + fx * 4, 1, cs.y + fz * 4);
      } else if (s.phase === 'arrived') {
        // çatanda: binaların üstündən göyə — atəşfəşanlığa baxış (çat pəncərəsi ekranın aşağısını tutur)
        const ang = t * 0.06;
        camPos.set(cs.x + Math.cos(ang) * 230, 55, cs.y + Math.sin(ang) * 230);
        camLook.set(cs.x, 70, cs.y);
      } else {
        const back = 8.5 + Math.abs(cs.v) * 0.12;
        camPos.set(cs.x - fx * back, 3.4 + Math.abs(cs.v) * 0.03, cs.y - fz * back);
        camLook.set(cs.x + fx * 8, 1.3, cs.y + fz * 8);
      }
      if (!camInit) {
        camera.position.copy(camPos);
        lookNow.copy(camLook);
        camInit = true;
      }
      const k = Math.min(1, dt * (s.phase === 'drive' ? 5 : 2));
      camera.position.lerp(camPos, k);
      lookNow.lerp(camLook, k);
      camera.lookAt(lookNow);

      if (world) world.update(t, dt, pointAlong, [cs.x, cs.y]);
      audioRef.current?.update(cs.x, cs.y, dt, {
        v: cs.v,
        throttle: Math.max(0, throttle),
        brake: Math.max(0, -throttle),
        active: s.phase === 'drive',
      });
      composer.render();

      // --- mini xəritə ---
      if (s.phase === 'drive' || s.phase === 'task')
        drawMinimap(mctx, miniLayer, MINI, cs, stop && s.phase !== 'arrived' ? stop.pos : null, s.route.path);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      composer.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      });
      renderer.domElement.remove();
    };
  }, [
    ready,
    stops,
    c.billboards,
    c.maxSpeed,
    c.carColor,
    c.avatar,
    c.herPhoto,
    c.avatarEmoji,
    c.start,
    c.destination,
    avatarName,
  ]);

  // --- joystick ---
  const joyDown = (e) => {
    if (state.current.phase !== 'drive') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    state.current.input.joy = { ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    const j = joyRef.current;
    j.style.display = 'block';
    j.style.left = `${e.clientX}px`;
    j.style.top = `${e.clientY}px`;
    knobRef.current.style.transform = 'translate(-50%, -50%)';
  };
  const joyMove = (e) => {
    const joy = state.current.input.joy;
    if (!joy) return;
    joy.x = e.clientX;
    joy.y = e.clientY;
    const dx = clamp(joy.x - joy.ox, -60, 60);
    const dy = clamp(joy.y - joy.oy, -60, 60);
    knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const joyUp = () => {
    state.current.input.joy = null;
    if (joyRef.current) joyRef.current.style.display = 'none';
  };

  const finishTask = () => {
    setStopIdx((i) => i + 1);
    setPhase('drive');
  };

  const stop = stops[stopIdx];
  const loaded = ready && hud.loaded;

  return (
    <div className="game">
      <div
        ref={mountRef}
        className="game-mount"
        onPointerDown={joyDown}
        onPointerMove={joyMove}
        onPointerUp={joyUp}
        onPointerCancel={joyUp}
      />
      <div ref={joyRef} className="joystick">
        <div ref={knobRef} className="joystick-knob" />
      </div>

      {!loaded && <div className="game-loading mono">{loadError || 'Bakı yüklənir...'}</div>}

      {audioRef.current?.hasAudio && phase !== 'intro' && (
        <button className="mute-btn" onClick={() => setMuted((m) => !m)} aria-label="Səs">
          {muted ? '🔇' : '🔊'}
        </button>
      )}

      {(phase === 'drive' || phase === 'task') && stop && (
        <div className="hud-top">
          <div className="hud-nav">
            <span className="hud-emoji">{stop.final ? '🏁' : stop.placeEmoji}</span>
            <div>
              <div className="hud-label">{stop.final ? c.finalLabel : c.nextLabel}</div>
              <div className="hud-place">{stop.final ? c.finalName || stop.placeName : stop.placeName}</div>
            </div>
            <span className="hud-dist mono">{formatDist(hud.dist)}</span>
          </div>
          <div className="hud-stars mono">⭐ {hud.stars}</div>
        </div>
      )}

      {(phase === 'drive' || phase === 'task') && (
        <div className="drive-panel">
          {radio && (
            <div className="radio">
              <div className="radio-info">
                <span className="radio-station">📻 {radio.station}</span>
                <span className="radio-title">{radio.title}</span>
              </div>
              <div className="radio-btns">
                {radio.count > 1 && (
                  <button onClick={() => audioRef.current?.prev()} aria-label="Əvvəlki">
                    ⏮
                  </button>
                )}
                <button onClick={() => audioRef.current?.toggle()} aria-label="Çal/dayandır">
                  {radio.playing ? '⏸' : '▶️'}
                </button>
                {radio.count > 1 && (
                  <button onClick={() => audioRef.current?.next()} aria-label="Növbəti">
                    ⏭
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="drive-row">
            <div className="speedo mono">{hud.kmh || 0} km/saat</div>
            <button className="horn-btn" onClick={() => audioRef.current?.horn()} aria-label="Siqnal">
              📯
            </button>
          </div>
        </div>
      )}

      <canvas
        ref={miniRef}
        className="minimap"
        style={{ width: MINI, height: MINI, display: phase === 'drive' || phase === 'task' ? 'block' : 'none' }}
      />

      {phase === 'drive' && !hud.moved && <div className="hud-hint slide-up">{c.driveHint}</div>}

      {phase === 'intro' && loaded && (
        <div className="overlay soft">
          <div className="card intro-card pop-in">
            {intro.badge && <div className="badge">{intro.badge}</div>}
            <h2>{intro.title}</h2>
            {intro.text && <p className="task-text">{intro.text}</p>}
            {message && <p className="personal-msg">“{message}”</p>}
            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={() => {
                onStart();
                setPhase('tutorial');
              }}
            >
              {intro.button}
            </button>
          </div>
        </div>
      )}

      {phase === 'tutorial' && (
        <div className="overlay soft">
          <div className="card pop-in center">
            <div className="big-emoji">🚗</div>
            <h2>{c.tutorialTitle}</h2>
            <p className="task-text">{c.tutorialText}</p>
            <button className="btn btn-primary btn-lg" onClick={() => setPhase('drive')}>
              {c.tutorialButton}
            </button>
          </div>
        </div>
      )}

      {phase === 'task' && stop && <TaskModal key={stopIdx} stop={stop} c={c} onDone={finishTask} />}

      {phase === 'arrived' && children}

      <div className="osm-credit">© OpenStreetMap</div>
    </div>
  );
}
