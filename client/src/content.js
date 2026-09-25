// Admin paneldən redaktə olunan bütün mətnlərin standart dəyərləri.
// Mətnlərdə {ad}, {gonderen} və {gun} yazmaq olar — avtomatik əvəz olunur.
export const DEFAULT_CONTENT = {
  intro: {
    badge: '💌 Bir dəvət',
    title: '{ad}, səni bir yerdə gözləyirəm',
    text: 'Maşınına min və yola çıx. Yolda bir neçə kiçik sual olacaq 🙂',
    button: 'Maşına min 🔑',
  },
  game: {
    avatar: '',
    avatarEmoji: '🧑🏻',
    herPhoto: '',
    bgMusic: { url: '', name: '', volume: 0.35 }, // köhnə ayar — radioya köçürülür
    radio: { name: '{gonderen} FM', tracks: [], voices: [], volume: 0.5 },
    billboards: [],
    music: [],
    carColor: '#e63946',
    maxSpeed: 160,
    carVolume: 0.5,
    start: 'flame',
    destination: 'hac',
    tutorialTitle: 'Necə oynanılır?',
    tutorialText:
      'Barmağını ekrana qoy — maşın sürməyə başlayır. Sağa-sola sürüşdür — sükan, aşağı çək — əyləc. Kompüterdə ox düymələri. Sarı xətti izlə, yolda ⭐ topla.',
    tutorialButton: 'Yola çıx 🚗',
    driveHint: '👆 Barmağını ekrana qoy və saxla',
    nextLabel: 'Növbəti dayanacaq',
    finalLabel: 'Son ünvan',
    finalName: '',
    wrongAnswer: 'Düz deyil, bir də yoxla 🙂',
    continueButton: 'Yola davam →',
    stops: [
      {
        place: 'eye',
        type: 'quiz',
        title: 'Isınma sualı',
        text: 'Bakı hansı dənizin sahilindədir?',
        options: ['Qara dəniz', 'Xəzər dənizi', 'Aralıq dənizi'],
        correct: 1,
        answer: '',
        taps: 10,
        button: '',
        success: 'Düzdür! Növbəti dayanacaq xəritədə göstərildi.',
      },
      {
        place: 'gallery',
        type: 'photo',
        title: 'Gözəllik sərgisi ✨',
        text: 'Bu gecə sərgidə yalnız bir eksponat var 🙂',
        options: [],
        correct: 0,
        answer: '',
        taps: 10,
        button: 'Yola davam →',
        success: '',
      },
      {
        place: 'fountains',
        type: 'photoPuzzle',
        title: 'Kiçik tapmaca',
        text: 'Sərgidən bir şəkil düşüb dağılıb. Parçalara toxunub düzəlt.',
        options: [],
        correct: 0,
        answer: '',
        taps: 10,
        button: '',
        success: 'Əla alındı!',
      },
    ],
  },
  chat: {
    title: '{gonderen}',
    status: 'onlayn',
    typing: 'yazır...',
    sendButton: 'Göndər',
    skipButton: 'Keç',
    textPlaceholder: 'Yaz...',
    finishButton: 'Hazırdır ✨',
    messages: [
      { type: 'say', text: 'Salam, {ad}! Çatdın 🙂', options: [], optional: false },
      { type: 'say', text: 'Bir neçə sualım var, tez bitir.', options: [], optional: false },
      {
        type: 'multi',
        text: 'Nə içmək istəyirsən?',
        options: ['🍵 Çay', '☕ Qəhvə', '🍹 Limonad', '🥤 Milkşeyk', '💧 Sadəcə su'],
        optional: false,
      },
      {
        type: 'multi',
        text: 'Bəs yemək?',
        options: ['🍔 Burger', '🍕 Pizza', '🍣 Suşi', '🌯 Dönər', '🍰 Desert', '🙅 Ac deyiləm'],
        optional: false,
      },
      {
        type: 'single',
        text: 'Harda oturaq?',
        options: ['🪴 Rahat kafe', '🌊 Bulvarda gəzinti', '🎬 Kino', '🎲 Board game kafe', '🎁 Sürpriz olsun'],
        optional: false,
      },
      {
        type: 'date',
        text: 'Hansı gün və saat sənə uyğundur?',
        options: ['12:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
        optional: false,
      },
      { type: 'text', text: 'Əlavə nəsə demək istəyirsən?', options: [], optional: true },
      { type: 'say', text: 'Oldu, hər şeyi qeyd etdim. Görüşürük! 👋', options: [], optional: false },
    ],
  },
  final: {
    badge: '💌 Date',
    title: 'Görüşürük, {ad}!',
    subtitle: 'Hər şey hazırdır — qalanını mənə burax 🙂',
    choicesTitle: 'Sənin seçimlərin',
    starsText: 'Yolda {ulduz} ⭐ topladın',
    message: 'Səbirsizliklə gözləyirəm!',
    calendarTitle: 'Date: {gonderen} & {ad}',
    calendarButton: '📅 Təqvimə əlavə et',
    editButton: '✏️ Cavabları dəyiş',
  },
};

export const MESSAGE_TYPES = {
  say: 'Sadə mesaj',
  single: 'Sual — bir seçim',
  multi: 'Sual — bir neçə seçim',
  date: 'Sual — tarix və saat',
  text: 'Sual — yazılı cavab',
};

export const TASK_TYPES = {
  quiz: 'Sual (variantlı)',
  text: 'Sual (yazılı cavab)',
  tap: 'Düyməyə N dəfə bas',
  memory: 'Yaddaş oyunu (cütləri tap)',
  photoPuzzle: 'Onun şəklindən tapmaca',
  photo: 'Onun şəklini göstər (sərgi)',
  info: 'Sadəcə mesaj',
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// saxlanmış məzmunu standart dəyərlərin üstünə yığır (yeni sahələr əlavə olunanda da işləsin)
export function mergeContent(saved, base = DEFAULT_CONTENT) {
  if (!isObj(saved)) return structuredClone(base);
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const s = saved[k];
    if (isObj(v)) out[k] = mergeContent(s, v);
    else if (Array.isArray(v)) out[k] = Array.isArray(s) ? s : structuredClone(v);
    else out[k] = typeof s === typeof v ? s : v;
  }
  return out;
}

// bütün sətirlərdə {ad}, {gonderen}, {gun} əvəz edir
export function fillContent(content, vars) {
  const walk = (v) => {
    if (typeof v === 'string') return v.replace(/\{(ad|gonderen|gun)\}/g, (_, k) => vars[k] ?? '');
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(content);
}
