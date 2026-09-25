import * as THREE from 'three';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// bina fasadı: qaranlıq divar + təsadüfi yanan pəncərələr
export function windowsTexture(seed = 1) {
  let s = seed * 9301;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2a2638';
    ctx.fillRect(0, 0, w, h);
    const cols = 4;
    const rows = 10;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const lit = r() < 0.45;
        const warm = r() < 0.75;
        ctx.fillStyle = lit ? (warm ? `hsl(${38 + r() * 10}, 90%, ${60 + r() * 20}%)` : '#bcd4ff') : '#15131d';
        ctx.fillRect(8 + i * 30, 10 + j * 24, 18, 14);
      }
    }
  });
}

export function glowTexture(inner = 'rgba(255,255,255,1)') {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

// yuxarıdan aşağı şəffaflaşan şüa (hədəf nöqtəsi üçün)
export function beamTexture() {
  return canvasTexture(4, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function labelTexture(text, highlight = false) {
  const font = '800 44px Nunito, sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const tw = Math.ceil(measure.measureText(text).width);
  const w = tw + 56;
  const h = 76;
  const tex = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = highlight ? 'rgba(255, 201, 60, 0.95)' : 'rgba(18, 14, 28, 0.82)';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 36);
    ctx.fill();
    ctx.strokeStyle = highlight ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = highlight ? '#1a1300' : '#f4eefb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
  tex.aspect = w / h;
  return tex;
}

export function avatarTexture(img, emoji, name) {
  const w = 256;
  const h = name ? 330 : 256;
  const tex = canvasTexture(w, h, (ctx) => {
    const R = 110;
    const cx = w / 2;
    const cy = 128;
    ctx.fillStyle = '#ffc93c';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2b2238';
    ctx.fillRect(0, 0, w, w);
    if (img) {
      const s = Math.max((R * 2) / img.width, (R * 2) / img.height);
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.font = '130px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji || '🙂', cx, cy + 8);
    }
    ctx.restore();
    if (name) {
      ctx.font = '800 40px Nunito, sans-serif';
      const tw = ctx.measureText(name).width + 40;
      ctx.fillStyle = 'rgba(18, 14, 28, 0.9)';
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, 262, tw, 60, 30);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, cx, 293);
    }
  });
  tex.aspect = w / h;
  return tex;
}
