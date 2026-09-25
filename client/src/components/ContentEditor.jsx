import { useEffect, useState } from 'react';
import { api, uploadAudio } from '../api.js';
import { DEFAULT_CONTENT, MESSAGE_TYPES, TASK_TYPES, mergeContent } from '../content.js';
import { PLACES } from '../game/map.js';

const PLACE_OPTIONS = Object.fromEntries(Object.entries(PLACES).map(([id, p]) => [id, `${p.emoji} ${p.name}`]));

const SECTIONS = [
  {
    title: '🙂 Sənin ikonun',
    fields: [
      { path: 'game.avatar', label: 'Şəkil (xəritədə və çatda görünür)', type: 'avatar' },
      { path: 'game.avatarEmoji', label: 'Şəkil yoxdursa emoji' },
    ],
  },
  {
    title: '🖼️ Onun şəkli',
    fields: [
      {
        path: 'game.herPhoto',
        label: 'Gözəllik sərgisində və şəkil tapmacasında görünür',
        type: 'photo',
      },
    ],
  },
  {
    title: '🎵 Musiqi',
    fields: [
      { path: 'game.music', label: 'Məkan mahnıları — yaxınlaşanda çalır, uzaqlaşanda dayanır', type: 'music' },
      { path: 'game.radio.name', label: 'Radio stansiyasının adı' },
      { path: 'game.radio.tracks', label: 'Radio — mahnılar növbə ilə çalır, sürücü dəyişə bilir', type: 'tracks' },
      {
        path: 'game.radio.voices',
        label: 'Səs mesajların — mahnıların arasında bir-bir çalınır (m4a, mp3, ogg)',
        type: 'tracks',
      },
      { path: 'game.radio.volume', label: 'Radionun səsi', type: 'volume' },
    ],
  },
  {
    title: '🪧 Bilbordlar',
    fields: [
      {
        path: 'game.billboards',
        label: 'Onun marşrutu üzərində, yolun üstündən keçən lövhələr — sıra ilə görünür',
        type: 'billboards',
      },
    ],
  },
  {
    title: '1. Giriş',
    fields: [
      { path: 'intro.badge', label: 'Kiçik etiket' },
      { path: 'intro.title', label: 'Başlıq', type: 'area' },
      { path: 'intro.text', label: 'Mətn', type: 'area' },
      { path: 'intro.button', label: 'Düymə' },
    ],
  },
  {
    title: '2. Oyun və xəritə',
    fields: [
      { path: 'game.carColor', label: 'Maşının rəngi', type: 'color' },
      {
        path: 'game.maxSpeed',
        label: 'Maşının maksimum sürəti (km/saat)',
        type: 'number',
        min: 60,
        max: 300,
        step: 10,
      },
      { path: 'game.carVolume', label: 'Maşın səsləri (mühərrik, əyləc, siqnal)', type: 'volume' },
      { path: 'game.start', label: 'Başlanğıc nöqtəsi', type: 'select', options: PLACE_OPTIONS },
      { path: 'game.destination', label: 'Son ünvan (sənin yanın)', type: 'select', options: PLACE_OPTIONS },
      { path: 'game.finalName', label: 'Son ünvanın göstərilən adı', help: 'Boş qalsa məkanın adı görünür' },
      { path: 'game.tutorialTitle', label: 'Təlimat başlığı' },
      { path: 'game.tutorialText', label: 'Təlimat mətni', type: 'area' },
      { path: 'game.tutorialButton', label: 'Təlimat düyməsi' },
      { path: 'game.driveHint', label: 'İlk hərəkətə qədər görünən ipucu' },
      { path: 'game.nextLabel', label: '"Növbəti dayanacaq" yazısı' },
      { path: 'game.finalLabel', label: '"Son ünvan" yazısı' },
      { path: 'game.wrongAnswer', label: 'Səhv cavab mesajı' },
      { path: 'game.continueButton', label: 'Tapşırıqdan sonra düymə' },
    ],
  },
  {
    title: '3. Yoldakı dayanacaqlar',
    fields: [{ path: 'game.stops', label: 'Dayanacaqlar (sırası ilə)', type: 'stops' }],
  },
  {
    title: '4. Çat (çatanda)',
    fields: [
      { path: 'chat.messages', label: 'Mesajlar və suallar (sırası ilə)', type: 'messages' },
      { path: 'chat.title', label: 'Çatda ad' },
      { path: 'chat.status', label: 'Status (məs. onlayn)' },
      { path: 'chat.typing', label: '"yazır..." yazısı' },
      { path: 'chat.sendButton', label: '"Göndər" düyməsi' },
      { path: 'chat.skipButton', label: '"Keç" düyməsi' },
      { path: 'chat.textPlaceholder', label: 'Yazı sahəsinin içindəki yazı' },
      { path: 'chat.finishButton', label: 'Sonda düymə' },
    ],
  },
  {
    title: '5. Date kartı (son səhifə)',
    fields: [
      { path: 'final.badge', label: 'Kiçik etiket' },
      { path: 'final.title', label: 'Başlıq' },
      { path: 'final.subtitle', label: 'Alt yazı', type: 'area' },
      { path: 'final.choicesTitle', label: '"Sənin seçimlərin" başlığı' },
      {
        path: 'final.starsText',
        label: 'Ulduz sətri',
        help: '{ulduz} yerinə topladığı ulduz sayı yazılır. Boş qoysan görünmür',
      },
      { path: 'final.message', label: 'Sənin son mesajın', type: 'area' },
      { path: 'final.calendarTitle', label: 'Təqvimdə hadisənin adı' },
      { path: 'final.calendarButton', label: 'Təqvim düyməsi' },
      { path: 'final.editButton', label: '"Dəyiş" düyməsi' },
    ],
  },
];

const NEW_STOP = {
  place: 'nizami',
  type: 'quiz',
  title: '',
  text: '',
  options: [],
  correct: 0,
  answer: '',
  taps: 10,
  button: '',
  success: '',
};
const NEW_MESSAGE = { type: 'say', text: '', options: [], optional: false };
const NEW_TRACK = { place: 'gallery', url: '', name: '', radius: 250, volume: 1 };
const RADIUS_OPTIONS = { 150: 'Yaxın (~400 m)', 250: 'Orta (~600 m)', 400: 'Uzaq (~1 km)' };

const getAt = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function setAt(obj, path, value) {
  const [head, ...rest] = path.split('.');
  return { ...obj, [head]: rest.length ? setAt(obj[head], rest.join('.'), value) : value };
}

function LinesField({ value, onChange }) {
  const [text, setText] = useState((value || []).join('\n'));
  return (
    <textarea
      className="input"
      rows={Math.min(10, Math.max(3, (value || []).length + 1))}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split('\n').filter((l) => l.trim()));
      }}
    />
  );
}

function Select({ value, options, onChange }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(options).map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

function AvatarField({ value, onChange, size = 192 }) {
  const upload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      // kvadrat kəsib kiçildirik ki, baza yüngül qalsın
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      onChange(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  return (
    <div className="avatar-field">
      <span className="avatar" style={{ width: 64, height: 64, fontSize: 30 }}>
        {value ? <img src={value} alt="" /> : '📷'}
      </span>
      <label className="btn btn-ghost btn-sm">
        Şəkil seç
        <input type="file" accept="image/*" hidden onChange={upload} />
      </label>
      {value && (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange('')}>
          Sil
        </button>
      )}
    </div>
  );
}

function AudioUpload({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadAudio(file);
      onChange({ ...value, url, name: file.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="audio-field">
      {value.url && <audio controls src={value.url} preload="none" />}
      <div className="avatar-field">
        <label className="btn btn-ghost btn-sm">
          {busy ? 'Yüklənir...' : value.url ? 'Başqa mahnı seç' : '🎵 Mahnı seç'}
          <input type="file" accept="audio/*" hidden onChange={pick} disabled={busy} />
        </label>
        {value.url && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => onChange({ ...value, url: '', name: '' })}
          >
            Sil
          </button>
        )}
        {value.name && <span className="small muted">{value.name}</span>}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function VolumeField({ value, onChange }) {
  return (
    <input
      type="range"
      className="volume"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function TrackItem({ item, set }) {
  return (
    <>
      <Sub label="Məkan">
        <Select value={item.place} options={PLACE_OPTIONS} onChange={(v) => set({ place: v })} />
      </Sub>
      <div className="field sub-field">
        <span>Mahnı</span>
        <AudioUpload value={item} onChange={(v) => set(v)} />
      </div>
      <Sub label="Nə qədər uzaqdan eşidilsin">
        <Select value={String(item.radius)} options={RADIUS_OPTIONS} onChange={(v) => set({ radius: Number(v) })} />
      </Sub>
      <Sub label={`Səs: ${Math.round(item.volume * 100)}%`}>
        <VolumeField value={item.volume} onChange={(v) => set({ volume: v })} />
      </Sub>
    </>
  );
}

// sıralana bilən siyahı (dayanacaqlar və mesajlar üçün)
function ListField({ value, onChange, template, addLabel, renderItem }) {
  const [rev, setRev] = useState(0);
  const update = (i, patch) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const reorder = (next) => {
    onChange(next);
    setRev((r) => r + 1);
  };
  const move = (i, d) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    reorder(next);
  };

  return (
    <div className="opt-list">
      {value.map((item, i) => (
        <div key={`${rev}-${i}`} className="list-item">
          <div className="list-item-head">
            <b>#{i + 1}</b>
            <div className="opt-btns">
              <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={i === value.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => reorder(value.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          </div>
          {renderItem(item, (patch) => update(i, patch))}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...value, structuredClone(template)])}
      >
        {addLabel}
      </button>
    </div>
  );
}

function Sub({ label, children, help }) {
  return (
    <label className="field sub-field">
      <span>{label}</span>
      {children}
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

function StopItem({ item, set }) {
  const opts = item.options || [];
  return (
    <>
      <Sub label="Məkan">
        <Select value={item.place} options={PLACE_OPTIONS} onChange={(v) => set({ place: v })} />
      </Sub>
      <Sub label="Tapşırıq növü">
        <Select value={item.type} options={TASK_TYPES} onChange={(v) => set({ type: v })} />
      </Sub>
      <Sub label="Başlıq">
        <input className="input" value={item.title} onChange={(e) => set({ title: e.target.value })} />
      </Sub>
      <Sub label="Mətn / sual">
        <textarea className="input" rows={2} value={item.text} onChange={(e) => set({ text: e.target.value })} />
      </Sub>
      {item.type === 'quiz' && (
        <>
          <Sub label="Variantlar (hər sətirdə biri)">
            <LinesField value={opts} onChange={(v) => set({ options: v })} />
          </Sub>
          <Sub label="Düzgün variant">
            <Select
              value={String(item.correct)}
              options={Object.fromEntries(opts.map((o, i) => [String(i), o]))}
              onChange={(v) => set({ correct: Number(v) })}
            />
          </Sub>
        </>
      )}
      {item.type === 'text' && (
        <Sub label="Düzgün cavab" help="Böyük/kiçik hərf fərq etmir">
          <input className="input" value={item.answer} onChange={(e) => set({ answer: e.target.value })} />
        </Sub>
      )}
      {item.type === 'tap' && (
        <Sub label="Neçə dəfə basmalıdır">
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={item.taps}
            onChange={(e) => set({ taps: Number(e.target.value) })}
          />
        </Sub>
      )}
      {item.type === 'memory' && (
        <Sub label="Emojilər (hər sətirdə biri, 2–8 ədəd)" help="Boş qalsa ☕ 🍕 🎬 🌊 istifadə olunur">
          <LinesField value={item.options || []} onChange={(v) => set({ options: v })} />
        </Sub>
      )}
      {(item.type === 'photo' || item.type === 'photoPuzzle') && (
        <div className="field sub-field">
          <span>{item.type === 'photoPuzzle' ? 'Tapmaca üçün şəkil' : 'Göstəriləcək şəkil'}</span>
          <AvatarField value={item.image || ''} onChange={(v) => set({ image: v })} size={512} />
          <small className="muted">Boş qalsa "Onun şəkli" bölməsindəki şəkil istifadə olunur.</small>
        </div>
      )}
      {['text', 'tap', 'info', 'photo'].includes(item.type) && (
        <Sub label="Düymənin yazısı">
          <input className="input" value={item.button} onChange={(e) => set({ button: e.target.value })} />
        </Sub>
      )}
      <Sub label="Uğurdan sonra mesaj">
        <input className="input" value={item.success} onChange={(e) => set({ success: e.target.value })} />
      </Sub>
    </>
  );
}

function MessageItem({ item, set }) {
  return (
    <>
      <Sub label="Növ">
        <Select value={item.type} options={MESSAGE_TYPES} onChange={(v) => set({ type: v })} />
      </Sub>
      <Sub label="Mətn">
        <textarea className="input" rows={2} value={item.text} onChange={(e) => set({ text: e.target.value })} />
      </Sub>
      {(item.type === 'single' || item.type === 'multi') && (
        <Sub label="Variantlar (hər sətirdə biri)">
          <LinesField value={item.options} onChange={(v) => set({ options: v })} />
        </Sub>
      )}
      {item.type === 'date' && (
        <Sub label="Saatlar (hər sətirdə biri, məs. 19:00)">
          <LinesField value={item.options} onChange={(v) => set({ options: v })} />
        </Sub>
      )}
      {item.type === 'text' && (
        <label className="toggle-field">
          <input type="checkbox" checked={!!item.optional} onChange={(e) => set({ optional: e.target.checked })} />
          <span>Keçmək olar</span>
        </label>
      )}
    </>
  );
}

function Field({ field, value, onChange }) {
  const { type = 'text', label, help } = field;

  if (type === 'music') {
    return (
      <div className="field">
        <span>{label}</span>
        <ListField
          value={value}
          onChange={onChange}
          template={NEW_TRACK}
          addLabel="+ Mahnı əlavə et"
          renderItem={(item, set) => <TrackItem item={item} set={set} />}
        />
      </div>
    );
  }

  if (type === 'billboards') {
    return (
      <div className="field">
        <span>{label}</span>
        <ListField
          value={value}
          onChange={onChange}
          template={{ text: '', image: '' }}
          addLabel="+ Bilbord əlavə et"
          renderItem={(item, set) => (
            <>
              <Sub label="Mətn (qısa olsun)">
                <textarea
                  className="input"
                  rows={2}
                  maxLength={90}
                  value={item.text}
                  onChange={(e) => set({ text: e.target.value })}
                />
              </Sub>
              <div className="field sub-field">
                <span>Şəkil (məcburi deyil)</span>
                <AvatarField value={item.image || ''} onChange={(v) => set({ image: v })} size={384} />
              </div>
            </>
          )}
        />
      </div>
    );
  }

  if (type === 'tracks') {
    return (
      <div className="field">
        <span>{label}</span>
        <ListField
          value={value}
          onChange={onChange}
          template={{ url: '', name: '' }}
          addLabel="+ Mahnı əlavə et"
          renderItem={(item, set) => <AudioUpload value={item} onChange={(v) => set(v)} />}
        />
      </div>
    );
  }

  if (type === 'volume') {
    return (
      <div className="field">
        <span>
          {label}: {Math.round(value * 100)}%
        </span>
        <VolumeField value={value} onChange={onChange} />
      </div>
    );
  }

  if (type === 'audio') {
    return (
      <div className="field">
        <span>{label}</span>
        <AudioUpload value={value} onChange={onChange} />
        {value.url && (
          <>
            <small className="muted">Səs: {Math.round(value.volume * 100)}%</small>
            <VolumeField value={value.volume} onChange={(v) => onChange({ ...value, volume: v })} />
          </>
        )}
      </div>
    );
  }

  if (type === 'stops' || type === 'messages') {
    const isStops = type === 'stops';
    return (
      <div className="field">
        <span>{label}</span>
        <ListField
          value={value}
          onChange={onChange}
          template={isStops ? NEW_STOP : NEW_MESSAGE}
          addLabel={isStops ? '+ Dayanacaq əlavə et' : '+ Mesaj əlavə et'}
          renderItem={(item, set) =>
            isStops ? <StopItem item={item} set={set} /> : <MessageItem item={item} set={set} />
          }
        />
      </div>
    );
  }

  if (type === 'avatar' || type === 'photo') {
    return (
      <div className="field">
        <span>{label}</span>
        <AvatarField value={value} onChange={onChange} size={type === 'photo' ? 512 : 192} />
      </div>
    );
  }

  return (
    <label className="field">
      <span>{label}</span>
      {type === 'text' && <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />}
      {type === 'area' && (
        <textarea className="input" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {type === 'select' && <Select value={value} options={field.options} onChange={onChange} />}
      {type === 'number' && (
        <input
          className="input"
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      {type === 'color' && (
        <input className="input color-input" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

export default function ContentEditor({ onUnauthorized }) {
  const [content, setContent] = useState(null);
  const [version, setVersion] = useState(0); // redaktoru yenidən mount etmək üçün
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api('/admin/content')
      .then((r) => setContent(mergeContent(r.content)))
      .catch((e) => (e.status === 401 ? onUnauthorized() : setStatus(`⚠️ ${e.message}`)));
  }, [onUnauthorized]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!content) return <p className="muted center">{status || 'Yüklənir...'}</p>;

  const change = (path, value) => {
    setContent((c) => setAt(c, path, value));
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    try {
      await api('/admin/content', { method: 'PUT', body: { content } });
      setDirty(false);
      setStatus('✅ Yadda saxlanıldı');
    } catch (e) {
      if (e.status === 401) return onUnauthorized();
      setStatus(`⚠️ ${e.message}`);
    }
  };

  const reset = async () => {
    if (!confirm('Bütün mətnlər standart vəziyyətə qaytarılsın?')) return;
    await api('/admin/content', { method: 'PUT', body: { content: null } });
    setContent(structuredClone(DEFAULT_CONTENT));
    setVersion((v) => v + 1);
    setDirty(false);
    setStatus('↩️ Standart mətnlər bərpa olundu');
  };

  return (
    <div className="editor" key={version}>
      <div className="card editor-help small">
        Bu mətnlər bütün linklərə aiddir. Mətnlərdə <code>{'{ad}'}</code> (qızın adı), <code>{'{gonderen}'}</code>{' '}
        (sənin adın) və <code>{'{gun}'}</code> (neçə gün) yaza bilərsən — avtomatik əvəz olunur. Nəticəni görmək üçün
        hər hansı linkdə <b>Önizlə</b>-yə bas.
      </div>

      {SECTIONS.map((section, i) => (
        <details key={section.title} className="card editor-section" open={i === 0}>
          <summary>{section.title}</summary>
          {section.fields.map((f) => (
            <Field key={f.path} field={f} value={getAt(content, f.path)} onChange={(v) => change(f.path, v)} />
          ))}
        </details>
      ))}

      <div className="save-bar">
        <span className="small">{status || (dirty ? 'Yadda saxlanmamış dəyişikliklər var' : '')}</span>
        <div className="save-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            Standarta qaytar
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty} onClick={save}>
            Yadda saxla
          </button>
        </div>
      </div>
    </div>
  );
}
