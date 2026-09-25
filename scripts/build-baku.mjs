// OpenStreetMap məlumatından oyun üçün yığcam Bakı xəritəsi hazırlayır.
// İstifadə: node scripts/build-baku.mjs [--fetch]
// Nəticə: client/public/baku.json  (© OpenStreetMap contributors, ODbL)
import fs from 'node:fs';
import path from 'node:path';

const BBOX = { s: 40.34, w: 49.82, n: 40.402, e: 49.892 };
const CACHE = path.resolve('scripts/.osm-cache');
const OUT = path.resolve('client/public/baku.json');

const LAT0 = BBOX.n;
const LON0 = BBOX.w;
const KX = 111320 * Math.cos((((BBOX.n + BBOX.s) / 2) * Math.PI) / 180);
const KY = 110990;
const proj = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
const W = (BBOX.e - BBOX.w) * KX;
const H = (BBOX.n - BBOX.s) * KY;
const r1 = (v) => Math.round(v * 10) / 10;

const ROAD_CLASSES = {
  motorway: 0,
  trunk: 0,
  primary: 0,
  motorway_link: 1,
  trunk_link: 1,
  primary_link: 1,
  secondary: 1,
  secondary_link: 2,
  tertiary: 2,
  tertiary_link: 2,
  unclassified: 3,
  residential: 3,
  living_street: 4,
  pedestrian: 4,
};

const QUERIES = {
  buildings: `[out:json][timeout:180];(way["building"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});relation["building"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););out geom;`,
  roads: `[out:json][timeout:180];way["highway"~"^(${Object.keys(ROAD_CLASSES).join('|')})$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});out geom;`,
  other: `[out:json][timeout:180];(way["natural"="coastline"](${BBOX.s - 0.02},${BBOX.w - 0.02},${BBOX.n + 0.02},${BBOX.e + 0.02});way["leisure"~"^(park|garden)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});way["landuse"~"^(grass|forest)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}););out geom;`,
};

async function load(name) {
  const file = path.join(CACHE, `${name}.json`);
  if (!process.argv.includes('--fetch') && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(CACHE, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'date-game/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(QUERIES[name])}`,
    });
    const text = await res.text();
    if (text.startsWith('{')) {
      fs.writeFileSync(file, text);
      return JSON.parse(text);
    }
    console.log(`${name}: server məşğuldur, yenidən cəhd...`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw new Error(`${name} yüklənmədi`);
}

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return a / 2;
}

// ---------- sahil → dəniz poliqonu ----------
function buildSea(elements) {
  const lines = elements
    .filter((e) => e.tags?.natural === 'coastline')
    .map((e) => ({ ids: e.nodes, pts: e.geometry.map((g) => proj(g.lat, g.lon)) }));
  // ucları eyni node olan xətləri birləşdir
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (const a of lines) {
      for (const b of lines) {
        if (a === b) continue;
        if (a.ids.at(-1) === b.ids[0]) {
          a.ids = [...a.ids, ...b.ids.slice(1)];
          a.pts = [...a.pts, ...b.pts.slice(1)];
          lines.splice(lines.indexOf(b), 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const main = lines.sort((a, b) => b.pts.length - a.pts.length)[0].pts;
  // OSM-də sahil xəttinin sağ tərəfi dənizdir. Xətti böyük çərçivə ilə bağlayıb hansı tərəfin dəniz olduğunu yoxlayırıq.
  const M = 4000;
  const corners = [
    [-M, -M],
    [W + M, -M],
    [W + M, H + M],
    [-M, H + M],
  ];
  const seaPoint = proj(40.35, 49.865); // Bakı buxtası
  const landPoint = proj(40.3709, 49.8368); // Fəvvarələr meydanı
  const candidates = [];
  const nearest = (pt) =>
    corners.reduce(
      (best, c, i) =>
        Math.hypot(c[0] - pt[0], c[1] - pt[1]) < Math.hypot(corners[best][0] - pt[0], corners[best][1] - pt[1])
          ? i
          : best,
      0,
    );
  const kEnd = nearest(main.at(-1));
  const kStart = nearest(main[0]);
  for (const dir of [1, -1]) {
    // xəttin sonundan başlanğıcına qədər çərçivənin künclərini dolaş
    const ring = [...main];
    for (let k = kEnd, i = 0; i < 5; k = (k + dir + 4) % 4, i++) {
      ring.push(corners[k]);
      if (k === kStart) break;
    }
    candidates.push(ring);
  }
  const sea = candidates.find((p) => pointInPoly(seaPoint, p) && !pointInPoly(landPoint, p)) || candidates[0];
  // çərçivədən çox uzaq nöqtələri sadələşdir
  return sea.map(([x, y]) => [r1(x), r1(y)]);
}

// ---------- yollar ----------
function buildRoads(elements) {
  const nodeIndex = new Map();
  const nodes = [];
  const ways = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const c = ROAD_CLASSES[e.tags.highway];
    if (c === undefined) continue;
    const idx = e.nodes.map((id, i) => {
      if (!nodeIndex.has(id)) {
        nodeIndex.set(id, nodes.length);
        const [x, y] = proj(e.geometry[i].lat, e.geometry[i].lon);
        nodes.push([r1(x), r1(y)]);
      }
      return nodeIndex.get(id);
    });
    ways.push({ c, n: e.tags.name || '', p: idx });
  }
  // yalnız ən böyük bağlı hissəni saxla ki, hər yerə marşrut olsun
  const adj = nodes.map(() => []);
  for (const w of ways)
    for (let i = 1; i < w.p.length; i++) {
      adj[w.p[i - 1]].push(w.p[i]);
      adj[w.p[i]].push(w.p[i - 1]);
    }
  const comp = new Int32Array(nodes.length).fill(-1);
  const sizes = [];
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || !adj[s].length) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const v of adj[u]) if (comp[v] === -1) ((comp[v] = id), stack.push(v));
    }
    sizes.push(size);
  }
  const big = sizes.indexOf(Math.max(...sizes));
  const keep = ways.filter((w) => comp[w.p[0]] === big);
  // istifadə olunan node-ları yenidən nömrələ
  const remap = new Map();
  const outNodes = [];
  for (const w of keep)
    w.p = w.p.map((i) => {
      if (!remap.has(i)) remap.set(i, outNodes.push(nodes[i]) - 1);
      return remap.get(i);
    });
  console.log(`yollar: ${keep.length}/${ways.length} xətt, ${outNodes.length} node`);
  return { nodes: outNodes, ways: keep };
}

// ---------- binalar ----------
function hash(n) {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  return (((x >>> 16) ^ x) >>> 0) / 4294967295;
}

function buildBuildings(elements) {
  const out = [];
  for (const e of elements) {
    const rings = [];
    if (e.type === 'way' && e.geometry) rings.push(e.geometry);
    if (e.type === 'relation')
      for (const m of e.members || []) if (m.role === 'outer' && m.geometry) rings.push(m.geometry);
    const t = e.tags || {};
    const levels = parseFloat(t['building:levels']);
    const height = parseFloat(t.height);
    for (const g of rings) {
      let pts = g.map((p) => proj(p.lat, p.lon));
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      if (pts.length < 3) continue;
      const a = area(pts);
      if (Math.abs(a) < 20) continue;
      if (a < 0) pts = pts.reverse();
      // hündürlük: teq varsa ondan, yoxsa ölçüyə görə təxmini
      const rnd = hash(e.id);
      let h = height || (levels ? levels * 3.3 + 1 : 0);
      if (!h) h = Math.min(45, 9 + rnd * 12 + Math.sqrt(Math.abs(a)) * 0.12);
      out.push([Math.round(h * 10), ...pts.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])]);
    }
  }
  console.log(`binalar: ${out.length}`);
  return out;
}

function buildParks(elements) {
  return elements
    .filter((e) => (e.tags?.leisure || e.tags?.landuse) && e.geometry && e.geometry.length > 3)
    .map((e) => e.geometry.map((g) => proj(g.lat, g.lon)).flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
}

const [b, r, o] = [await load('buildings'), await load('roads'), await load('other')];
const data = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  origin: { lat: LAT0, lon: LON0, kx: KX, ky: KY },
  size: [Math.round(W), Math.round(H)],
  sea: buildSea(o.elements),
  roads: buildRoads(r.elements),
  buildings: buildBuildings(b.elements),
  parks: buildParks(o.elements),
};
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`${OUT}: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
