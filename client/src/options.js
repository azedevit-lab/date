export const FOODS = [
  { id: 'tea', emoji: '🍵', label: 'Çay', tag: 'Yavaş və dərin recon' },
  { id: 'coffee', emoji: '☕', label: 'Qəhvə', tag: 'Kofeinlə 0-day ovu' },
  { id: 'burger', emoji: '🍔', label: 'Burger', tag: 'Full-stack payload' },
  { id: 'pizza', emoji: '🍕', label: 'Pizza', tag: 'Dilim-dilim exploitation' },
  { id: 'sushi', emoji: '🍣', label: 'Suşi', tag: 'Raw data, low-level' },
  { id: 'doner', emoji: '🌯', label: 'Dönər / Şaurma', tag: 'Encapsulated payload' },
  { id: 'pasta', emoji: '🍝', label: 'Pasta', tag: 'Spagetti kod, amma dadlı' },
  { id: 'dessert', emoji: '🍰', label: 'Desert', tag: 'Sweet exploit' },
  { id: 'icecream', emoji: '🍦', label: 'Dondurma', tag: 'Cold boot attack' },
  { id: 'lemonade', emoji: '🍹', label: 'Limonad / Mojito', tag: 'Refreshing reverse shell' },
  { id: 'milkshake', emoji: '🥤', label: 'Milkşeyk', tag: 'Şəkər overflow' },
  { id: 'surprise', emoji: '🎁', label: 'Sürpriz olsun', tag: 'Black-box test' },
];

export const ACTIVITIES = [
  { id: 'cafe', emoji: '🪴', label: 'Rahat kafe', tag: 'Klassik social engineering' },
  { id: 'walk', emoji: '🌊', label: 'Bulvarda gəzinti', tag: 'Açıq havada fiziki pentest' },
  { id: 'cinema', emoji: '🎬', label: 'Kino', tag: '2 saat passive monitoring' },
  { id: 'escape', emoji: '🔐', label: 'Escape room', tag: 'Real həyatda CTF!' },
  { id: 'bowling', emoji: '🎳', label: 'Boulinq', tag: 'Strike = RCE' },
  { id: 'games', emoji: '🎲', label: 'Board game kafe', tag: 'Strategiya testləri' },
  { id: 'museum', emoji: '🖼️', label: 'Muzey / sərgi', tag: 'Legacy sistemlərin tədqiqi' },
  { id: 'sunset', emoji: '🌅', label: 'Gün batımı', tag: 'Golden hour exfiltration' },
  { id: 'surprise', emoji: '🎁', label: 'Sürpriz olsun', tag: 'Scope: unknown' },
];

export const TIMES = ['12:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

export const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'İyun',
  'İyul',
  'Avqust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];
export const WEEKDAYS = ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B'];
export const WEEKDAYS_LONG = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'];

export const labelOf = (list, id) => {
  const o = list.find((x) => x.id === id);
  return o ? `${o.emoji} ${o.label}` : id;
};

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${d} ${MONTHS[m - 1]}, ${WEEKDAYS_LONG[date.getDay()]}`;
}
