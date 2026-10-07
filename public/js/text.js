// Textanalyse für französische Transkripte: Wörter zählen, Abdeckung durch den
// eigenen Wortschatz berechnen, Lückentexte und Hör-Checks erzeugen.

const ELISIONS = { l: 'le', d: 'de', j: 'je', m: 'me', t: 'te', s: 'se', n: 'ne', c: 'ce', qu: 'que', jusqu: 'jusque', lorsqu: 'lorsque', puisqu: 'puisque' };

// Häufige unregelmäßige Formen → Grundform (damit "est" als "être" zählt).
const IRREGULAR = {
  être: 'suis es est sommes êtes sont étais était étions étiez étaient été serai seras sera serons serez seront serais serait soit soient fut',
  avoir: 'ai as a avons avez ont avais avait avions aviez avaient eu aurai auras aura aurons aurez auront aurais aurait ait aient',
  aller: 'vais vas va allons allez vont allait allé allée allés irai ira irons iront irait aille',
  faire: 'fais fait faisons faites font faisait faisaient ferai fera ferons feront ferait fasse',
  pouvoir: 'peux peut pouvons pouvez peuvent pouvait pu pourrai pourra pourrait pourraient puisse',
  vouloir: 'veux veut voulons voulez veulent voulait voulu voudrais voudrait voudrions',
  savoir: 'sais sait savons savez savent savait su saurai saura saurait sache',
  devoir: 'dois doit devons devez doivent devait dû due devrai devra devrait devraient',
  venir: 'viens vient venons venez viennent venait venu venue venus reviens revient',
  dire: 'dis dit disons dites disent disait dite dirai dira dirait',
  voir: 'vois voit voyons voyez voient voyait vu vue verrai verra verrait',
  prendre: 'prends prend prenons prenez prennent prenait pris prise prendrai prendra',
  mettre: 'mets met mettons mettez mettent mettait mis mise',
  croire: 'crois croit croyons croyez croient croyait cru',
  partir: 'pars part partons partez partent partait parti partie',
  vivre: 'vis vit vivons vivez vivent vivait vécu',
  il: 'ils',
  elle: 'elles',
  le: 'la les',
  un: 'une des',
  ce: 'cet cette ces',
  mon: 'ma mes',
  ton: 'ta tes',
  son: 'sa ses',
  notre: 'nos',
  votre: 'vos',
  leur: 'leurs',
  au: 'aux',
  du: 'des',
  tout: 'toute tous toutes',
  quel: 'quelle quels quelles',
  nouveau: 'nouvelle nouveaux nouvelles nouvel',
  beau: 'belle beaux belles bel',
  vieux: 'vieille vieil vieilles',
};

export const STOPWORDS = new Set(
  ('le la les un une des de du au aux et ou mais donc or ni car que qui quoi dont où ce cet cette ces il elle ils elles on je tu nous vous ' +
    'me te se lui leur y en ne pas plus très bien est sont a ont été être avoir à dans par pour sur avec sans sous chez comme si son sa ses mon ma mes ton ta tes notre nos votre vos leurs tout tous toute toutes aussi alors')
    .split(' ')
);

export function normalize(word) {
  return word.normalize('NFC').toLowerCase().replace(/[’`´]/g, "'").trim();
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function looseEqual(a, b) {
  const clean = (s) => stripAccents(normalize(s)).replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim();
  return clean(a) === clean(b);
}

const KEEP_WHOLE = new Set(["aujourd'hui", "presqu'île", "prud'homme"]);
const WORD_RE = /[a-zà-öø-ÿœæç]+(?:'[a-zà-öø-ÿœæç]+|-[a-zà-öø-ÿœæç]+)*/gi;

/** Zerlegt Text in normalisierte Wörter; Elisionen (l', d', qu' …) werden aufgelöst. */
export function tokenize(text) {
  const out = [];
  for (const raw of normalize(text).match(WORD_RE) || []) {
    if (KEEP_WHOLE.has(raw)) {
      out.push(raw);
      continue;
    }
    const parts = raw.split("'");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (i < parts.length - 1 && ELISIONS[p]) out.push(ELISIONS[p]);
      else out.push(p);
    }
  }
  return out;
}

export function countWords(text) {
  return tokenize(text || '').length;
}

/** Schlüssel eines Vokabeleintrags: "la maison" → "maison", "se lever" → "lever". */
export function vocabKey(fr) {
  let key = normalize(fr).split(/[/,;(]/)[0].trim();
  key = key.replace(/^(le|la|les|un|une|des|se|s')\s+/, '').replace(/^(l'|s')/, '');
  return key.trim();
}

/** Grobe Flexionsformen, damit Plural, Femininum und regelmäßige Verbformen erkannt werden. */
export function variants(key) {
  const v = new Set([key]);
  if (key.includes(' ')) return v;
  for (const suf of ['s', 'e', 'es', 'x']) v.add(key + suf);
  if (key.endsWith('al')) v.add(key.slice(0, -2) + 'aux');
  if (key.endsWith('eux')) v.add(key.slice(0, -1) + 'se').add(key.slice(0, -1) + 'ses');
  if (key.endsWith('if')) v.add(key.slice(0, -1) + 've').add(key.slice(0, -1) + 'ves');
  if (key.endsWith('er') && key.length > 3) {
    const stem = key.slice(0, -2);
    for (const e of ['e', 'es', 'ons', 'ez', 'ent', 'é', 'ée', 'és', 'ées', 'ais', 'ait', 'ions', 'iez', 'aient', 'erai', 'era', 'erons', 'eront', 'erais', 'erait', 'ant'])
      v.add(stem + e);
    if (stem.endsWith('g')) v.add(stem + 'eons').add(stem + 'eait').add(stem + 'eais');
    if (stem.endsWith('c')) v.add(stem.slice(0, -1) + 'çons').add(stem.slice(0, -1) + 'çait');
  }
  if (key.endsWith('ir') && key.length > 3) {
    const stem = key.slice(0, -2);
    for (const e of ['is', 'it', 'issons', 'issez', 'issent', 'i', 'ie', 'issait', 'irai', 'ira', 'irait']) v.add(stem + e);
  }
  if (key.endsWith('re') && key.length > 4) {
    const stem = key.slice(0, -2);
    for (const e of ['s', '', 'ons', 'ez', 'ent', 'u', 'ue', 'ait']) v.add(stem + e);
  }
  if (IRREGULAR[key]) for (const f of IRREGULAR[key].split(' ')) v.add(f);
  return v;
}

/** Menge aller Formen, die als "bekannt" gelten. */
export function buildKnownSet(words) {
  const set = new Set();
  for (const w of words) {
    const key = vocabKey(w);
    if (!key) continue;
    for (const form of variants(key)) set.add(form);
    for (const part of key.split(/\s+/)) set.add(part);
  }
  return set;
}

/** Eigennamen: Wörter, die mitten im Satz nur großgeschrieben vorkommen (Paris, Macron …). */
export function properNouns(text) {
  const cap = new Set();
  const lower = new Set();
  for (const m of (text || '').normalize('NFC').matchAll(WORD_RE)) {
    const word = m[0].toLowerCase();
    if (/^\p{Ll}/u.test(m[0])) {
      lower.add(word);
      continue;
    }
    const before = text.slice(0, m.index).trimEnd();
    if (!before || /[.!?…:«"“]$/.test(before)) continue; // Satzanfang: nicht eindeutig
    cap.add(word);
  }
  return new Set([...cap].filter((w) => !lower.has(w)));
}

/** Wortstatistik eines Textes relativ zu einem bekannten Wortschatz. Eigennamen zählen als bekannt. */
export function analyze(text, knownSet) {
  const names = properNouns(text);
  const tokens = tokenize(text || '');
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  let knownTokens = 0;
  const unknown = [];
  for (const [word, count] of freq) {
    if (knownSet.has(word) || names.has(word)) knownTokens += count;
    else unknown.push({ word, count });
  }
  unknown.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'fr'));
  return {
    tokens: tokens.length,
    unique: freq.size,
    knownTokens,
    knownUnique: freq.size - unknown.length,
    coverage: tokens.length ? knownTokens / tokens.length : 0,
    unknown,
    names,
    freq,
  };
}

export function sentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ«"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Kleiner deterministischer Zufallsgenerator, damit Aufgaben stabil bleiben. */
export function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isContentWord = (w) => w.length >= 4 && !STOPWORDS.has(w) && !w.includes('-');

/** Lückentext: n Sätze aus dem Transkript mit je einer Lücke. */
export function makeCloze(text, n, seed) {
  const rand = rng(seed);
  const candidates = sentences(text).filter((s) => {
    const len = countWords(s);
    return len >= 6 && len <= 30;
  });
  const out = [];
  for (const s of shuffle(candidates, rand)) {
    if (out.length >= n) break;
    const matches = [...s.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿœæçŒÆÇ]+/g)].filter((m) => isContentWord(normalize(m[0])));
    if (!matches.length) continue;
    const m = matches[Math.floor(rand() * matches.length)];
    out.push({ before: s.slice(0, m.index), answer: m[0], after: s.slice(m.index + m[0].length) });
  }
  return out;
}

/** Hör-Check: Wörter aus dem Transkript + Ablenker, die nicht vorkommen. */
export function makeHeardCheck(text, pool, seed, inCount = 8, outCount = 4) {
  const rand = rng(seed);
  const tokens = new Set(tokenize(text));
  const inWords = shuffle([...tokens].filter(isContentWord), rand).slice(0, inCount);
  const outWords = shuffle(
    [...new Set(pool.map(vocabKey))].filter((w) => isContentWord(w) && !w.includes(' ') && ![...variants(w)].some((f) => tokens.has(f))),
    rand
  ).slice(0, outCount);
  return shuffle(
    [...inWords.map((word) => ({ word, inText: true })), ...outWords.map((word) => ({ word, inText: false }))],
    rand
  );
}
