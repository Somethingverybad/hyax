// Справочник игры «Осколки Короны»: фракции, существа, постройки, заклинания,
// местность. Всё оригинальное; баланс правится здесь.

export const RES = ["gold", "wood", "ore", "crystal"];
export const RES_NAME = { gold: "Золото", wood: "Древесина", ore: "Руда", crystal: "Кристаллы" };
export const RES_ICON = { gold: "💰", wood: "🪵", ore: "🪨", crystal: "💎" };

export const START_RES = { gold: 5000, wood: 15, ore: 15, crystal: 5 };

/** Местность: стоимость шага (ход героя — 10 на траве) и цвет на карте. */
export const TERRAIN = {
  g: { name: "Луг", cost: 10, color: "#5f9e45" },
  d: { name: "Тракт", cost: 7, color: "#a08654" },
  s: { name: "Пески", cost: 15, color: "#d8c27a" },
  n: { name: "Снега", cost: 15, color: "#dfe8ef" },
  m: { name: "Топь", cost: 18, color: "#4f6b4a" },
  T: { name: "Чаща", cost: 0, color: "#2f6b33", block: true },
  M: { name: "Скалы", cost: 0, color: "#7c7466", block: true },
  "~": { name: "Озеро", cost: 0, color: "#3f78b5", block: true },
};

export const HERO_MP = 160;
export const HERO_COST = 2500;
export const MAX_HEROES = 3;
export const ARMY_SLOTS = 7;

export const PLAYER_COLORS = ["#e04848", "#3b82f6", "#22b573", "#f2a516"];
export const PLAYER_COLOR_NAMES = ["Алые", "Лазурные", "Изумрудные", "Янтарные"];

// Существа. hp, atk, def, dmg [min, max], spd; shots — стрелок; fly — летает;
// noRetal — цель не отвечает на его удар; retal — сколько раз за раунд
// отвечает сам (по умолчанию 1). cost — {gold, crystal?}, growth — прирост в неделю.
export const UNITS = {
  // Орден Рассвета
  militia:  { name: "Ополченец",       icon: "🗡️", tier: 1, hp: 8,   atk: 4,  def: 5,  dmg: [1, 3],   spd: 4, cost: { gold: 60 },   growth: 14 },
  arbalest: { name: "Арбалетчик",      icon: "🏹", tier: 2, hp: 10,  atk: 6,  def: 3,  dmg: [2, 3],   spd: 4, cost: { gold: 100 },  growth: 9, shots: 10 },
  warden:   { name: "Храмовый страж",  icon: "🛡️", tier: 3, hp: 25,  atk: 7,  def: 10, dmg: [3, 6],   spd: 4, cost: { gold: 220 },  growth: 7, retal: 2 },
  lancer:   { name: "Всадник зари",    icon: "🐎", tier: 4, hp: 50,  atk: 12, def: 9,  dmg: [8, 14],  spd: 7, cost: { gold: 550 },  growth: 4 },
  seraph:   { name: "Серафим",         icon: "👼", tier: 5, hp: 120, atk: 18, def: 16, dmg: [20, 30], spd: 9, cost: { gold: 2000, crystal: 1 }, growth: 2, fly: true },
  // Лесной союз
  thorn:    { name: "Колючник",        icon: "🌵", tier: 1, hp: 6,   atk: 5,  def: 3,  dmg: [1, 3],   spd: 6, cost: { gold: 55 },   growth: 15 },
  ranger:   { name: "Следопыт",        icon: "🎯", tier: 2, hp: 12,  atk: 7,  def: 4,  dmg: [2, 4],   spd: 5, cost: { gold: 120 },  growth: 8, shots: 12 },
  boar:     { name: "Вепрь",           icon: "🐗", tier: 3, hp: 30,  atk: 10, def: 6,  dmg: [4, 8],   spd: 7, cost: { gold: 260 },  growth: 6 },
  ancient:  { name: "Мшистый древень", icon: "🌳", tier: 4, hp: 70,  atk: 10, def: 15, dmg: [8, 12],  spd: 3, cost: { gold: 500 },  growth: 4, retal: 2 },
  owl:      { name: "Грозовой филин",  icon: "🦉", tier: 5, hp: 100, atk: 17, def: 13, dmg: [18, 28], spd: 11, cost: { gold: 1800, crystal: 1 }, growth: 2, fly: true, noRetal: true },
  // Пепельный культ
  ashling:  { name: "Пепельник",       icon: "💀", tier: 1, hp: 7,   atk: 4,  def: 4,  dmg: [1, 3],   spd: 5, cost: { gold: 50 },   growth: 16 },
  bonesling:{ name: "Костеметатель",   icon: "🦴", tier: 2, hp: 9,   atk: 6,  def: 3,  dmg: [2, 4],   spd: 4, cost: { gold: 95 },   growth: 9, shots: 8 },
  hound:    { name: "Угольный пёс",    icon: "🐕", tier: 3, hp: 22,  atk: 9,  def: 5,  dmg: [3, 7],   spd: 8, cost: { gold: 200 },  growth: 7 },
  graveknight:{ name: "Могильный рыцарь", icon: "⚔️", tier: 4, hp: 60, atk: 13, def: 10, dmg: [9, 15], spd: 6, cost: { gold: 600 }, growth: 3 },
  drake:    { name: "Пепельный змей",  icon: "🐉", tier: 5, hp: 130, atk: 19, def: 14, dmg: [22, 32], spd: 8, cost: { gold: 2100, crystal: 1 }, growth: 2, fly: true },
  // Нейтралы: живут на карте и в ничейных городах
  goblin:   { name: "Гоблин",          icon: "👺", tier: 1, hp: 5,   atk: 3,  def: 2,  dmg: [1, 2],   spd: 5, cost: { gold: 40 },   growth: 0 },
  wolf:     { name: "Серый волк",      icon: "🐺", tier: 2, hp: 12,  atk: 6,  def: 4,  dmg: [2, 5],   spd: 7, cost: { gold: 110 },  growth: 0 },
  harpy:    { name: "Гарпия",          icon: "🦅", tier: 3, hp: 15,  atk: 7,  def: 5,  dmg: [2, 5],   spd: 8, cost: { gold: 150 },  growth: 0, fly: true, noRetal: true },
  ogre:     { name: "Людоед",          icon: "👹", tier: 4, hp: 45,  atk: 10, def: 8,  dmg: [6, 11],  spd: 4, cost: { gold: 400 },  growth: 0 },
  golem:    { name: "Каменный голем",  icon: "🗿", tier: 5, hp: 80,  atk: 12, def: 16, dmg: [10, 14], spd: 3, cost: { gold: 750 },  growth: 0, retal: 2 },
};

export const NEUTRALS = ["goblin", "wolf", "harpy", "ogre", "golem"];

export const FACTIONS = {
  dawn: {
    name: "Орден Рассвета", icon: "☀️", town: "🏰",
    units: ["militia", "arbalest", "warden", "lancer", "seraph"],
    dwellings: ["Казармы", "Стрельбище", "Святилище стражи", "Конюшни зари", "Небесный шпиль"],
    hero: { atk: 2, def: 2, power: 1, know: 1, grow: { atk: 35, def: 35, power: 15, know: 15 } },
    heroIcon: "🤴",
    heroNames: ["Ардан", "Велена", "Тирос", "Мирослава", "Корвин", "Элис"],
    towns: ["Светлогорье", "Зарецк", "Белый Брод", "Огнеслав"],
  },
  wild: {
    name: "Лесной союз", icon: "🌿", town: "🏯",
    units: ["thorn", "ranger", "boar", "ancient", "owl"],
    dwellings: ["Терновник", "Охотничий стан", "Логово вепрей", "Роща древних", "Гнездовье бури"],
    hero: { atk: 1, def: 2, power: 2, know: 1, grow: { atk: 30, def: 25, power: 25, know: 20 } },
    heroIcon: "🧝",
    heroNames: ["Ивола", "Ракша", "Сельвин", "Морена", "Дубрава", "Янко"],
    towns: ["Мшанка", "Зелёный Дол", "Корнеград", "Ясенец"],
  },
  ash: {
    name: "Пепельный культ", icon: "🔥", town: "🏛️",
    units: ["ashling", "bonesling", "hound", "graveknight", "drake"],
    dwellings: ["Пепелище", "Костяной двор", "Псарня углей", "Склеп рыцарей", "Гнездо змея"],
    hero: { atk: 1, def: 1, power: 2, know: 2, grow: { atk: 25, def: 20, power: 30, know: 25 } },
    heroIcon: "🧛",
    heroNames: ["Мордвин", "Ведана", "Кострец", "Сажа", "Гарм", "Темира"],
    towns: ["Пепельный Яр", "Чадов", "Угольник", "Сумрак"],
  },
};

export const FACTION_IDS = Object.keys(FACTIONS);

// Постройки города. dw1 стоит сразу. req — что нужно построить раньше.
export const BUILDINGS = {
  hall2:  { name: "Ратуша",           cost: { gold: 2500 },                       req: [], desc: "Доход города 1000 золота в день" },
  hall3:  { name: "Капитолий",        cost: { gold: 5000, crystal: 5 },           req: ["hall2", "dw3"], desc: "Доход города 2000 золота в день" },
  dw2:    { name: null, tier: 2,      cost: { gold: 1000, wood: 5 },              req: [] },
  dw3:    { name: null, tier: 3,      cost: { gold: 2000, wood: 5, ore: 5 },      req: ["dw2"] },
  dw4:    { name: null, tier: 4,      cost: { gold: 4000, wood: 5, ore: 10, crystal: 2 }, req: ["dw3"] },
  dw5:    { name: null, tier: 5,      cost: { gold: 8000, wood: 10, ore: 10, crystal: 8 }, req: ["dw4", "hall2"] },
  guild1: { name: "Гильдия магов",    cost: { gold: 2000, wood: 5, ore: 5 },      req: [], desc: "Два заклинания первого круга" },
  guild2: { name: "Башня магов",      cost: { gold: 3000, wood: 5, ore: 5, crystal: 4 }, req: ["guild1"], desc: "Заклинания второго круга" },
  market: { name: "Рынок",            cost: { gold: 1000, wood: 5 },              req: [], desc: "Обмен ресурсов" },
};

export const HALL_INCOME = { 1: 500, 2: 1000, 3: 2000 };

/** Курс рынка: сколько золота за единицу ресурса (продажа и покупка). */
export const MARKET = { wood: { sell: 25, buy: 100 }, ore: { sell: 25, buy: 100 }, crystal: { sell: 100, buy: 400 } };

export const MINES = {
  gold: { name: "Золотой прииск", icon: "⛏️", daily: 500 },
  wood: { name: "Лесопилка", icon: "🪓", daily: 2 },
  ore: { name: "Рудник", icon: "⚒️", daily: 2 },
  crystal: { name: "Кристальная пещера", icon: "🔮", daily: 1 },
};

// Заклинания. Урон и сила считаются от «Силы» героя (power).
export const SPELLS = {
  firebolt:  { name: "Огненная стрела", icon: "🔥", level: 1, mana: 5,  target: "enemy", desc: "Урон 10 + 10×Сила" },
  mend:      { name: "Исцеление",       icon: "✨", level: 1, mana: 6,  target: "ally",  desc: "Лечит и поднимает павших: 20 + 15×Сила ОЗ" },
  haste:     { name: "Ускорение",       icon: "💨", level: 1, mana: 5,  target: "ally",  desc: "+3 к скорости на 3 раунда" },
  stoneskin: { name: "Каменная кожа",   icon: "🪨", level: 1, mana: 5,  target: "ally",  desc: "+5 к защите на 3 раунда" },
  lightning: { name: "Цепная молния",   icon: "⚡", level: 2, mana: 10, target: "enemy", desc: "Урон 25 + 15×Сила" },
  slow:      { name: "Оковы",           icon: "⛓️", level: 2, mana: 8,  target: "enemy", desc: "−3 к скорости на 3 раунда" },
};

export const SPELLS_L1 = Object.keys(SPELLS).filter((k) => SPELLS[k].level === 1);
export const SPELLS_L2 = Object.keys(SPELLS).filter((k) => SPELLS[k].level === 2);

/** Опыт до уровня n (n ≥ 2). */
export const xpFor = (level) => Math.round(500 * (level - 1) * (level + 2) / 2);

export const STAT_NAME = { atk: "Атака", def: "Защита", power: "Сила", know: "Знание" };

/** Подпись численности отряда на карте — без точного числа. */
export function crowdLabel(n) {
  if (n < 5) return "Горстка";
  if (n < 10) return "Несколько";
  if (n < 20) return "Отряд";
  if (n < 50) return "Толпа";
  if (n < 100) return "Орда";
  return "Тьма";
}

export const costOf = (unitId, n = 1) => {
  const c = {};
  for (const [k, v] of Object.entries(UNITS[unitId].cost)) c[k] = v * n;
  return c;
};

export const canAfford = (res, cost) => Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v);

export function pay(res, cost) {
  for (const [k, v] of Object.entries(cost)) res[k] -= v;
}

export function buildingName(faction, id) {
  const b = BUILDINGS[id];
  if (!b) return id;
  return b.tier ? FACTIONS[faction].dwellings[b.tier - 1] : b.name;
}
