// Oyunun bütün səsləri:
//  • radio — admin paneldəki mahnılar növbə ilə çalır, sürücü dəyişə bilir
//  • məkan mahnıları — yaxınlaşanda çalır, uzaqlaşanda dayanır (radio o vaxt səssizləşir)
//  • maşın — mühərrik, əyləc cırıltısı, siqnal, ulduz səsi (sintez, fayl lazım deyil)
// iPhone-da audio.volume işləmədiyi üçün hər şeyi Web Audio GainNode ilə idarə edirik.
import { PLACES } from './map.js';

const FADE = 0.35;
const STOP_AFTER = 1.2; // saniyə sakitlikdən sonra məkan mahnısı dayanır və əvvələ qayıdır

export function createAudio({ places = [], radio = null, carVolume = 0.5, onRadioChange = () => {} }) {
  let ctx = null;
  let master = null;
  let sfx = null; // maşın səsləri üçün ayrıca səviyyə
  let muted = false;
  const items = [];
  let engine = null;
  let noiseBuf = null;
  let brakeGain = null;

  const radioTracks = (radio?.tracks || []).filter((t) => t.url);
  const voices = (radio?.voices || []).filter((t) => t.url);
  // mahnı yoxdursa, səs mesajları özləri radio kimi çalınsın
  if (!radioTracks.length && voices.length) radioTracks.push(...voices.splice(0));
  // voice — hazırda səs mesajı çalınırsa onun indeksi; vIdx — növbəti səs mesajı
  const r = { el: null, gain: null, idx: 0, playing: true, voice: -1, vIdx: 0 };

  const wire = (el) => {
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(master);
    return gain;
  };

  const radioInfo = () => ({
    station: radio?.name || '',
    voice: r.voice >= 0,
    title: r.voice >= 0 ? '🎙️ Səs mesajı' : radioTracks[r.idx]?.name?.replace(/\.[a-z0-9]+$/i, '') || '',
    playing: r.playing,
    count: radioTracks.length,
  });

  const playRadio = (idx) => {
    if (!r.el || !radioTracks.length) return;
    r.voice = -1;
    r.idx = (idx + radioTracks.length) % radioTracks.length;
    r.el.src = radioTracks[r.idx].url;
    if (r.playing) r.el.play().catch(() => {});
    onRadioChange(radioInfo());
  };

  // mahnı bitəndə: hələ çalınmamış səs mesajı varsa onu, yoxsa növbəti mahnını
  const onEnded = () => {
    if (r.voice < 0 && r.vIdx < voices.length) {
      r.voice = r.vIdx++;
      r.el.src = voices[r.voice].url;
      if (r.playing) r.el.play().catch(() => {});
      onRadioChange(radioInfo());
      return;
    }
    playRadio(r.idx + 1);
  };

  // mühərrik: iki osilator + aşağı keçid filtri
  const makeEngine = () => {
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o1.connect(filter);
    o2.connect(g2).connect(filter);
    filter.connect(out).connect(sfx);
    o1.start();
    o2.start();
    return { out, filter, o1, o2 };
  };

  return {
    // maşın səsləri həmişə var, ona görə səs düyməsi də həmişə görünür
    get hasAudio() {
      return true;
    },
    get hasRadio() {
      return radioTracks.length > 0;
    },
    radioInfo,
    // brauzerlər səsi yalnız istifadəçi toxunuşundan sonra açır
    unlock() {
      if (ctx) return ctx.state === 'suspended' && ctx.resume();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // iPhone səssiz rejimdə olsa da musiqi çalsın
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.gain.value = Number(carVolume) * 2; // 0.5 → əvvəlki səviyyə
      sfx.connect(master);

      for (const t of places) {
        if (!t.url || !PLACES[t.place]) continue;
        const el = new Audio(t.url);
        el.loop = true;
        el.preload = 'auto';
        // radius köhnə xəritə vahidlərindədir (1 vahid ≈ 2.5 m)
        items.push({
          el,
          gain: wire(el),
          place: t.place,
          radius: (Number(t.radius) || 250) * 2.5,
          volume: Number(t.volume ?? 1),
          playing: false,
          quiet: 0,
          retryAt: 0,
        });
      }
      if (radioTracks.length) {
        r.el = new Audio();
        r.el.preload = 'auto';
        r.gain = wire(r.el);
        r.el.addEventListener('ended', onEnded);
        r.el.addEventListener('error', () => setTimeout(() => playRadio(r.idx + 1), 1500));
        playRadio(0);
      }
      // iOS: elementləri toxunuşun içində bir dəfə işə salırıq ki, sonra kodla çalına bilsinlər
      for (const it of items)
        it.el
          .play()
          .then(() => !it.playing && it.el.pause())
          .catch(() => {});

      engine = makeEngine();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // əyləc cırıltısı: daimi səs-küy, səviyyəsi əyləcə görə
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600;
      band.Q.value = 6;
      brakeGain = ctx.createGain();
      brakeGain.gain.value = 0;
      noise.connect(band).connect(brakeGain).connect(sfx);
      noise.start();
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
    },
    // radio idarəsi
    next: () => playRadio(r.idx + 1),
    prev: () => playRadio(r.idx - 1),
    toggle() {
      if (!r.el) return;
      r.playing = !r.playing;
      if (r.playing) r.el.play().catch(() => {});
      else r.el.pause();
      onRadioChange(radioInfo());
    },
    horn() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.02);
      g.gain.setValueAtTime(0.045, t + 0.45);
      g.gain.linearRampToValueAtTime(0, t + 0.55);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      g.connect(f).connect(sfx);
      for (const hz of [415, 523]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = hz;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.6);
      }
    },
    ding() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1320, t);
      o.frequency.setValueAtTime(1760, t + 0.07);
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(sfx);
      o.start(t);
      o.stop(t + 0.4);
    },
    // hər kadr: maşının yeri, sürəti (m/s), qaz (0..1), əyləc (0..1)
    update(x, y, dt, car = null) {
      if (!ctx) return;
      let near = 0;
      for (const it of items) {
        const [px, py] = PLACES[it.place].pos;
        const d = Math.hypot(px - x, py - y);
        const k = Math.max(0, 1 - d / it.radius);
        it.target = k * k * it.volume;
        near = Math.max(near, k);
      }
      for (const it of items) {
        it.gain.gain.setTargetAtTime(it.target, ctx.currentTime, FADE);
        if (it.target > 0.01) {
          it.quiet = 0;
          if (!it.playing && performance.now() > it.retryAt) {
            it.playing = true;
            it.el.play().catch(() => {
              it.playing = false;
              it.retryAt = performance.now() + 3000;
            });
          }
        } else if (it.playing) {
          it.quiet += dt;
          if (it.quiet > STOP_AFTER) {
            it.el.pause();
            it.el.currentTime = 0;
            it.playing = false;
          }
        }
      }
      // məkan mahnısı çalanda radio səssizləşir
      if (r.gain) {
        const vol = Number(radio?.volume ?? 0.5) * (1 - Math.min(1, near * 1.6));
        r.gain.gain.setTargetAtTime(vol, ctx.currentTime, FADE);
      }
      if (engine && car) {
        const speed = Math.abs(car.v);
        // sürət qutusu təsiri: hər ~12 m/s-də "ötürmə" dəyişir
        const gearPos = (speed % 12) / 12;
        const base = 55 + speed * 1.6 + gearPos * 70 + car.throttle * 25;
        engine.o1.frequency.setTargetAtTime(base, ctx.currentTime, 0.08);
        engine.o2.frequency.setTargetAtTime(base * 0.5, ctx.currentTime, 0.08);
        engine.filter.frequency.setTargetAtTime(500 + speed * 25 + car.throttle * 400, ctx.currentTime, 0.1);
        engine.out.gain.setTargetAtTime(car.active ? 0.007 + car.throttle * 0.009 : 0, ctx.currentTime, 0.15);
        const squeal = car.brake > 0.3 && speed > 9 ? Math.min(1, speed / 30) * 0.015 : 0;
        brakeGain.gain.setTargetAtTime(squeal, ctx.currentTime, 0.05);
      }
    },
    dispose() {
      for (const it of items) it.el.pause();
      r.el?.pause();
      ctx?.close();
    },
  };
}
