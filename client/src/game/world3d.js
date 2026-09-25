import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DATA, W, H, PLACES, ROAD_WIDTHS, nearestOnRoad, pointInPoly } from './map.js';
import { glowTexture, beamTexture, labelTexture, avatarTexture } from './textures.js';

const LABEL_SIZE = 0.05; // ekran hündürlüyünə nisbətən
const CHUNK = 750; // binalar bu ölçüdə hissələrə bölünür ki, görünməyənlər çəkilməsin
const glow = glowTexture();

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// düz poliqon (x, y → x, 0, y)
function flatPolygon(points, y = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// polyline boyunca düz lent (yol, marşrut)
export function ribbon(pts, width, y, joints = true, jointSegs = 8) {
  const pos = [];
  const hw = width / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * hw;
    const nz = ((bx - ax) / len) * hw;
    pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, ax - nx, y, az - nz);
    pos.push(bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  }
  if (joints) {
    for (const [px, pz] of pts) {
      for (let k = 0; k < jointSegs; k++) {
        const a0 = (k / jointSegs) * Math.PI * 2;
        const a1 = ((k + 1) / jointSegs) * Math.PI * 2;
        pos.push(
          px,
          y,
          pz,
          px + Math.cos(a1) * hw,
          y,
          pz + Math.sin(a1) * hw,
          px + Math.cos(a0) * hw,
          y,
          pz + Math.sin(a0) * hw,
        );
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function fogShader(uniforms, fragment) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float time;
      void main() {
        ${fragment}
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

// ---------- fasad teksturaları: hər biri 4×4 pəncərə ----------
function facadeTexture(kind, seed) {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = { classic: '#8d7a5f', modern: '#1d2433', panel: '#6d6a72' }[kind];
  ctx.fillRect(0, 0, 256, 256);
  if (kind === 'classic') {
    // mərtəbə kornizləri
    ctx.fillStyle = 'rgba(255,240,210,0.14)';
    for (let j = 0; j < 4; j++) ctx.fillRect(0, j * 64 + 58, 256, 6);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const lit = r() < (kind === 'modern' ? 0.55 : 0.42);
      const warm = r() < 0.78;
      ctx.fillStyle = lit ? (warm ? `hsl(${36 + r() * 12}, 95%, ${62 + r() * 18}%)` : '#cfe0ff') : '#0f0d16';
      if (kind === 'classic') {
        // tağlı pəncərələr
        const x = i * 64 + 18;
        const y = j * 64 + 12;
        ctx.beginPath();
        ctx.moveTo(x, y + 40);
        ctx.lineTo(x, y + 12);
        ctx.arc(x + 14, y + 12, 14, Math.PI, 0);
        ctx.lineTo(x + 28, y + 40);
        ctx.closePath();
        ctx.fill();
      } else if (kind === 'modern') {
        ctx.fillRect(i * 64 + 3, j * 64 + 6, 58, 50);
      } else {
        ctx.fillRect(i * 64 + 16, j * 64 + 16, 32, 30);
      }
    }
  }
  if (kind === 'modern') {
    ctx.fillStyle = 'rgba(160,190,255,0.25)';
    for (let i = 0; i <= 4; i++) ctx.fillRect(i * 64 - 2, 0, 4, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// tile ölçüləri metrlə (4 pəncərə eninə, 4 mərtəbə hündürlüyünə)
const FACADES = {
  classic: { tileW: 16, tileH: 14.4, tint: [0.95, 1.1] },
  modern: { tileW: 14, tileH: 13, tint: [0.8, 1.05] },
  panel: { tileW: 13, tileH: 12, tint: [0.85, 1.05] },
};

class BuildingBuilder {
  constructor() {
    this.chunks = new Map();
    this.signs = [];
  }
  chunk(x, z) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    if (!this.chunks.has(key)) {
      const mk = () => ({ pos: [], nor: [], uv: [], col: [] });
      this.chunks.set(key, { classic: mk(), modern: mk(), panel: mk(), roof: mk() });
    }
    return this.chunks.get(key);
  }
  // pts: [[x,z]...], h: hündürlük (m)
  add(pts, h, kind, tint, uOff) {
    let cx = 0;
    let cz = 0;
    for (const [x, z] of pts) {
      cx += x;
      cz += z;
    }
    const ch = this.chunk(cx / pts.length, cz / pts.length);
    const buf = ch[kind];
    const { tileW, tileH } = FACADES[kind];
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    const sign = area > 0 ? 1 : -1;
    let u = uOff;
    const centerRoad = this.signs.length < 2500 && h > 7 ? nearestOnRoad([cx / pts.length, cz / pts.length]) : null;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      // xarici normal
      const nx = ((bz - az) / len) * -sign;
      const nz = (-(bx - ax) / len) * -sign;
      const u0 = u / tileW;
      const u1 = (u + len) / tileW;
      const v1 = h / tileH;
      const quad = [
        [ax, 0, az, u0, 0],
        [bx, 0, bz, u1, 0],
        [bx, h, bz, u1, v1],
        [ax, 0, az, u0, 0],
        [bx, h, bz, u1, v1],
        [ax, h, az, u0, v1],
      ];
      // üz xaricə baxsın deyə sıranı poliqonun istiqamətinə görə seç
      const order = sign < 0 ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      for (const k of order) {
        const [x, y, z, uu, vv] = quad[k];
        buf.pos.push(x, y, z);
        buf.nor.push(nx, 0, nz);
        buf.uv.push(uu, vv);
        buf.col.push(tint, tint, tint);
      }
      // yola baxan divarın birinci mərtəbəsinə işıqlı lövhə
      if (centerRoad && len > 7 && centerRoad.seg.c <= 3 && centerRoad.d < centerRoad.seg.half + 45) {
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const n = nearestOnRoad([mx, mz]);
        // bu divar binanın mərkəzindən yola daha yaxındırsa, deməli yola baxır
        if (n && n.d < centerRoad.d - 2 && n.d < n.seg.half + 22) {
          const dx = (n.x - mx) / (n.d || 1);
          const dz = (n.y - mz) / (n.d || 1);
          this.signs.push([mx + dx * 0.4, mz + dz * 0.4, Math.atan2(dx, dz), Math.min(len * 0.7, 10)]);
        }
      }
      u += len;
    }
    // dam
    const roof = ch.roof;
    const tris = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new THREE.Vector2(x, z)),
      [],
    );
    const shade = 0.6 + (tint - 0.9) * 0.8;
    for (const [a, b, c] of tris) {
      const pa = pts[a];
      const pb = pts[b];
      const pc = pts[c];
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      const tri = cross > 0 ? [pa, pc, pb] : [pa, pb, pc];
      for (const [x, z] of tri) {
        roof.pos.push(x, h, z);
        roof.nor.push(0, 1, 0);
        roof.uv.push(0, 0);
        roof.col.push(shade, shade, shade);
      }
    }
  }
  build(scene, materials) {
    for (const ch of this.chunks.values()) {
      for (const [kind, buf] of Object.entries(ch)) {
        if (!buf.pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
        g.computeBoundingSphere();
        scene.add(new THREE.Mesh(g, materials[kind]));
      }
    }
  }
}

const bounds = (pts) => {
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const [x, z] of pts) {
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    minz = Math.min(minz, z);
    maxz = Math.max(maxz, z);
  }
  return { minx, maxx, minz, maxz };
};

export function buildWorld(scene) {
  const animated = [];
  const time = { value: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // ---------- səma və işıq ----------
  scene.background = new THREE.Color('#0a0d1c');
  scene.fog = new THREE.FogExp2('#0d1024', 0.0014);
  scene.add(new THREE.HemisphereLight('#7a88ff', '#241a30', 1.0));
  const moon = new THREE.DirectionalLight('#c0caff', 1.2);
  moon.position.set(-600, 900, 400);
  scene.add(moon);

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  const r0 = rng(3);
  for (let i = 0; i < 1200; i++) {
    const th = r0() * Math.PI * 2;
    const ph = r0() * Math.PI * 0.42;
    const R = 5000;
    sp.push(
      W / 2 + R * Math.sin(ph) * Math.cos(th),
      R * Math.cos(ph) * 0.5 + 300,
      H / 2 + R * Math.sin(ph) * Math.sin(th),
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: '#dfe6ff', size: 2, sizeAttenuation: false, fog: false }),
    ),
  );
  const moonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('rgba(255,250,235,1)'), color: '#fff8e6', fog: false }),
  );
  moonSprite.scale.set(700, 700, 1);
  moonSprite.position.set(W / 2 + 1500, 1800, H + 3500);
  scene.add(moonSprite);

  // ---------- quru, dəniz, parklar ----------
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(W + 12000, H + 12000).rotateX(-Math.PI / 2).translate(W / 2, -0.05, H / 2),
      new THREE.MeshStandardMaterial({ color: '#15131c', roughness: 1 }),
    ),
  );
  const seaMat = fogShader(
    { time },
    `
      float w1 = sin(vWorld.x * 0.05 + time * 1.1) * sin(vWorld.z * 0.04 - time * 0.8);
      float w2 = sin(vWorld.x * 0.021 - vWorld.z * 0.027 + time * 0.6);
      float spark = smoothstep(0.86, 1.0, w1 * 0.6 + w2 * 0.5);
      vec3 col = vec3(0.03, 0.08, 0.17) + vec3(0.3, 0.45, 0.65) * spark * 0.45 + vec3(0.02, 0.04, 0.08) * w2;
      gl_FragColor = vec4(col, 1.0);
    `,
  );
  scene.add(new THREE.Mesh(flatPolygon(DATA.sea, 0.02), seaMat));

  const parkPolys = DATA.parks
    .map((flat) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      return pts;
    })
    .filter((p) => p.length >= 3);
  if (parkPolys.length)
    scene.add(
      new THREE.Mesh(
        mergeGeometries(parkPolys.map((p) => flatPolygon(p, 0.04))),
        new THREE.MeshStandardMaterial({
          color: '#16361f',
          roughness: 1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      ),
    );

  // ---------- yollar ----------
  const nodes = DATA.roads.nodes;
  const wayPts = DATA.roads.ways.map((w) => ({ c: w.c, pts: w.p.map((i) => nodes[i]) }));
  scene.add(
    new THREE.Mesh(
      mergeGeometries(wayPts.map((w) => ribbon(w.pts, ROAD_WIDTHS[w.c] + (w.c <= 2 ? 4 : 2.5), 0.05, true, 6))),
      new THREE.MeshStandardMaterial({
        color: '#3f3b4a',
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    ),
  );
  scene.add(
    new THREE.Mesh(
      mergeGeometries(wayPts.map((w) => ribbon(w.pts, ROAD_WIDTHS[w.c], 0.06 + (4 - w.c) * 0.004))),
      new THREE.MeshStandardMaterial({
        color: '#34313f',
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    ),
  );

  const dashes = [];
  for (const w of wayPts) {
    if (w.c > 1) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1];
      const [bx, bz] = w.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 3; d < len - 3; d += 12) {
        const t0 = d / len;
        const t1 = Math.min(1, (d + 5) / len);
        dashes.push(
          ribbon(
            [
              [ax + (bx - ax) * t0, az + (bz - az) * t0],
              [ax + (bx - ax) * t1, az + (bz - az) * t1],
            ],
            0.25,
            0.1,
            false,
          ),
        );
      }
    }
  }
  if (dashes.length)
    scene.add(
      new THREE.Mesh(
        mergeGeometries(dashes),
        new THREE.MeshBasicMaterial({
          color: '#b39a55',
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -12,
        }),
      ),
    );

  // ---------- küçə fənərləri (əsas yollarda) ----------
  const lamps = [];
  for (const w of wayPts) {
    if (w.c > 2) continue;
    const off = ROAD_WIDTHS[w.c] / 2 + 1.5;
    let next = 20;
    let walked = 0;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1];
      const [bx, bz] = w.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (!len) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      while (next <= walked + len) {
        const d = next - walked;
        const side = lamps.length % 2 ? 1 : -1;
        lamps.push([ax + ((bx - ax) * d) / len + nx * off * side, az + ((bz - az) * d) / len + nz * off * side]);
        next += 42;
      }
      walked += len;
    }
  }
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.14, 7, 6).translate(0, 3.5, 0),
    new THREE.MeshStandardMaterial({ color: '#4d485c' }),
    lamps.length,
  );
  const bulbs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.45, 10, 8).translate(0, 7.1, 0),
    new THREE.MeshBasicMaterial({ color: '#ffd9a0' }),
    lamps.length,
  );
  const pools = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(22, 22).rotateX(-Math.PI / 2).translate(0, 0.15, 0),
    new THREE.MeshBasicMaterial({
      map: glow,
      color: '#ffb46b',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    lamps.length,
  );
  lamps.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0, z);
    poles.setMatrixAt(i, m4);
    bulbs.setMatrixAt(i, m4);
    pools.setMatrixAt(i, m4);
  });
  scene.add(poles, bulbs, pools);

  // ---------- binalar ----------
  // öz modelimiz olan landmark-ların yerində OSM binalarını çəkmirik
  const custom = [
    ['flame', 110],
    ['hac', 170],
    ['crystal', 110],
    ['tower', 16],
    ['gallery', 80],
    ['eye', 40],
    ['fountains', 20],
  ];
  const inCustom = (x, z) =>
    custom.some(([id, r]) => Math.hypot(PLACES[id].pos[0] - x, PLACES[id].pos[1] - z) < r) ||
    Object.values(PLACES).some((p) => p.stop && Math.hypot(p.stop[0] - x, p.stop[1] - z) < 28);
  // binanın küncləri və mərkəzi yoldan kənardadırmı (maşın binanın içindən keçməsin)
  const clearOfRoads = (pts) => {
    let cx = 0;
    let cz = 0;
    for (const [x, z] of pts) {
      cx += x;
      cz += z;
    }
    const probe = [...pts, [cx / pts.length, cz / pts.length]];
    return probe.every((p) => {
      const n = nearestOnRoad(p);
      return !n || n.d > n.seg.half + 1;
    });
  };

  const builder = new BuildingBuilder();
  const rb = rng(42);
  const OCC = 12;
  const occCols = Math.ceil(W / OCC) + 1;
  const occ = new Uint8Array(occCols * (Math.ceil(H / OCC) + 1));
  for (const b of DATA.buildings) {
    const h = b[0] / 10;
    const pts = [];
    for (let i = 1; i < b.length; i += 2) pts.push([b[i] / 10, b[i + 1] / 10]);
    const { minx, maxx, minz, maxz } = bounds(pts);
    if (inCustom((minx + maxx) / 2, (minz + maxz) / 2) || !clearOfRoads(pts)) continue;
    for (let gx = Math.floor(minx / OCC); gx <= Math.floor(maxx / OCC); gx++)
      for (let gz = Math.floor(minz / OCC); gz <= Math.floor(maxz / OCC); gz++)
        if (gx >= 0 && gz >= 0) occ[gz * occCols + gx] = 1;
    const kind = h > 34 ? 'modern' : h < 22 && rb() < 0.75 ? 'classic' : 'panel';
    const [t0, t1] = FACADES[kind].tint;
    builder.add(pts, h, kind, t0 + rb() * (t1 - t0), rb() * 40);
  }

  // OSM-də binası olmayan məhəllələri doldururuq: yola yaxın, dənizdə və parkda olmayan yerlər
  const parkBounds = parkPolys.map((p) => ({ p, ...bounds(p) }));
  const inPark = (x, z) =>
    parkBounds.some((b) => x > b.minx && x < b.maxx && z > b.minz && z < b.maxz && pointInPoly([x, z], b.p));
  let filled = 0;
  for (let x = 30; x < W - 30; x += 38) {
    for (let z = 30; z < H - 30; z += 38) {
      const px = x + (rb() - 0.5) * 14;
      const pz = z + (rb() - 0.5) * 14;
      if (rb() < 0.18) continue;
      const g = Math.floor(px / OCC) + Math.floor(pz / OCC) * occCols;
      if (occ[g] || occ[g + 1] || occ[g - 1] || occ[g + occCols] || occ[g - occCols]) continue;
      if (inCustom(px, pz)) continue;
      const near = nearestOnRoad([px, pz]);
      if (!near || near.d < near.seg.half + 9 || near.d > 110) continue;
      if (pointInPoly([px, pz], DATA.sea) || inPark(px, pz)) continue;
      // yola paralel yerləşdir
      const ang = Math.atan2(near.seg[1][1] - near.seg[0][1], near.seg[1][0] - near.seg[0][0]);
      const w = 14 + rb() * 14;
      const d = 12 + rb() * 12;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const pts = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([u, v]) => [px + u * ca - v * sa, pz + u * sa + v * ca]);
      if (!clearOfRoads(pts)) continue;
      const tall = rb() < 0.12;
      const h = tall ? 35 + rb() * 45 : 10 + rb() * 18;
      const kind = tall ? 'modern' : rb() < 0.55 ? 'panel' : 'classic';
      const [t0, t1] = FACADES[kind].tint;
      builder.add(pts, h, kind, t0 + rb() * (t1 - t0), rb() * 40);
      filled++;
    }
  }
  const facadeMat = (kind, seed) => {
    const tex = facadeTexture(kind, seed);
    return new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: '#ffffff',
      emissiveIntensity: kind === 'modern' ? 0.9 : 0.75,
      roughness: kind === 'modern' ? 0.35 : 0.85,
      metalness: kind === 'modern' ? 0.4 : 0,
      vertexColors: true,
    });
  };
  addSigns(scene, builder.signs, rb);
  builder.build(scene, {
    classic: facadeMat('classic', 5),
    modern: facadeMat('modern', 9),
    panel: facadeMat('panel', 13),
    roof: new THREE.MeshStandardMaterial({ color: '#2a2634', roughness: 1, vertexColors: true }),
  });

  // ---------- ağaclar (parklarda) ----------
  const treeSpots = [];
  const rt = rng(11);
  for (const b of parkBounds) {
    const count = Math.min(120, ((b.maxx - b.minx) * (b.maxz - b.minz)) / 260);
    for (let i = 0; i < count && treeSpots.length < 5000; i++) {
      const x = b.minx + rt() * (b.maxx - b.minx);
      const z = b.minz + rt() * (b.maxz - b.minz);
      if (!pointInPoly([x, z], b.p) || inCustom(x, z)) continue;
      const n = nearestOnRoad([x, z]);
      if (n && n.d < n.seg.half + 2) continue;
      treeSpots.push([x, z]);
    }
  }
  const trees = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.2, 0),
    new THREE.MeshStandardMaterial({ color: '#1f5236', roughness: 0.9, flatShading: true }),
    treeSpots.length,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.2, 0.3, 2.4, 5).translate(0, 1.2, 0),
    new THREE.MeshStandardMaterial({ color: '#3b2a20' }),
    treeSpots.length,
  );
  treeSpots.forEach(([x, z], i) => {
    const s = 0.7 + rt() * 0.7;
    q.setFromAxisAngle(up, rt() * 6);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rt() * 0.5), s));
    trees.setMatrixAt(i, m4);
    trunks.setMatrixAt(i, m4);
  });
  scene.add(trees, trunks);

  // ---------- landmark-lar (real ölçülərə miqyaslanıb) ----------
  const place = (id, group, scale = 1, faceRoad = false) => {
    const p = PLACES[id];
    group.position.set(p.pos[0], 0, p.pos[1]);
    group.scale.setScalar(scale);
    // modelin ön tərəfi (+z) ən yaxın yola baxsın
    if (faceRoad && p.stop) group.rotation.y = Math.atan2(p.stop[0] - p.pos[0], p.stop[1] - p.pos[1]);
    scene.add(group);
    return group;
  };
  place('flame', flameTowers(time), 9);
  const eye = bakuEye();
  place('eye', eye.group, 5.5);
  animated.push(eye.update);
  place('tower', maidenTower(), 4);
  place('hac', hac(), 8);
  const crystal = crystalHall();
  place('crystal', crystal.group, 12);
  animated.push(crystal.update);
  const fountains = fountainsModel();
  place('fountains', fountains.group, 3.5);
  animated.push(fountains.update);
  place('ganjlik', tower('#6b5bff', 12), 5);
  place('white', tower('#e9eef7', 14), 5);
  const gallery = galleryModel();
  const GALLERY_SCALE = 4.5;
  place('gallery', gallery.group, GALLERY_SCALE, true);
  animated.push(addCrowd(scene, gallery.group, GALLERY_SCALE));
  animated.push(addPlatforms(scene));

  // ---------- yazılar ----------
  const labels = {};
  const labelHeight = { flame: 210, eye: 70, hac: 90, crystal: 60, tower: 40, ganjlik: 80, white: 90, gallery: 80 };
  for (const [id, p] of Object.entries(PLACES)) {
    const tex = labelTexture(`${p.emoji} ${p.name}`);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, sizeAttenuation: false, depthWrite: false }),
    );
    sprite.position.set(p.pos[0], labelHeight[id] || 25, p.pos[1]);
    sprite.scale.set(LABEL_SIZE * tex.aspect, LABEL_SIZE, 1);
    sprite.renderOrder = 10;
    scene.add(sprite);
    labels[id] = { sprite, text: `${p.emoji} ${p.name}`, highlight: false };
  }
  const setHighlight = (id) => {
    for (const [key, l] of Object.entries(labels)) {
      const on = key === id;
      if (on === l.highlight) continue;
      l.highlight = on;
      l.sprite.material.map.dispose();
      const tex = labelTexture(l.text, on);
      l.sprite.material.map = tex;
      l.sprite.scale.set(LABEL_SIZE * tex.aspect, LABEL_SIZE, 1);
    }
  };

  // ---------- trafik: yüzlərlə sadə maşın (bir InstancedMesh) ----------
  const traffic = createTraffic(scene, wayPts, rb);

  // ---------- atəşfəşanlıq ----------
  const fireworks = createFireworks(scene);

  // ---------- hədəf şüası ----------
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 160, 24, 1, true).translate(0, 80, 0),
    new THREE.MeshBasicMaterial({
      map: beamTexture(),
      color: '#ffc93c',
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5, 6.5, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffc93c', transparent: true, depthWrite: false }),
  );
  ring.position.y = 0.3;
  const target = new THREE.Group();
  target.add(beam, ring);
  scene.add(target);

  // ---------- marşrut xətti ----------
  const routeMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#ffc93c',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -16,
    }),
  );
  routeMesh.renderOrder = 2;
  scene.add(routeMesh);

  // ---------- avatar ----------
  const avatar = new THREE.Group();
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(2, 7, 16).rotateX(Math.PI).translate(0, 3.5, 0),
    new THREE.MeshBasicMaterial({ color: '#ffc93c' }),
  );
  const avatarSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  avatarSprite.renderOrder = 11;
  avatar.add(pin, avatarSprite);
  scene.add(avatar);

  return {
    time,
    setHighlight,
    setHerPhoto: gallery.setPhoto,
    addBillboards: (items, path) => addBillboards(scene, items, path),
    startFireworks: fireworks.start,
    setAvatar(img, emoji, name, pos) {
      const tex = avatarTexture(img, emoji, name);
      avatarSprite.material.map?.dispose();
      avatarSprite.material.map = tex;
      avatarSprite.material.needsUpdate = true;
      avatarSprite.scale.set(14 * tex.aspect, 14, 1);
      avatar.position.set(pos[0], 0, pos[1]);
    },
    setTarget(pos) {
      target.visible = !!pos;
      if (pos) target.position.set(pos[0], 0, pos[1]);
    },
    setRoute(path) {
      routeMesh.geometry.dispose();
      routeMesh.geometry = path.length > 1 ? ribbon(path, 1.6, 0.3, true, 6) : new THREE.BufferGeometry();
    },
    update(t, dt, pointAlong, player) {
      time.value = t;
      for (const a of animated) a(t, dt);
      const pulse = (t * 0.9) % 1;
      ring.scale.setScalar(1 + pulse * 1.6);
      ring.material.opacity = 1 - pulse;
      beam.material.opacity = 0.35 + Math.sin(t * 3) * 0.1;
      pin.position.y = Math.sin(t * 2.5) * 0.8;
      avatarSprite.position.y = 17 + Math.sin(t * 2.5) * 0.8;
      traffic.update(dt, pointAlong, player);
      fireworks.update(dt);
    },
    stats: {
      buildings: DATA.buildings.length,
      filled,
      lamps: lamps.length,
      trees: treeSpots.length,
      signs: builder.signs.length,
      traffic: traffic.count,
    },
  };
}

// ---------- landmark modelləri (öz vahidlərində qurulur, sonra miqyaslanır) ----------
function flameTowers(time) {
  const g = new THREE.Group();
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(11, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.28, 1),
    new THREE.MeshStandardMaterial({ color: '#1e2f24', roughness: 1 }),
  );
  g.add(hill);
  const mat = fogShader(
    { time },
    `
      float y = vUv.y;
      float wave = sin(vUv.x * 18.0 + time * 2.0) * 0.04 + sin(vUv.x * 7.0 - time * 1.3) * 0.05;
      float f = fract(y * 2.5 - time * 0.45 + wave);
      vec3 red = vec3(1.0, 0.22, 0.05);
      vec3 orange = vec3(1.0, 0.55, 0.1);
      vec3 yellow = vec3(1.0, 0.9, 0.45);
      vec3 col = mix(red, orange, smoothstep(0.0, 0.5, f));
      col = mix(col, yellow, smoothstep(0.55, 1.0, f) * y);
      gl_FragColor = vec4(col * (0.9 + 0.3 * y), 1.0);
    `,
  );
  const profile = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    profile.push(new THREE.Vector2(Math.max(0.02, 1.6 * Math.sin(Math.PI * (0.35 + t * 0.65)) * (1 - t * 0.35)), t));
  }
  for (const [dx, dz, h, s] of [
    [-3.5, 1.2, 17, 1.0],
    [0.3, -2.2, 21, 1.15],
    [3.8, 1.5, 15, 0.95],
  ]) {
    const geo = new THREE.LatheGeometry(profile, 32);
    geo.scale(s * 1.4, h, s);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(dx, 2.4, dz);
    g.add(m);
  }
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: '#ff7a1a',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.set(40, 40, 1);
  halo.position.y = 12;
  g.add(halo);
  return g;
}

function bakuEye() {
  const group = new THREE.Group();
  const wheel = new THREE.Group();
  wheel.position.y = 6.5;
  const R = 5.5;
  const neon = new THREE.MeshBasicMaterial({ color: '#8fd3ff' });
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 64), neon));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.35, 0.1, 8, 32), neon));
  const cabins = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, R, 4), neon);
    spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.7, 0.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(i / 16, 0.8, 0.6) }),
    );
    cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(cab);
    cabins.push(cab);
  }
  group.add(wheel);
  const legMat = new THREE.MeshStandardMaterial({ color: '#c9d4e8', metalness: 0.6, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7.5, 6), legMat);
    leg.position.set(s * 1.8, 3.5, 0.6);
    leg.rotation.z = s * 0.25;
    group.add(leg);
  }
  group.rotation.y = 0.35;
  return {
    group,
    update: (t) => {
      wheel.rotation.z = t * 0.15;
      for (const c of cabins) c.rotation.z = -wheel.rotation.z;
    },
  };
}

function maidenTower() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#b9a07e', roughness: 0.95, flatShading: true });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 7, 20), stone);
  t.position.y = 3.5;
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6.4, 1.6), stone);
  b.position.set(1.8, 3.2, 0);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.7, 0.5, 20), stone);
  top.position.y = 7.2;
  const light = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, color: '#ffcf8a', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  light.scale.set(14, 14, 1);
  light.position.y = 3;
  g.add(t, b, top, light);
  return g;
}

function hac() {
  const geo = new THREE.PlaneGeometry(26, 14, 60, 30);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i);
    const v = p.getY(i);
    const edge = Math.max(0, 1 - (v / 7) ** 2);
    const h =
      (7 * Math.exp(-((u + 5) ** 2) / 30) + 9 * Math.exp(-((u - 5) ** 2) / 22) + 2.5 * Math.exp(-(u ** 2) / 8)) * edge;
    p.setZ(i, h);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: '#f4f1ea',
      emissive: '#bfc6ff',
      emissiveIntensity: 0.3,
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  m.rotation.y = 0.3;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

function crystalHall() {
  const mat = new THREE.MeshStandardMaterial({
    color: '#222',
    emissive: '#55f',
    emissiveIntensity: 1,
    flatShading: true,
    roughness: 0.3,
  });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0).scale(1.5, 0.7, 1.2), mat);
  m.position.y = 1.6;
  const g = new THREE.Group();
  g.add(m);
  return { group: g, update: (t) => mat.emissive.setHSL((t * 0.08) % 1, 0.8, 0.5) };
}

function fountainsModel() {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3.2, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: '#8f8aa0' }),
  );
  basin.position.y = 0.25;
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.7, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#3d8fd6' }),
  );
  water.position.y = 0.52;
  g.add(basin, water);
  const N = 220;
  const pos = new Float32Array(N * 3);
  const seeds = Array.from({ length: N }, (_, i) => ({ a: (i / N) * Math.PI * 2 * 7, off: Math.random() }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const drops = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: '#bfe4ff', size: 0.18, transparent: true, opacity: 0.85 }),
  );
  drops.position.y = 0.5;
  g.add(drops);
  return {
    group: g,
    update: (t) => {
      for (let i = 0; i < N; i++) {
        const k = (t * 0.8 + seeds[i].off) % 1;
        const r = k * 1.4;
        pos[i * 3] = Math.cos(seeds[i].a) * r;
        pos[i * 3 + 1] = 4 * k * (1 - k) * 3.2;
        pos[i * 3 + 2] = Math.sin(seeds[i].a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

function tower(color, h) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.6, h, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5 }),
  );
  m.position.y = h / 2;
  g.add(m);
  return g;
}

// ---------- Gözəllik sərgisi (fasad +z tərəfə baxır) ----------
function photoPlaceholder() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2238';
  ctx.fillRect(0, 0, 256, 256);
  ctx.font = '110px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🖼️', 128, 128);
  return c;
}

function neonSign(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.font = '900 84px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff5fb0';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#ffd1ea';
  ctx.fillText(text, 512, 84);
  ctx.fillText(text, 512, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function galleryModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(18, 11, 8),
    new THREE.MeshStandardMaterial({ color: '#1d1a26', roughness: 0.4, metalness: 0.3 }),
  );
  body.position.set(0, 5.5, -1);
  g.add(body);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.3, 8.4), new THREE.MeshBasicMaterial({ color: '#ff7ac2' }));
  trim.position.set(0, 11, -1);
  g.add(trim);

  // bir az tündləşdirilib ki, bloom şəkli ağartmasın
  const photoMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(photoPlaceholder()), color: '#c8c8c8' });
  photoMat.map.colorSpace = THREE.SRGBColorSpace;
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), photoMat);
  photo.position.set(0, 5.6, 3.06);
  g.add(photo);
  const gold = new THREE.MeshStandardMaterial({
    color: '#d9a93c',
    metalness: 0.9,
    roughness: 0.25,
    emissive: '#3a2a05',
  });
  for (const [w, h, x, y] of [
    [7.8, 0.4, 0, 9.3],
    [7.8, 0.4, 0, 1.9],
    [0.4, 7.8, -3.7, 5.6],
    [0.4, 7.8, 3.7, 5.6],
  ]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), gold);
    f.position.set(x, y, 3.1);
    g.add(f);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.2),
    new THREE.MeshBasicMaterial({ map: neonSign('GÖZƏLLİK SƏRGİSİ'), transparent: true }),
  );
  sign.position.set(0, 12.6, 3.05);
  g.add(sign);
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3.6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#b3122e', roughness: 0.9 }),
  );
  carpet.position.set(-2, 0.07, 4.9);
  g.add(carpet);
  for (const x of [-3.9, -0.1]) {
    for (const z of [3.6, 5, 6.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 8), gold);
      post.position.set(x, 0.55, z);
      g.add(post);
    }
  }
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: '#fff0d6',
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  for (const x of [-7, 7]) {
    const from = new THREE.Vector3(x, 0.3, 5.6);
    const to = new THREE.Vector3(0, 5.6, 3.1);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 0.25, from.distanceTo(to), 20, 1, true), beamMat);
    cone.position.copy(from).lerp(to, 0.5);
    cone.lookAt(to);
    cone.rotateX(Math.PI / 2);
    g.add(cone);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 12), gold);
    lamp.position.copy(from);
    g.add(lamp);
  }
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: '#ff9fd0',
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.set(16, 16, 1);
  halo.position.set(0, 6, 1);
  g.add(halo);

  return {
    group: g,
    setPhoto(img) {
      if (!img) return;
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
      photoMat.map.dispose();
      photoMat.map = new THREE.CanvasTexture(c);
      photoMat.map.colorSpace = THREE.SRGBColorSpace;
      photoMat.needsUpdate = true;
    },
  };
}

// dənizdə neft platformaları
function addPlatforms(scene) {
  const lights = [];
  const legMat = new THREE.MeshStandardMaterial({ color: '#3a3848', roughness: 0.8 });
  for (const [x, z] of [
    [3600, 5200],
    [4600, 6100],
    [2600, 6500],
    [5400, 5200],
  ]) {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.scale.setScalar(6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 4), legMat);
    deck.position.y = 2.5;
    p.add(deck);
    for (const [dx, dz] of [
      [-1.6, -1.6],
      [1.6, -1.6],
      [-1.6, 1.6],
      [1.6, 1.6],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.5, 6), legMat);
      leg.position.set(dx, 1.25, dz);
      p.add(leg);
    }
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.5, 5, 6), legMat);
    t.position.set(1, 5, 1);
    p.add(t);
    const light = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: '#ff5a3c', transparent: true, depthWrite: false }),
    );
    light.scale.set(3, 3, 1);
    light.position.set(1, 7.6, 1);
    const deckLight = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: '#ffd28a', transparent: true, depthWrite: false }),
    );
    deckLight.scale.set(7, 7, 1);
    deckLight.position.set(0, 3, 0);
    p.add(light, deckLight);
    lights.push(light);
    scene.add(p);
  }
  return (t) => lights.forEach((l, i) => (l.material.opacity = Math.sin(t * 2 + i) > 0 ? 1 : 0.2));
}

// ---------- işıqlı mağaza lövhələri ----------
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  // "yazı" təsiri verən bloklar
  let x = 18;
  while (x < 230) {
    const w = 10 + Math.random() * 26;
    ctx.fillRect(x, 20, w, 24);
    x += w + 6 + Math.random() * 10;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addSigns(scene, signs, rnd) {
  if (!signs.length) return;
  const palette = ['#ff4f9a', '#39ff88', '#4dd2ff', '#ffc93c', '#b77dff', '#ff6b3d', '#ffffff'];
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }),
    signs.length,
  );
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  signs.forEach(([x, z, ang, w], i) => {
    const sw = Math.max(3, w * (0.5 + rnd() * 0.5));
    q.setFromAxisAngle(up, ang);
    m4.compose(new THREE.Vector3(x, 3.6 + rnd() * 1.4, z), q, new THREE.Vector3(sw, 0.9 + rnd() * 0.6, 1));
    mesh.setMatrixAt(i, m4);
    col.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.8 + rnd() * 0.6);
    mesh.setColorAt(i, col);
  });
  scene.add(mesh);
}

// ---------- trafik ----------
function createTraffic(scene, wayPts, rnd) {
  const COUNT = 260;
  const lanes = wayPts
    .filter((w) => w.c <= 3 && w.pts.length > 1)
    .map((w) => {
      let len = 0;
      for (let k = 1; k < w.pts.length; k++)
        len += Math.hypot(w.pts[k][0] - w.pts[k - 1][0], w.pts[k][1] - w.pts[k - 1][1]);
      const mid = w.pts[Math.floor(w.pts.length / 2)];
      return { ...w, len, mid };
    })
    .filter((w) => w.len > 120);
  // uzun və əsas yollara daha çox maşın düşsün
  const weights = lanes.map((w) => w.len * (w.c <= 1 ? 3 : w.c === 2 ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = rnd() * total;
    for (let i = 0; i < lanes.length; i++) if ((r -= weights[i]) <= 0) return lanes[i];
    return lanes[0];
  };

  const body = new THREE.BoxGeometry(4.2, 0.75, 1.85).translate(0, 0.72, 0);
  const cabin = new THREE.BoxGeometry(2.1, 0.6, 1.6).translate(-0.3, 1.38, 0);
  const carGeo = mergeGeometries([body, cabin]);
  const cars = new THREE.InstancedMesh(
    carGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 }),
    COUNT,
  );
  // faralar və stop işıqları: ağ önə, qırmızı arxaya (vertex rəngləri ilə bir mesh)
  const lightParts = [];
  for (const z of [0.62, -0.62]) {
    const front = new THREE.BoxGeometry(0.1, 0.2, 0.45).translate(2.12, 0.8, z);
    const back = new THREE.BoxGeometry(0.1, 0.18, 0.5).translate(-2.12, 0.8, z);
    for (const [g, c] of [
      [front, [1.6, 1.5, 1.3]],
      [back, [1.8, 0.1, 0.1]],
    ]) {
      const colors = [];
      for (let i = 0; i < g.attributes.position.count; i++) colors.push(...c);
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      lightParts.push(g);
    }
  }
  const lights = new THREE.InstancedMesh(
    mergeGeometries(lightParts),
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    COUNT,
  );
  const palette = [
    '#e8e8f0',
    '#4d7cff',
    '#2b2b35',
    '#9aa0b5',
    '#3ddc97',
    '#c77dff',
    '#ff8c42',
    '#f1f1f1',
    '#1a1a1a',
    '#d62828',
    '#f4d35e',
    '#6c757d',
  ];
  const col = new THREE.Color();
  const list = [];
  for (let i = 0; i < COUNT && lanes.length; i++) {
    const w = pick();
    list.push({
      far: 0,
      w,
      s: rnd() * w.len,
      dir: rnd() < 0.5 ? 1 : -1,
      speed: w.c <= 1 ? 12 + rnd() * 8 : 7 + rnd() * 6,
      lane: ROAD_WIDTHS[w.c] / 4,
    });
    col.set(palette[Math.floor(rnd() * palette.length)]);
    cars.setColorAt(i, col);
  }
  scene.add(cars, lights);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    count: list.length,
    update(dt, pointAlong, player) {
      list.forEach((n, i) => {
        // oyunçudan çox uzaqdadırsa, onun ətrafındakı bir yola köçür — şəhər həmişə canlı görünsün
        if (player && n.far > 1.5) {
          for (let k = 0; k < 12; k++) {
            const w = pick();
            const d = Math.hypot(w.mid[0] - player[0], w.mid[1] - player[1]);
            if (d < 550 && d > 80) {
              n.w = w;
              n.s = rnd() * w.len;
              n.lane = ROAD_WIDTHS[w.c] / 4;
              n.speed = w.c <= 1 ? 12 + rnd() * 8 : 7 + rnd() * 6;
              break;
            }
          }
          n.far = 0;
        }
        n.s += n.dir * n.speed * dt;
        if (n.s > n.w.len || n.s < 0) {
          // yolun sonunda başqa yola keç
          n.w = pick();
          n.s = n.dir > 0 ? 0 : n.w.len;
        }
        const p = pointAlong(n.w.pts, n.s);
        const side = n.dir > 0 ? n.lane : -n.lane;
        q.setFromAxisAngle(up, -(p.a + (n.dir < 0 ? Math.PI : 0)));
        m4.compose(pos.set(p.x - Math.sin(p.a) * side, 0, p.y + Math.cos(p.a) * side), q, one);
        cars.setMatrixAt(i, m4);
        lights.setMatrixAt(i, m4);
        if (player) n.far = Math.hypot(pos.x - player[0], pos.z - player[1]) > 700 ? n.far + dt : 0;
      });
      cars.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- sərginin qarşısında izdiham və fotoaparat işıqları ----------
function addCrowd(scene, galleryGroup, scale) {
  const COUNT = 320;
  const group = new THREE.Group();
  group.position.copy(galleryGroup.position);
  group.rotation.copy(galleryGroup.rotation);
  scene.add(group);

  const bodyGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.15, 7).translate(0, 0.58, 0);
  const headGeo = new THREE.SphereGeometry(0.2, 8, 6).translate(0, 1.42, 0);
  const people = new THREE.InstancedMesh(
    mergeGeometries([bodyGeo, headGeo]),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    COUNT,
  );
  const clothes = [
    '#e63946',
    '#f1faee',
    '#a8dadc',
    '#457b9d',
    '#1d3557',
    '#ffb703',
    '#8338ec',
    '#2a9d8f',
    '#222',
    '#e9c46a',
    '#ff70a6',
  ];
  const col = new THREE.Color();
  const front = 3.4 * scale; // fasadın önü
  const spots = [];
  for (let i = 0; i < COUNT; i++) {
    // şəklin qarşısında yarımdairə şəklində
    const r = front + 3 + Math.random() * 16;
    const a = (Math.random() - 0.5) * 2.2;
    spots.push({
      x: Math.sin(a) * r * 1.3,
      z: Math.cos(a) * r * 0.55 + front * 0.45,
      ph: Math.random() * 6,
      h: 0.9 + Math.random() * 0.25,
    });
    col.set(clothes[Math.floor(Math.random() * clothes.length)]);
    people.setColorAt(i, col);
  }
  group.add(people);

  const glowTex = glowTexture();
  const flashes = Array.from({ length: 14 }, () => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sp.scale.setScalar(2.2);
    group.add(sp);
    return { sp, t: Math.random() * 3 };
  });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  return (t, dt) => {
    spots.forEach((p, i) => {
      // hamı şəklə baxır və yüngül yırğalanır
      q.setFromAxisAngle(up, Math.atan2(-p.x, -p.z));
      const bob = Math.abs(Math.sin(t * 3 + p.ph)) * 0.12;
      m4.compose(v.set(p.x, bob, p.z), q, sc.set(1, p.h, 1));
      people.setMatrixAt(i, m4);
    });
    people.instanceMatrix.needsUpdate = true;
    for (const f of flashes) {
      f.t -= dt;
      if (f.t <= 0) {
        const p = spots[Math.floor(Math.random() * spots.length)];
        f.sp.position.set(p.x, 1.7 * p.h + 0.2, p.z - 0.3);
        f.t = 0.4 + Math.random() * 2.5;
        f.sp.material.opacity = 1;
      }
      f.sp.material.opacity *= Math.pow(0.001, dt * 6);
    }
  };
}

// ---------- atəşfəşanlıq ----------
function createFireworks(scene) {
  const MAX = 4000;
  const pos = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 2.6,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  let center = null;
  let remaining = 0;
  let timer = 0;
  const palette = ['#ff4f9a', '#ffc93c', '#4dd2ff', '#39ff88', '#ffffff', '#b77dff', '#ff6b3d'].map(
    (c) => new THREE.Color(c),
  );

  const burst = () => {
    const cx = center[0] + (Math.random() - 0.5) * 160;
    const cz = center[1] + (Math.random() - 0.5) * 160;
    const cy = 90 + Math.random() * 70;
    const c = palette[Math.floor(Math.random() * palette.length)];
    for (let k = 0; k < 160; k++) {
      const i = next;
      next = (next + 1) % MAX;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 22 + Math.random() * 8;
      vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      vel[i * 3 + 1] = Math.cos(ph) * sp;
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      pos[i * 3] = cx;
      pos[i * 3 + 1] = cy;
      pos[i * 3 + 2] = cz;
      life[i] = 1.6 + Math.random() * 0.8;
      colors[i * 3] = c.r * 2;
      colors[i * 3 + 1] = c.g * 2;
      colors[i * 3 + 2] = c.b * 2;
    }
  };

  return {
    start(p, count = 30) {
      center = p;
      remaining = count;
      timer = 0;
    },
    update(dt) {
      if (center && remaining > 0) {
        timer -= dt;
        if (timer <= 0) {
          burst();
          remaining--;
          timer = 0.35 + Math.random() * 0.6;
        }
      }
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        vel[i * 3 + 1] -= 9.8 * dt * 0.6;
        for (let a = 0; a < 3; a++) vel[i * 3 + a] *= 1 - 0.9 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const fade = Math.max(0, Math.min(1, life[i]));
        if (life[i] <= 0) pos[i * 3 + 1] = -1000;
        colors[i * 3] *= 0.985 + fade * 0.01;
        colors[i * 3 + 1] *= 0.985 + fade * 0.01;
        colors[i * 3 + 2] *= 0.985 + fade * 0.01;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---------- yolun üstündən keçən bilbordlar (admin mətnləri) ----------
function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function billboardTexture(text, img) {
  const W = 1024;
  const H = 400;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1b1030');
  g.addColorStop(1, '#2d0f2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // neon çərçivə
  ctx.strokeStyle = '#ffc93c';
  ctx.lineWidth = 10;
  ctx.shadowColor = '#ffc93c';
  ctx.shadowBlur = 24;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.shadowBlur = 0;
  let x = 60;
  if (img) {
    const size = H - 90;
    const s = Math.min(img.width, img.height);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(45, 45, size, size, 24);
    ctx.clip();
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 45, 45, size, size);
    ctx.restore();
    x = 45 + size + 40;
  }
  const maxW = W - x - 50;
  let size = 76;
  let lines;
  do {
    ctx.font = `900 ${size}px Nunito, sans-serif`;
    lines = wrapText(ctx, text, maxW);
    size -= 4;
  } while ((lines.length * size * 1.2 > H - 110 || lines.some((l) => ctx.measureText(l).width > maxW)) && size > 28);
  ctx.fillStyle = '#fff6e0';
  ctx.textBaseline = 'middle';
  ctx.textAlign = img ? 'left' : 'center';
  const lh = size * 1.22;
  const top = H / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, img ? x : W / 2, top + i * lh));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function addBillboards(scene, items, path) {
  const list = items.filter((b) => b.text?.trim() || b.image);
  if (!list.length || path.length < 2) return [];
  // yolun ümumi uzunluğu və bərabər aralıqlarla yerlər
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum.at(-1);
  const at = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const k = (d - cum[i - 1]) / seg;
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, a: Math.atan2(bz - az, bx - ax) };
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3c3848', metalness: 0.6, roughness: 0.4 });
  const glow = glowTexture();
  const placed = [];
  list.forEach((item, i) => {
    const d = Math.min(total - 80, Math.max(120, (total * (i + 1)) / (list.length + 1)));
    const p = at(d);
    placed.push(p);
    const n = nearestOnRoad([p.x, p.z]);
    const span = Math.min(24, (n ? n.seg.half * 2 : 10) + 4);
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    // panel maşına doğru baxsın (sürücü yaxınlaşanda oxusun)
    group.rotation.y = -p.a - Math.PI / 2;
    const H = span * 0.39;
    const mat = new THREE.MeshBasicMaterial({ map: billboardTexture(item.text || '', null), toneMapped: false });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(span, H), mat);
    panel.position.y = 7 + H / 2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, H + 0.6, 0.4), poleMat);
    back.position.set(0, panel.position.y, -0.25);
    group.add(panel, back);
    for (const sx of [-span / 2 - 0.3, span / 2 + 0.3]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7 + H, 8), poleMat);
      pole.position.set(sx, (7 + H) / 2, -0.25);
      group.add(pole);
    }
    // aşağıdan işıqlandırma
    const light = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#ffd89a',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    light.scale.set(span * 1.3, H * 1.6, 1);
    light.position.set(0, panel.position.y, -0.8); // arxada — kənarlarda halo, yazını örtmür
    group.add(light);
    scene.add(group);
    if (item.image) {
      const img = new Image();
      img.onload = () => {
        mat.map.dispose();
        mat.map = billboardTexture(item.text || '', img);
        mat.needsUpdate = true;
      };
      img.src = item.image;
    }
  });
  return placed;
}
