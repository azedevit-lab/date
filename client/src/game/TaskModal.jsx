import { useMemo, useState } from 'react';

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Yaddaş oyunu: eyni emojiləri cüt-cüt tap
function Memory({ symbols, onWin }) {
  const cards = useMemo(() => shuffle([...symbols, ...symbols]).map((s, i) => ({ s, i })), [symbols]);
  const [open, setOpen] = useState([]);
  const [matched, setMatched] = useState([]);

  const flip = (i) => {
    if (open.length === 2 || open.includes(i) || matched.includes(i)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      const [a, b] = next;
      if (cards[a].s === cards[b].s) {
        const m = [...matched, a, b];
        setMatched(m);
        setOpen([]);
        if (m.length === cards.length) setTimeout(onWin, 400);
      } else {
        setTimeout(() => setOpen([]), 700);
      }
    }
  };

  return (
    <div className="memory-grid">
      {cards.map((c, i) => {
        const shown = open.includes(i) || matched.includes(i);
        return (
          <button
            key={i}
            className={`memory-card ${shown ? 'shown' : ''} ${matched.includes(i) ? 'matched' : ''}`}
            onClick={() => flip(i)}
          >
            <span>{shown ? c.s : '?'}</span>
          </button>
        );
      })}
    </div>
  );
}

// Şəkil tapmacası: fırlanmış parçalara toxunub düz vəziyyətə gətir
function PhotoPuzzle({ photo, onWin }) {
  const N = 3;
  const [rot, setRot] = useState(() => {
    const r = Array.from({ length: N * N }, () => [0, 90, 180, 270][Math.floor(Math.random() * 4)]);
    if (r.every((x) => x === 0)) r[4] = 90;
    return r;
  });
  const [won, setWon] = useState(false);

  const turn = (i) => {
    if (won) return;
    const next = rot.map((r, j) => (j === i ? r + 90 : r));
    setRot(next);
    if (next.every((r) => r % 360 === 0)) {
      setWon(true);
      setTimeout(onWin, 500);
    }
  };

  return (
    <div className={`photo-puzzle ${won ? 'won' : ''}`}>
      {rot.map((r, i) => (
        <button
          key={i}
          className="puzzle-tile"
          onClick={() => turn(i)}
          style={{
            backgroundImage: `url(${photo})`,
            backgroundSize: `${N * 100}% ${N * 100}%`,
            backgroundPosition: `${((i % N) / (N - 1)) * 100}% ${(Math.floor(i / N) / (N - 1)) * 100}%`,
            transform: `rotate(${r}deg)`,
          }}
          aria-label="Parçanı fırlat"
        />
      ))}
    </div>
  );
}

export default function TaskModal({ stop, c, onDone }) {
  // dayanacağın öz şəkli varsa onu, yoxsa ümumi şəkli istifadə edirik
  const photo = stop.image || c.herPhoto || c.avatar;
  const instant = stop.type === 'info' || stop.type === 'photo' || (stop.type === 'photoPuzzle' && !photo);
  const [done, setDone] = useState(instant);
  const [wrong, setWrong] = useState(false);
  const [taps, setTaps] = useState(0);
  const [answer, setAnswer] = useState('');

  const fail = () => {
    setWrong(true);
    setTimeout(() => setWrong(false), 1600);
  };

  const pick = (i) => (i === Number(stop.correct) ? setDone(true) : fail());

  const checkText = (e) => {
    e.preventDefault();
    const norm = (s) => s.trim().toLocaleLowerCase('az');
    norm(answer) === norm(stop.answer || '') ? setDone(true) : fail();
  };

  const tap = () => {
    const n = taps + 1;
    setTaps(n);
    navigator.vibrate?.(15);
    if (n >= Number(stop.taps || 1)) setDone(true);
  };

  const symbols = (stop.options?.length ? stop.options : ['☕', '🍕', '🎬', '🌊']).slice(0, 8);
  const onlyButton = stop.type === 'info' || stop.type === 'photo';

  return (
    <div className="overlay soft">
      <div className={`card task-card pop-in ${wrong ? 'shake' : ''}`}>
        <div className="badge">
          {stop.placeEmoji} {stop.placeName}
        </div>
        {stop.title && <h2>{stop.title}</h2>}

        {stop.type === 'photo' && photo && (
          <div className="framed-photo">
            <img src={photo} alt="" />
          </div>
        )}

        {stop.text && <p className="task-text">{stop.text}</p>}

        {!done && stop.type === 'quiz' && (
          <div className="quiz-options">
            {(stop.options || []).map((o, i) => (
              <button key={i} className="btn btn-ghost quiz-option" onClick={() => pick(i)}>
                {o}
              </button>
            ))}
          </div>
        )}

        {!done && stop.type === 'text' && (
          <form className="pw-form" onSubmit={checkText}>
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" />
            <button className="btn btn-primary">{stop.button || 'OK'}</button>
          </form>
        )}

        {!done && stop.type === 'tap' && (
          <div className="tap-task">
            <div className="tap-bar">
              <div style={{ width: `${(taps / Number(stop.taps || 1)) * 100}%` }} />
            </div>
            <button className="btn btn-primary btn-lg tap-btn" onClick={tap}>
              {stop.button || 'Bas!'}
            </button>
          </div>
        )}

        {!done && stop.type === 'memory' && <Memory symbols={symbols} onWin={() => setDone(true)} />}

        {!done && stop.type === 'photoPuzzle' && <PhotoPuzzle photo={photo} onWin={() => setDone(true)} />}

        {wrong && <p className="hint">{c.wrongAnswer}</p>}

        {done && (
          <div className="slide-up">
            {stop.type === 'photoPuzzle' && photo && (
              <div className="framed-photo small">
                <img src={photo} alt="" />
              </div>
            )}
            {stop.success && <p className="ok-text task-success">{stop.success}</p>}
            <button className="btn btn-primary btn-block" onClick={onDone}>
              {onlyButton && stop.button ? stop.button : c.continueButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
