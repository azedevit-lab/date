import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';

const PORT = Number(process.env.PORT || 3001);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_DIR = path.resolve(path.dirname(process.env.DB_PATH || 'data/app.db'), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
};

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD env dəyişəni təyin edilməyib (minimum 8 simvol).');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
const smallJson = express.json({ limit: '20kb' });
// məzmun redaktoru daha böyük JSON göndərir, ona öz limiti var
app.use((req, res, next) => (req.path === '/api/admin/content' ? next() : smallJson(req, res, next)));

// --- security headers (o, pentesterdir — başlıqlara baxacaq 😏) ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  res.setHeader('X-Hint', 'No vulns here. Look for the "Yes" button instead ;)');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// --- tiny in-memory rate limiter ---
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Yavaş-yavaş, hacker 🐢 Bir az sonra yenə cəhd et.' });
    }
    next();
  };
}

const apiLimiter = rateLimit({ windowMs: 60_000, max: 120 });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10 });
app.use('/api', apiLimiter);

// --- admin session (HMAC-signed cookie) ---
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAdmin(req) {
  const raw = getCookie(req, 'adm');
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig) return false;
  if (!safeEqual(sign(`admin:${exp}`), sig)) return false;
  return Number(exp) > Date.now();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function setSessionCookie(res, value, maxAgeMs) {
  const parts = [
    `adm=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (IS_PROD && process.env.INSECURE_COOKIE !== '1') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// --- helpers ---
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const newToken = () => crypto.randomBytes(12).toString('base64url');

function strList(v, maxItems = 30, maxLen = 120) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseJSON(v) {
  try {
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

function parseObj(v) {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function toAdminInvite(row) {
  return {
    ...row,
    foods: parseJSON(row.foods),
    activities: parseJSON(row.activities),
    answers: parseJSON(row.answers),
    stats: parseObj(row.stats),
  };
}

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');

function loadContent() {
  const row = getSetting.get('content');
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function toPublicInvite(row) {
  return {
    content: loadContent(),
    name: row.name,
    fromName: row.from_name,
    message: row.message,
    maxDays: row.max_days,
    arrived: !!row.puzzle_at,
    completed: !!row.completed_at,
    stats: parseObj(row.stats),
    result: row.completed_at ? { answers: parseJSON(row.answers), date: row.date, time: row.time } : null,
  };
}

const getByToken = db.prepare('SELECT * FROM invites WHERE token = ?');

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// --- admin routes ---
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Şifrə yanlışdır' });
  }
  const exp = String(Date.now() + SESSION_TTL_MS);
  setSessionCookie(res, `${exp}.${sign(`admin:${exp}`)}`, SESSION_TTL_MS);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.get('/api/admin/invites', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM invites ORDER BY id DESC').all();
  res.json(rows.map(toAdminInvite));
});

app.post('/api/admin/invites', requireAdmin, (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Ad lazımdır' });
  const fromName = str(req.body?.fromName, 60) || null;
  const message = str(req.body?.message, 500) || null;
  const maxDays = Math.min(31, Math.max(1, Number.parseInt(req.body?.maxDays, 10) || 14));
  const token = newToken();
  db.prepare('INSERT INTO invites (token, name, from_name, message, max_days) VALUES (?, ?, ?, ?, ?)').run(
    token,
    name,
    fromName,
    message,
    maxDays,
  );
  res.status(201).json(toAdminInvite(getByToken.get(token)));
});

app.get('/api/admin/content', requireAdmin, (req, res) => res.json({ content: loadContent() }));

app.put('/api/admin/content', requireAdmin, express.json({ limit: '600kb' }), (req, res) => {
  const content = req.body?.content;
  if (content === null) {
    db.prepare("DELETE FROM settings WHERE key = 'content'").run();
    return res.json({ ok: true });
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return res.status(400).json({ error: 'Yanlış format' });
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('content', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(content));
  res.json({ ok: true });
});

// mahnı yükləmə (xam fayl gövdəsi)
app.post(
  '/api/admin/upload',
  requireAdmin,
  express.raw({ type: Object.keys(AUDIO_TYPES), limit: '25mb' }),
  (req, res) => {
    const ext = AUDIO_TYPES[(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Yalnız mp3, m4a, aac, ogg, wav faylları' });
    }
    const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    res.status(201).json({ url: `/uploads/${name}` });
  },
);

app.post('/api/admin/invites/:id/reset', requireAdmin, (req, res) => {
  db.prepare(
    `UPDATE invites SET opened_at = NULL, open_count = 0, accepted_at = NULL, no_attempts = 0, puzzle_at = NULL,
     foods = NULL, activities = NULL, date = NULL, time = NULL, note = NULL, answers = NULL, stats = NULL,
     completed_at = NULL WHERE id = ?`,
  ).run(Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/admin/invites/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM invites WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- public invite routes ---
app.get('/api/invite/:token', (req, res) => {
  const row = getByToken.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'not found' });
  // admin preview-ləri saymırıq
  if (!isAdmin(req)) {
    db.prepare(
      "UPDATE invites SET open_count = open_count + 1, opened_at = COALESCE(opened_at, datetime('now')) WHERE id = ?",
    ).run(row.id);
  }
  res.json(toPublicInvite(row));
});

// oyuna başladı (sifarişi qəbul etdi)
app.post('/api/invite/:token/start', (req, res) => {
  const row = getByToken.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE invites SET accepted_at = COALESCE(accepted_at, datetime('now')) WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// son ünvana çatdı
app.post('/api/invite/:token/arrive', (req, res) => {
  const row = getByToken.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'not found' });
  const num = (v, max) => Math.min(max, Math.max(0, Number(v) || 0));
  const stats = {
    seconds: Math.round(num(req.body?.seconds, 86_400)),
    stars: Math.round(num(req.body?.stars, 1000)),
    km: +num(req.body?.km, 1000).toFixed(1),
  };
  db.prepare(
    "UPDATE invites SET puzzle_at = COALESCE(puzzle_at, datetime('now')), stats = COALESCE(stats, ?) WHERE id = ?",
  ).run(JSON.stringify(stats), row.id);
  res.json({ ok: true });
});

app.post('/api/invite/:token/submit', (req, res) => {
  const row = getByToken.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'not found' });

  const raw = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 30) : [];
  const answers = raw
    .filter((x) => x && typeof x.q === 'string')
    .map((x) => ({ q: str(x.q, 300), a: Array.isArray(x.a) ? strList(x.a) : str(x.a, 500) }));

  const date = str(req.body?.date, 10) || null;
  const time = str(req.body?.time, 5) || null;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Tarix düzgün deyil' });
    if (time && !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Saat düzgün deyil' });
    // bir gün tolerans — saat qurşaqlarına görə
    const min = new Date(Date.now() - 86_400_000);
    const max = new Date(Date.now() + (row.max_days + 1) * 86_400_000);
    if (date < isoDay(min) || date > isoDay(max)) return res.status(400).json({ error: 'Bu tarix seçilə bilməz' });
  }

  db.prepare(
    `UPDATE invites SET answers = ?, date = ?, time = ?, completed_at = datetime('now'),
     accepted_at = COALESCE(accepted_at, datetime('now')), puzzle_at = COALESCE(puzzle_at, datetime('now')) WHERE id = ?`,
  ).run(JSON.stringify(answers), date, time, row.id);
  res.json({ ok: true });
});

// easter egg: "No" endpoint-i
app.all('/api/no', (req, res) => {
  res.status(418).json({
    status: 418,
    error: "I'm a teapot",
    message: '"No" bu serverdə implement olunmayıb. Amma çay içməyə gedə bilərik ☕',
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// yüklənmiş mahnılar
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', fallthrough: false }));

// --- static frontend ---
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad json' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Fayl çox böyükdür' });
  if (err?.status === 404) return res.status(404).json({ error: 'not found' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

// HOST=127.0.0.1 — yalnız reverse proxy (Caddy) vasitəsilə əlçatan olsun
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`🚀 http://${HOST}:${PORT}`));
