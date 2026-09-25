// Real Bakı xəritəsi (OpenStreetMap). Koordinatlar metrlədir: x — şərqə, y — cənuba.
// Məlumat scripts/build-baku.mjs ilə hazırlanır və /baku.json-dan yüklənir.

const LAT0 = 40.402;
const LON0 = 49.82;
const KX = 111320 * Math.cos((((40.402 + 40.34) / 2) * Math.PI) / 180);
const KY = 110990;
export const project = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KY];

export const METERS_PER_UNIT = 1;
// yol sinfinə görə eni (m): 0 — magistral ... 4 — piyada/həyət
export const ROAD_WIDTHS = [18, 14, 11, 8, 7];

const ll = (lat, lon) => project(lat, lon);

// Məkanlar (landmark-ların real koordinatları). stop — ən yaxın yol nöqtəsi, xəritə yüklənəndə hesablanır.
export const PLACES = {
  flame: { name: 'Alov qüllələri', emoji: '🔥', pos: ll(40.35998, 49.82625) },
  eye: { name: 'Şeytan çarxı', emoji: '🎡', pos: ll(40.35469, 49.83754) },
  crystal: { name: 'Crystal Hall', emoji: '💎', pos: ll(40.34416, 49.85023) },
  park: { name: 'Dənizkənarı bulvar', emoji: '🌊', pos: ll(40.3668, 49.8452) },
  tower: { name: 'Qız qalası', emoji: '🏰', pos: ll(40.36615, 49.83727) },
  fountains: { name: 'Fəvvarələr meydanı', emoji: '⛲', pos: ll(40.37094, 49.83683) },
  nizami: { name: 'Nizami küçəsi', emoji: '🛍️', pos: ll(40.3723, 49.83792) },
  gallery: { name: 'Gözəllik sərgisi', emoji: '🖼️', pos: ll(40.3702, 49.8398) },
  ganjlik: { name: 'Gənclik', emoji: '🏬', pos: ll(40.39989, 49.85283) },
  hac: { name: 'Heydər Əliyev Mərkəzi', emoji: '🏛️', pos: ll(40.39614, 49.86752) },
  white: { name: 'Ağ şəhər', emoji: '🏙️', pos: ll(40.381, 49.88756) },
};

// öz 3D modeli olan məkanların təxmini radiusu (m) — yoldan bu qədər uzaq olmalıdır
const FOOTPRINT = { gallery: 36, fountains: 12, tower: 9, white: 14, ganjlik: 14 };

export let DATA = null;
export let W = 6106;
export let H = 6881;
export let SEGMENTS = [];

const CELL = 50;
let grid = null;
let gridCols = 0;
let gridRows = 0;
let adjacency = null;

export function closestOnSegment([px, py], [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}

export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let loading = null;

export function loadMap() {
  if (!loading) {
    loading = fetch('/baku.json')
      .then((r) => {
        if (!r.ok) throw new Error('Xəritə yüklənmədi');
        return r.json();
      })
      .then((data) => {
        init(data);
        return data;
      });
  }
  return loading;
}

function init(data) {
  DATA = data;
  [W, H] = data.size;
  const nodes = data.roads.nodes;

  SEGMENTS = [];
  adjacency = nodes.map(() => []);
  for (const way of data.roads.ways) {
    for (let i = 1; i < way.p.length; i++) {
      const ia = way.p[i - 1];
      const ib = way.p[i];
      const a = nodes[ia];
      const b = nodes[ib];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len) continue;
      // [a, b] massivi + əlavə sahələr (closestOnSegment massiv gözləyir)
      SEGMENTS.push(Object.assign([a, b], { ia, ib, c: way.c, len, half: ROAD_WIDTHS[way.c] / 2 }));
      adjacency[ia].push([ib, len]);
      adjacency[ib].push([ia, len]);
    }
  }

  // seqmentləri 50 m-lik xanalara yığırıq ki, ən yaxın yolu tez tapaq
  gridCols = Math.ceil(W / CELL) + 1;
  gridRows = Math.ceil(H / CELL) + 1;
  grid = new Array(gridCols * gridRows);
  SEGMENTS.forEach((s, idx) => {
    const pad = s.half + 5;
    const x0 = Math.max(0, Math.floor((Math.min(s[0][0], s[1][0]) - pad) / CELL));
    const x1 = Math.min(gridCols - 1, Math.floor((Math.max(s[0][0], s[1][0]) + pad) / CELL));
    const y0 = Math.max(0, Math.floor((Math.min(s[0][1], s[1][1]) - pad) / CELL));
    const y1 = Math.min(gridRows - 1, Math.floor((Math.max(s[0][1], s[1][1]) + pad) / CELL));
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) (grid[gy * gridCols + gx] ||= []).push(idx);
  });

  for (const [id, place] of Object.entries(PLACES)) {
    const n = nearestOnRoad(place.pos);
    place.stop = [n.x, n.y];
    // modeli yola çox yaxın olan məkanları yoldan kənara itələyirik
    const fp = FOOTPRINT[id];
    const need = n.seg.half + (fp || 0) + 3;
    if (fp && n.d < need) {
      let dx = place.pos[0] - n.x;
      let dy = place.pos[1] - n.y;
      let len = Math.hypot(dx, dy);
      if (len < 0.5) {
        // yolun tam üstündədirsə, yola perpendikulyar istiqamət
        const [a, b] = [n.seg[0], n.seg[1]];
        dx = -(b[1] - a[1]);
        dy = b[0] - a[0];
        len = Math.hypot(dx, dy);
      }
      place.pos = [n.x + (dx / len) * need, n.y + (dy / len) * need];
    }
  }
}

export function nearestOnRoad(p) {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  let best = null;
  for (let r = 0; r < 60; r++) {
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        if (r && gx > cx - r && gx < cx + r && gy > cy - r && gy < cy + r) continue; // yalnız halqa
        if (gx < 0 || gy < 0 || gx >= gridCols || gy >= gridRows) continue;
        const cell = grid[gy * gridCols + gx];
        if (!cell) continue;
        for (const idx of cell) {
          const s = SEGMENTS[idx];
          const c = closestOnSegment(p, s);
          if (!best || c.d < best.d) best = { ...c, seg: s };
        }
      }
    }
    if (best && best.d < r * CELL) break;
  }
  return best;
}

// ---------- GPS: Dijkstra (binary heap) ----------
class Heap {
  constructor() {
    this.a = [];
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export function route(from, to) {
  const a = nearestOnRoad(from);
  const b = nearestOnRoad(to);
  if (!a || !b) return { path: [], length: 0 };
  const nodes = DATA.roads.nodes;
  const start = [a.x, a.y];
  const goal = [b.x, b.y];
  if (a.seg === b.seg) return { path: [start, goal], length: Math.hypot(goal[0] - start[0], goal[1] - start[1]) };

  const dist = new Map();
  const prev = new Map();
  const heap = new Heap();
  for (const [i, t] of [
    [a.seg.ia, a.t],
    [a.seg.ib, 1 - a.t],
  ]) {
    const d = t * a.seg.len;
    if (d < (dist.get(i) ?? Infinity)) {
      dist.set(i, d);
      heap.push([d, i]);
    }
  }
  const goalCost = new Map([
    [b.seg.ia, b.t * b.seg.len],
    [b.seg.ib, (1 - b.t) * b.seg.len],
  ]);
  let bestLen = Infinity;
  let bestEnd = null;
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (d >= bestLen) break;
    if (goalCost.has(u) && d + goalCost.get(u) < bestLen) {
      bestLen = d + goalCost.get(u);
      bestEnd = u;
    }
    for (const [v, w] of adjacency[u]) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        heap.push([nd, v]);
      }
    }
  }
  if (bestEnd === null) return { path: [], length: 0 };
  const path = [goal];
  for (let k = bestEnd; k !== undefined; k = prev.get(k)) path.unshift(nodes[k]);
  path.unshift(start);
  return { path, length: bestLen };
}
