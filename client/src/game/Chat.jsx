import { useEffect, useRef, useState } from 'react';
import DatePicker from '../components/DatePicker.jsx';
import { prettyDate } from '../options.js';

export function Avatar({ c, size = 40 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {c.avatar ? <img src={c.avatar} alt="" /> : c.avatarEmoji || '🙂'}
    </span>
  );
}

const isQuestion = (m) => m.type !== 'say';

// Gələn mesajları bir-bir "yazır...", suallarda cavab gözləyir.
export default function Chat({ c, game, maxDays, onFinish, sending, error }) {
  const [shown, setShown] = useState([]); // [{from:'him'|'her', text}]
  const [idx, setIdx] = useState(0);
  const [typing, setTyping] = useState(false);
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const answers = useRef({ answers: [], date: null, time: null });
  const bodyRef = useRef(null);

  const messages = c.messages;
  const current = messages[idx];
  const waiting = Boolean(current && isQuestion(current) && !typing && shown.at(-1)?.msgIdx === idx);
  const finished = idx >= messages.length;

  // növbəti mesajı "yazır..." effekti ilə göstər
  useEffect(() => {
    if (finished || shown.some((m) => m.msgIdx === idx)) return;
    setTyping(true);
    const t = setTimeout(
      () => {
        setTyping(false);
        setShown((s) => [...s, { from: 'him', text: current.text, msgIdx: idx }]);
        if (!isQuestion(current)) setIdx((i) => i + 1);
      },
      650 + Math.min(900, current.text.length * 12),
    );
    return () => clearTimeout(t);
  }, [idx, finished, current, shown]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [shown, typing, idx]);

  const reply = (display, value) => {
    answers.current.answers.push({ q: current.text, a: value });
    setShown((s) => [...s, { from: 'her', text: display }]);
    setPicked([]);
    setText('');
    setIdx((i) => i + 1);
  };

  const sendDate = () => {
    answers.current.date = date;
    answers.current.time = time;
    reply(`📅 ${prettyDate(date)}, ${time}`, `${date} ${time}`);
  };

  return (
    <div className="chat-sheet slide-up">
      <div className="chat-head">
        <Avatar c={game} size={40} />
        <div>
          <div className="chat-name">{c.title}</div>
          <div className="chat-status">{typing ? c.typing : c.status}</div>
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {shown.map((m, i) => (
          <div key={i} className={`bubble-row ${m.from}`}>
            {m.from === 'him' && <Avatar c={game} size={28} />}
            <div className={`bubble ${m.from}`}>{m.text}</div>
          </div>
        ))}
        {typing && (
          <div className="bubble-row him">
            <Avatar c={game} size={28} />
            <div className="bubble him typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <div className="chat-input">
        {waiting && (current.type === 'single' || current.type === 'multi') && (
          <>
            <div className="chip-wrap">
              {current.options.map((o) => {
                const active = picked.includes(o);
                return (
                  <button
                    key={o}
                    className={`chip ${active ? 'active' : ''}`}
                    onClick={() =>
                      current.type === 'single'
                        ? reply(o, o)
                        : setPicked(active ? picked.filter((x) => x !== o) : [...picked, o])
                    }
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            {current.type === 'multi' && (
              <button
                className="btn btn-primary btn-block"
                disabled={!picked.length}
                onClick={() => reply(picked.join(', '), picked)}
              >
                {c.sendButton}
              </button>
            )}
          </>
        )}

        {waiting && current.type === 'date' && (
          <>
            <DatePicker
              maxDays={maxDays}
              times={current.options.length ? current.options : ['19:00']}
              date={date}
              time={time}
              onDate={setDate}
              onTime={setTime}
            />
            <button className="btn btn-primary btn-block" disabled={!date || !time} onClick={sendDate}>
              {c.sendButton}
            </button>
          </>
        )}

        {waiting && current.type === 'text' && (
          <form
            className="chat-text"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) reply(text.trim(), text.trim());
            }}
          >
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              placeholder={c.textPlaceholder}
            />
            <button className="btn btn-primary" disabled={!text.trim()}>
              ➤
            </button>
            {current.optional && (
              <button type="button" className="btn btn-ghost" onClick={() => reply(c.skipButton, '')}>
                {c.skipButton}
              </button>
            )}
          </form>
        )}

        {finished && (
          <>
            {error && <p className="error">⚠️ {error}</p>}
            <button className="btn btn-yes btn-block" disabled={sending} onClick={() => onFinish(answers.current)}>
              {sending ? '...' : c.finishButton}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
