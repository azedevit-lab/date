import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { MONTHS, WEEKDAYS_LONG } from '../options.js';
import { PLACES } from './map.js';
import { Avatar } from './Chat.jsx';

function downloadIcs({ title, date, time, place }) {
  const [y, m, d] = date.split('-');
  const [hh, mm] = (time || '19:00').split(':');
  const endHour = String(Math.min(23, Number(hh) + 2)).padStart(2, '0');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//date//AZ',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@date`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${y}${m}${d}T${hh}${mm}00`,
    `DTEND:${y}${m}${d}T${endHour}${mm}00`,
    `SUMMARY:${title}`,
    `LOCATION:${place}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'date.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isDateAnswer = (a) => typeof a === 'string' && /^\d{4}-\d{2}-\d{2} /.test(a);

export default function DateCard({ c, game, stats, result, onEdit }) {
  const dest = PLACES[game.destination] || PLACES.hac;
  const date = result.date ? new Date(`${result.date}T00:00:00`) : null;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const end = Date.now() + 1500;
    const colors = ['#ffc93c', '#ffffff', '#ff8c42'];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  const answers = result.answers.filter((a) => a.a && a.a.length && !isDateAnswer(a.a));

  return (
    <div className="overlay scroll soft">
      <div className="card date-card pop-in">
        {c.badge && <div className="badge">{c.badge}</div>}
        <h2 className="date-title">{c.title}</h2>
        {c.subtitle && <p className="muted">{c.subtitle}</p>}

        {date && (
          <div className="date-sheet">
            <div className="date-sheet-top">{MONTHS[date.getMonth()]}</div>
            <div className="date-sheet-day">{date.getDate()}</div>
            <div className="date-sheet-bottom">
              {WEEKDAYS_LONG[date.getDay()]}
              {result.time && <b> · {result.time}</b>}
            </div>
          </div>
        )}

        {answers.length > 0 && (
          <div className="choices">
            {c.choicesTitle && <div className="choices-title">{c.choicesTitle}</div>}
            {answers.map((a, i) => (
              <div key={i} className="choice-row">
                <span>{a.q}</span>
                <b>{Array.isArray(a.a) ? a.a.join(', ') : a.a}</b>
              </div>
            ))}
          </div>
        )}

        {stats && c.starsText && <p className="small muted center">{c.starsText.replace('{ulduz}', stats.stars)}</p>}

        {c.message && (
          <div className="receipt-msg">
            <Avatar c={game} size={36} />
            <p>{c.message}</p>
          </div>
        )}

        <div className="report-actions">
          {result.date && (
            <button
              className="btn btn-primary"
              onClick={() =>
                downloadIcs({ title: c.calendarTitle, date: result.date, time: result.time, place: dest.name })
              }
            >
              {c.calendarButton}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onEdit}>
            {c.editButton}
          </button>
        </div>
      </div>
    </div>
  );
}
