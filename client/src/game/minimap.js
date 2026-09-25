import { DATA, W, H } from './map.js';

const SCALE = 0.25; // piksel / metr (fon şəkli üçün)

// bütün xəritənin fon şəkli; hər kadrda maşının ətrafı buradan kəsilir
export function buildMinimap() {
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * SCALE);
  c.height = Math.ceil(H * SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#1d1929';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d2340';
  ctx.beginPath();
  DATA.sea.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const nodes = DATA.roads.nodes;
  for (const [cls, color, width] of [
    [[3, 4], '#3d3850', 10],
    [[0, 1, 2], '#6a6384', 22],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const w of DATA.roads.ways) {
      if (!cls.includes(w.c)) continue;
      w.p.forEach((i, k) => (k ? ctx.lineTo(...nodes[i]) : ctx.moveTo(...nodes[i])));
    }
    ctx.stroke();
  }
  return c;
}

// maşın mərkəzdə, ətrafında `range` metrlik sahə
export function drawMinimap(ctx, layer, size, car, target, route, range = 700) {
  const s = size * 2; // retina
  const k = s / range;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d1929';
  ctx.fillRect(0, 0, s, s);
  const sx = (car.x - range / 2) * SCALE;
  const sy = (car.y - range / 2) * SCALE;
  ctx.drawImage(layer, sx, sy, range * SCALE, range * SCALE, 0, 0, s, s);
  const toMini = ([x, y]) => [(x - car.x) * k + s / 2, (y - car.y) * k + s / 2];

  if (route?.length > 1) {
    ctx.strokeStyle = '#ffc93c';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    route.forEach((p, i) => (i ? ctx.lineTo(...toMini(p)) : ctx.moveTo(...toMini(p))));
    ctx.stroke();
  }
  if (target) {
    let [tx, ty] = toMini(target);
    const inside = tx > 8 && tx < s - 8 && ty > 8 && ty < s - 8;
    if (!inside) {
      // kənarda ox kimi göstər
      const a = Math.atan2(ty - s / 2, tx - s / 2);
      tx = s / 2 + Math.cos(a) * (s / 2 - 12);
      ty = s / 2 + Math.sin(a) * (s / 2 - 12);
    }
    ctx.fillStyle = '#ff4f9a';
    ctx.beginPath();
    ctx.arc(tx, ty, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(car.a);
  ctx.fillStyle = '#ffc93c';
  ctx.strokeStyle = '#1a1300';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-8, -8);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
