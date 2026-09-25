import { useMemo } from 'react';
import { MONTHS, WEEKDAYS, toISO } from '../options.js';

export default function DatePicker({ maxDays, times, date, time, onDate, onTime }) {
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: maxDays }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i + 1);
      return d;
    });
  }, [maxDays]);

  // həftə başlanğıcına (B.e) qədər boş xanalar
  const lead = (days[0].getDay() + 6) % 7;
  const firstMonth = days[0].getMonth();
  const lastMonth = days[days.length - 1].getMonth();
  const monthLabel = firstMonth === lastMonth ? MONTHS[firstMonth] : `${MONTHS[firstMonth]} – ${MONTHS[lastMonth]}`;

  return (
    <div className="datepicker">
      <div className="dp-month">{monthLabel}</div>
      <div className="dp-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="dp-wd">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {days.map((d) => {
          const iso = toISO(d);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <button
              key={iso}
              type="button"
              className={`dp-day ${date === iso ? 'active' : ''} ${weekend ? 'weekend' : ''}`}
              onClick={() => onDate(iso)}
            >
              <span>{d.getDate()}</span>
              {d.getDate() === 1 && <small>{MONTHS[d.getMonth()].slice(0, 3)}</small>}
            </button>
          );
        })}
      </div>

      <div className="dp-times">
        {times.map((t) => (
          <button key={t} type="button" className={`chip ${time === t ? 'active' : ''}`} onClick={() => onTime(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
