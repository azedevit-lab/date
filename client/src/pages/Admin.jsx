import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { FOODS, ACTIVITIES, labelOf, prettyDate } from '../options.js';
import ContentEditor from '../components/ContentEditor.jsx';

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/login', { method: 'POST', body: { password } });
      onLogin();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <form className="card admin-login pop-in" onSubmit={submit}>
        <h2>🛠️ Admin</h2>
        <input
          className="input"
          type="password"
          placeholder="Şifrə"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary">Daxil ol</button>
      </form>
    </div>
  );
}

function status(inv) {
  if (inv.completed_at) return { t: 'Tamamladı 🎉', c: 'done' };
  if (inv.puzzle_at) return { t: 'Çatdı 🏁', c: 'progress' };
  if (inv.accepted_at) return { t: 'Yoldadır 🚗', c: 'progress' };
  if (inv.opened_at) return { t: 'Açıb 👀', c: 'opened' };
  return { t: 'Göndərilməyib / açılmayıb', c: 'idle' };
}

const fmt = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString() : '—');

function InviteCard({ inv, onChange }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/i/${inv.token}`;
  const st = status(inv);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Linki kopyala:', link);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = async () => {
    if (!confirm(`${inv.name} üçün cavablar silinsin?`)) return;
    await api(`/admin/invites/${inv.id}/reset`, { method: 'POST' });
    onChange();
  };

  const remove = async () => {
    if (!confirm(`${inv.name} dəvəti tamamilə silinsin? Link işləməyəcək.`)) return;
    await api(`/admin/invites/${inv.id}`, { method: 'DELETE' });
    onChange();
  };

  return (
    <div className="card invite-card">
      <div className="invite-head">
        <div>
          <h3>{inv.name}</h3>
          <div className="small muted">
            Yaradılıb: {fmt(inv.created_at)} · {inv.max_days} gün
          </div>
        </div>
        <span className={`status ${st.c}`}>{st.t}</span>
      </div>

      <div className="link-row">
        <input className="input mono small" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary btn-sm" onClick={copy}>
          {copied ? 'Kopyalandı ✓' : 'Kopyala'}
        </button>
      </div>

      <div className="stats">
        <div>
          <b>{inv.open_count}</b>
          <span>açılış</span>
        </div>
        <div>
          <b>
            {inv.stats
              ? `⭐ ${inv.stats.stars} · ${Math.floor(inv.stats.seconds / 60)}:${String(inv.stats.seconds % 60).padStart(2, '0')}`
              : '—'}
          </b>
          <span>oyun</span>
        </div>
        <div>
          <b>{fmt(inv.opened_at)}</b>
          <span>ilk açılış</span>
        </div>
      </div>

      {inv.completed_at && (
        <div className="result">
          {inv.date && (
            <div>
              📅 <b>{prettyDate(inv.date)}</b> · {inv.time}
            </div>
          )}
          {inv.answers
            .filter((a) => a.a && a.a.length && !/^\d{4}-\d{2}-\d{2} /.test(a.a))
            .map((a, i) => (
              <div key={i}>
                <span className="muted">{a.q}</span>
                <br />
                <b>{Array.isArray(a.a) ? a.a.join(', ') : a.a}</b>
              </div>
            ))}
          {inv.activities.length > 0 && <div>🗺️ {inv.activities.map((a) => labelOf(ACTIVITIES, a)).join(', ')}</div>}
          {inv.foods.length > 0 && <div>🍽️ {inv.foods.map((f) => labelOf(FOODS, f)).join(', ')}</div>}
          {inv.note && <div>📝 {inv.note}</div>}
          <div className="small muted">Göndərilib: {fmt(inv.completed_at)}</div>
        </div>
      )}

      <div className="invite-actions">
        <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer">
          Önizlə
        </a>
        <button className="btn btn-ghost btn-sm" onClick={reset}>
          Sıfırla
        </button>
        <button className="btn btn-danger btn-sm" onClick={remove}>
          Sil
        </button>
      </div>
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [invites, setInvites] = useState([]);
  const [form, setForm] = useState({ name: '', fromName: '', message: '', maxDays: 14 });
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('invites');

  const load = useCallback(() => {
    api('/admin/invites')
      .then(setInvites)
      .catch((e) => (e.status === 401 ? onLogout() : setError(e.message)));
  }, [onLogout]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/invites', { method: 'POST', body: form });
      setForm({ ...form, name: '', message: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = async () => {
    await api('/admin/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="page admin">
      <div className="admin-top">
        <h1>🛠️ Admin</h1>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          Çıxış
        </button>
      </div>

      <div className="tabs">
        <button className={tab === 'invites' ? 'active' : ''} onClick={() => setTab('invites')}>
          📨 Dəvətlər
        </button>
        <button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>
          ✏️ Mətnlər
        </button>
      </div>

      {tab === 'content' ? (
        <ContentEditor onUnauthorized={onLogout} />
      ) : (
        <>
          <form className="card admin-form" onSubmit={create}>
            <h3>Yeni link yarat</h3>
            <div className="form-grid">
              <label className="field">
                <span>Qızın adı *</span>
                <input className="input" value={form.name} onChange={set('name')} required maxLength={60} />
              </label>
              <label className="field">
                <span>Sənin adın</span>
                <input className="input" value={form.fromName} onChange={set('fromName')} maxLength={60} />
              </label>
              <label className="field">
                <span>Tarix seçimi üçün müddət</span>
                <select className="input" value={form.maxDays} onChange={set('maxDays')}>
                  <option value={7}>1 həftə</option>
                  <option value={14}>2 həftə</option>
                  <option value={21}>3 həftə</option>
                  <option value={30}>1 ay</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Şəxsi mesaj (girişdə göstərilir, məcburi deyil)</span>
              <textarea className="input" rows={2} value={form.message} onChange={set('message')} maxLength={500} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary">Link yarat ✨</button>
          </form>

          {invites.length === 0 && <p className="muted center">Hələ dəvət yoxdur.</p>}
          {invites.map((inv) => (
            <InviteCard key={inv.id} inv={inv} onChange={load} />
          ))}
        </>
      )}
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    api('/admin/me')
      .then((r) => setAuthed(r.admin))
      .catch(() => setAuthed(false));
  }, []);

  const logout = useCallback(() => setAuthed(false), []);

  if (authed === null) return <div className="page loader mono">...</div>;
  return authed ? <Dashboard onLogout={logout} /> : <Login onLogin={() => setAuthed(true)} />;
}
