import { BASE_WORDS } from './words.js';
import * as T from './text.js';

// ---------- Konstanten ----------
const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 2, 4, 8, 16, 32, 64]; // Tage bis zur nächsten Wiederholung je Box
const MAX_BOX = INTERVALS.length - 1;
const KNOWN_BOX = 2; // ab dieser Box zählt ein Wort als "gelernt"
const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000];
const WORDS_PER_MINUTE = 130; // Schätzung für Episoden ohne Transkript
const SUGGESTED_PODCASTS = [
  'Journal en français facile',
  'InnerFrench',
  'Français Authentique',
  'Easy French',
  'Coffee Break French',
  'Choses à Savoir',
];
const COVERAGE_HINTS = [
  [100, 'die wichtigsten Funktionswörter'],
  [500, 'einfache Alltagsgespräche'],
  [1000, 'ca. 80 % eines Alltagsgesprächs'],
  [2000, 'ca. 90 % gesprochener Sprache'],
  [3000, 'die meisten Podcasts für Lernende'],
  [5000, 'Nachrichten und Radio im Original'],
];

// ---------- Zustand ----------
let state;
let podcasts = [];
let session = null; // aktuelle Lernsitzung
let searchResults = [];
let pollTimer = null;
const player = { episode: null, taskId: null, lastTime: null };

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const audio = $('#audio');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const pct = (x) => `${Math.round(x * 100)} %`;

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function day(key = todayKey()) {
  state.history[key] ||= { learned: 0, reviews: 0, newSeen: 0, heard: 0, written: 0, listenSec: 0 };
  return state.history[key];
}
function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
function fmtDate(s) {
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function newState() {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    settings: { newPerDay: 10, direction: 'fr-de' },
    vocab: BASE_WORDS.map((w) => makeWord(w.fr, w.de, 'Grundwortschatz', now)),
    tasks: [],
    history: {},
  };
}
function makeWord(fr, de, source = 'eigene', now = Date.now()) {
  return { id: uid(), fr, de, box: 0, due: now, correct: 0, wrong: 0, added: now, source };
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

async function loadState() {
  let remote = null;
  try {
    remote = await api('/api/state');
  } catch {
    /* Server nicht erreichbar → lokale Kopie */
  }
  let local = null;
  try {
    local = JSON.parse(localStorage.getItem('motamot-state'));
  } catch {
    /* ignorieren */
  }
  // Die neuere Kopie gewinnt (z. B. wenn der Server beim Schließen nicht erreichbar war).
  state = (remote && local ? ((local.savedAt || 0) > (remote.savedAt || 0) ? local : remote) : remote || local) || newState();
  state.settings ||= { newPerDay: 10, direction: 'fr-de' };
  state.history ||= {};
  state.tasks ||= [];
  if (state !== remote) save();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    state.savedAt = Date.now();
    try {
      localStorage.setItem('motamot-state', JSON.stringify(state));
    } catch {
      /* Speicher voll oder gesperrt */
    }
    try {
      await api('/api/state', { method: 'PUT', body: state });
    } catch {
      toast('Speichern auf dem Server fehlgeschlagen – lokal gesichert.');
    }
  }, 400);
}
window.addEventListener('pagehide', () => {
  if (!state) return;
  clearTimeout(saveTimer);
  state.savedAt = Date.now();
  const body = JSON.stringify(state);
  try {
    localStorage.setItem('motamot-state', body);
  } catch {
    /* ignorieren */
  }
  fetch('/api/state', { method: 'PUT', body, headers: { 'Content-Type': 'application/json' }, keepalive: body.length < 60000 }).catch(() => {});
});

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Sprachausgabe wird von diesem Browser nicht unterstützt.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 0.9;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('fr'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---------- Wortzählung ----------
const learnedWords = () => state.vocab.filter((w) => w.box >= KNOWN_BOX);
const learnedCount = () => learnedWords().length;
const dueWords = () => state.vocab.filter((w) => w.box > 0 && w.due <= Date.now());
const newWords = () => state.vocab.filter((w) => w.box === 0);
function milestoneInfo(n) {
  const next = MILESTONES.find((m) => m > n) ?? Math.ceil((n + 1) / 5000) * 5000;
  const prev = [...MILESTONES].reverse().find((m) => m <= n) ?? 0;
  return { prev, next, frac: (n - prev) / (next - prev) };
}
function knownSet() {
  return T.buildKnownSet(learnedWords().map((w) => w.fr));
}
function streak() {
  let n = 0;
  const d = new Date();
  if (!(state.history[todayKey(d)]?.reviews > 0)) d.setDate(d.getDate() - 1);
  while (state.history[todayKey(d)]?.reviews > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

let lastHeaderCount = null;
function renderHeader() {
  const n = learnedCount();
  $('#hc-count').textContent = fmt(n);
  const t = day().learned;
  $('#hc-today').textContent = t > 0 ? `+${t} heute` : '';
  $('#hc-bar').style.width = `${milestoneInfo(n).frac * 100}%`;
  if (lastHeaderCount !== null && n > lastHeaderCount) {
    const c = $('.counter');
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
    const passed = MILESTONES.find((m) => m > lastHeaderCount && m <= n);
    if (passed) toast(`Meilenstein erreicht: ${fmt(passed)} Wörter! 🎉`);
  }
  lastHeaderCount = n;
}

// ---------- Lernlogik (Leitner-System) ----------
function setBox(word, box) {
  const wasKnown = word.box >= KNOWN_BOX;
  word.box = Math.max(0, Math.min(MAX_BOX, box));
  word.due = Date.now() + INTERVALS[word.box] * DAY;
  const isKnown = word.box >= KNOWN_BOX;
  if (!wasKnown && isKnown) {
    word.learnedAt ||= Date.now();
    day().learned++;
  } else if (wasKnown && !isKnown) {
    day().learned--;
  }
}

function grade(word, result) {
  const d = day();
  d.reviews++;
  if (word.box === 0 && !word.seen) {
    word.seen = true;
    d.newSeen++;
  }
  if (result === 'known') {
    word.correct++;
    setBox(word, Math.max(word.box, 3));
  } else if (result === 'ok') {
    word.correct++;
    setBox(word, word.box + 1);
  } else {
    word.wrong++;
    setBox(word, word.box > 0 ? 1 : 0);
    word.due = Date.now();
  }
  save();
  renderHeader();
}

function buildSession() {
  const due = dueWords().sort((a, b) => a.due - b.due);
  const allowedNew = Math.max(0, state.settings.newPerDay - day().newSeen);
  const fresh = newWords().slice(0, allowedNew);
  session = { queue: [...due, ...fresh].map((w) => w.id), revealed: false, done: 0, correct: 0 };
}

// ---------- Ansichten ----------
const routes = {
  dashboard: renderDashboard,
  lernen: renderLearn,
  vokabeln: renderVocab,
  podcasts: renderPodcasts,
  aufgaben: renderTasks,
  aufgabe: renderTask,
};

function currentRoute() {
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: routes[name] ? name : 'dashboard', arg: arg && decodeURIComponent(arg) };
}

function render() {
  const { name, arg } = currentRoute();
  document.querySelectorAll('.tabs a').forEach((a) => {
    const r = a.dataset.route;
    a.classList.toggle('active', r === name || (r === 'aufgaben' && name === 'aufgabe'));
  });
  renderHeader();
  routes[name](arg);
  stopPollingIfIdle();
}

function renderDashboard() {
  const n = learnedCount();
  const { next, frac } = milestoneInfo(n);
  const d = day();
  const totals = Object.values(state.history).reduce(
    (a, h) => ({ heard: a.heard + (h.heard || 0), written: a.written + (h.written || 0), listenSec: a.listenSec + (h.listenSec || 0) }),
    { heard: 0, written: 0, listenSec: 0 }
  );
  const training = state.vocab.filter((w) => w.box > 0 && w.box < KNOWN_BOX).length;
  const dueCount = dueWords().length;
  const newToday = Math.min(newWords().length, Math.max(0, state.settings.newPerDay - d.newSeen));
  const openTasks = state.tasks.filter((t) => !t.done);
  const hint = [...COVERAGE_HINTS].reverse().find(([m]) => n >= m);
  const nextHint = COVERAGE_HINTS.find(([m]) => n < m);

  view.innerHTML = `
    <section class="card hero">
      <div class="hero-num">${fmt(n)}</div>
      <div class="hero-label">französische Wörter gelernt</div>
      <div class="progress"><div style="width:${frac * 100}%"></div></div>
      <div class="muted">Noch <strong>${fmt(next - n)}</strong> bis zum Meilenstein <strong>${fmt(next)}</strong>
        ${d.learned > 0 ? ` · <span style="color:var(--good);font-weight:700">+${d.learned} heute</span>` : ''}</div>
      <div class="milestones">${MILESTONES.slice(0, 9)
        .map((m) => `<span class="badge ${n >= m ? 'good' : ''}">${fmt(m)}</span>`)
        .join('')}</div>
      <p class="muted small" style="margin-top:12px">
        ${hint ? `Mit deinem Wortschatz erreichst du ${esc(hint[1])}. ` : ''}
        ${nextHint ? `Ab ${fmt(nextHint[0])} Wörtern: ${esc(nextHint[1])}.` : ''}
      </p>
      <div class="row" style="justify-content:center;margin-top:10px">
        <a class="btn big" href="#/lernen">Jetzt lernen${dueCount + newToday ? ` (${dueCount + newToday})` : ''}</a>
        ${openTasks[0] ? `<a class="btn big ghost" href="#/aufgabe/${openTasks[0].id}">Hör-Aufgabe fortsetzen</a>` : `<a class="btn big ghost" href="#/podcasts">Podcast hören</a>`}
      </div>
    </section>

    <section class="grid" style="margin-bottom:16px">
      ${stat(fmt(state.vocab.length), 'Wörter im Wortschatz')}
      ${stat(fmt(training), 'Wörter im Training')}
      ${stat(fmt(dueCount), 'heute zu wiederholen')}
      ${stat(fmt(streak()), 'Tage in Folge gelernt')}
      ${stat(fmt(totals.heard), 'Wörter in Podcasts gehört')}
      ${stat(fmt(totals.written), 'Wörter selbst geschrieben')}
      ${stat(fmtDuration(totals.listenSec) || '0 min', 'Hörzeit gesamt')}
      ${stat(`${state.tasks.filter((t) => t.done).length} / ${state.tasks.length}`, 'Hör-Aufgaben erledigt')}
    </section>

    <section class="card">
      <h2>Einstellungen</h2>
      <div class="row">
        <label class="field">
          <span>Neue Wörter pro Tag</span>
          <input type="number" min="0" max="100" value="${state.settings.newPerDay}" data-setting="newPerDay" style="width:110px">
        </label>
        <label class="field">
          <span>Abfragerichtung</span>
          <select data-setting="direction">
            <option value="fr-de" ${state.settings.direction === 'fr-de' ? 'selected' : ''}>Französisch → Deutsch</option>
            <option value="de-fr" ${state.settings.direction === 'de-fr' ? 'selected' : ''}>Deutsch → Französisch</option>
            <option value="mix" ${state.settings.direction === 'mix' ? 'selected' : ''}>Gemischt</option>
          </select>
        </label>
      </div>
      <p class="muted small">Ein Wort zählt als <strong>gelernt</strong>, sobald du es an zwei verschiedenen Tagen richtig gewusst hast
        (oder mit „Kenne ich schon“ markierst). Vergisst du es wieder, wird es abgezogen – die Zahl bleibt ehrlich.</p>
    </section>`;
}

const stat = (num, label) => `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div></div>`;

function renderLearn() {
  if (!session || !session.queue.length) buildSession();
  const word = state.vocab.find((w) => w.id === session.queue[0]);
  if (!word) {
    view.innerHTML = `
      <section class="card flash">
        <div class="flash-word">C'est fini ! 🎉</div>
        <p class="flash-answer">${session.done ? `${session.done} Karten geübt, ${session.correct} gewusst.` : 'Heute ist nichts mehr fällig.'}</p>
        <p class="muted">Gelernt insgesamt: <strong>${fmt(learnedCount())}</strong> Wörter.
          ${newWords().length ? `Noch ${fmt(newWords().length)} neue Wörter im Wortschatz.` : ''}</p>
        <div class="flash-actions">
          ${newWords().length ? '<button class="btn" data-action="more-new">10 weitere neue Wörter</button>' : ''}
          <a class="btn ghost" href="#/podcasts">Podcast hören</a>
        </div>
      </section>`;
    session = null;
    return;
  }
  const dir = state.settings.direction === 'mix' ? (word.id.charCodeAt(word.id.length - 1) % 2 ? 'fr-de' : 'de-fr') : state.settings.direction;
  const front = dir === 'fr-de' ? word.fr : word.de;
  const back = dir === 'fr-de' ? word.de : word.fr;
  const isNew = word.box === 0;
  view.innerHTML = `
    <div class="row between muted small" style="margin-bottom:8px">
      <span>Noch ${session.queue.length} Karte${session.queue.length === 1 ? '' : 'n'}</span>
      <span>${isNew ? '<span class="badge warn">neu</span>' : `<span class="badge">Box ${word.box}</span>`}</span>
    </div>
    <section class="card flash">
      <div class="flash-word">${esc(front)}
        ${dir === 'fr-de' ? `<button class="iconbtn" data-action="speak" data-text="${esc(word.fr)}" title="Aussprache">🔊</button>` : ''}</div>
      ${
        session.revealed
          ? `<p class="flash-answer">${esc(back)}
              ${dir === 'de-fr' ? `<button class="iconbtn" data-action="speak" data-text="${esc(word.fr)}" title="Aussprache">🔊</button>` : ''}</p>
             <div class="flash-actions">
               <button class="btn bad" data-action="grade" data-result="wrong">✗ Nicht gewusst</button>
               <button class="btn good" data-action="grade" data-result="ok">✓ Gewusst</button>
             </div>`
          : `<div class="flash-actions">
               <button class="btn big" data-action="reveal">Antwort zeigen</button>
               ${isNew ? '<button class="btn ghost" data-action="grade" data-result="known" title="Zählt sofort als gelernt">Kenne ich schon</button>' : ''}
             </div>`
      }
    </section>
    <p class="muted small" style="text-align:center">Tastatur: Leertaste = Antwort zeigen · 1 = nicht gewusst · 2 = gewusst</p>`;
}

function renderVocab() {
  const filter = sessionStorage.getItem('vocab-filter') || 'all';
  const q = sessionStorage.getItem('vocab-q') || '';
  view.innerHTML = `
    <section class="card">
      <h2>Wort hinzufügen</h2>
      <form class="row" data-form="add-word">
        <input class="grow" type="text" name="fr" placeholder="französisch, z. B. la maison" required autocomplete="off" lang="fr">
        <input class="grow" type="text" name="de" placeholder="deutsch, z. B. das Haus" required autocomplete="off">
        <button class="btn">Hinzufügen</button>
      </form>
      <details style="margin-top:12px">
        <summary>Mehrere Wörter auf einmal importieren</summary>
        <form data-form="import-words" style="margin-top:10px">
          <textarea name="text" placeholder="Ein Wort pro Zeile: französisch = deutsch&#10;la pomme = der Apfel&#10;courir = laufen"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn">Importieren</button>
          <span class="muted small">Trennzeichen: = ; | Tab oder „ - “</span></div>
        </form>
      </details>
    </section>
    <section class="card">
      <div class="row between">
        <h2 style="margin:0">Wortschatz <span class="muted">(${fmt(state.vocab.length)})</span></h2>
        <div class="row">
          <input type="search" placeholder="Suchen…" value="${esc(q)}" data-input="vocab-q">
          <select data-input="vocab-filter">
            ${[
              ['all', 'Alle'],
              ['learned', 'Gelernt'],
              ['training', 'Im Training'],
              ['new', 'Neu'],
            ]
              .map(([v, l]) => `<option value="${v}" ${filter === v ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <ul class="list" id="vocab-list" style="margin-top:10px"></ul>
      <div class="row" style="margin-top:14px">
        <button class="btn ghost small" data-action="export">Sicherung herunterladen</button>
        <label class="btn ghost small">Sicherung laden<input type="file" accept="application/json" data-input="import-backup" hidden></label>
      </div>
    </section>`;
  renderVocabList();
}

function renderVocabList() {
  const list = $('#vocab-list');
  if (!list) return;
  const filter = sessionStorage.getItem('vocab-filter') || 'all';
  const q = T.stripAccents((sessionStorage.getItem('vocab-q') || '').toLowerCase());
  const items = state.vocab
    .filter((w) =>
      filter === 'learned' ? w.box >= KNOWN_BOX : filter === 'training' ? w.box > 0 && w.box < KNOWN_BOX : filter === 'new' ? w.box === 0 : true
    )
    .filter((w) => !q || T.stripAccents(`${w.fr} ${w.de}`.toLowerCase()).includes(q))
    .sort((a, b) => b.added - a.added || a.fr.localeCompare(b.fr, 'fr'));
  const shown = items.slice(0, 300);
  list.innerHTML =
    shown
      .map(
        (w) => `<li>
          <button class="iconbtn" data-action="speak" data-text="${esc(w.fr)}" title="Aussprache">🔊</button>
          <div class="grow"><span class="word-fr" lang="fr">${esc(w.fr)}</span> <span class="muted">– ${esc(w.de)}</span></div>
          <span class="badge ${w.box >= KNOWN_BOX ? 'good' : w.box === 0 ? 'warn' : ''}">${w.box >= KNOWN_BOX ? 'gelernt' : w.box === 0 ? 'neu' : 'Training'}</span>
          <span class="muted small hide-sm">${esc(w.source || '')}</span>
          <button class="iconbtn" data-action="delete-word" data-id="${w.id}" title="Löschen">🗑</button>
        </li>`
      )
      .join('') +
    (items.length > shown.length ? `<li class="muted">… und ${fmt(items.length - shown.length)} weitere (Suche benutzen)</li>` : '') +
    (!items.length ? '<li class="muted">Keine Wörter gefunden.</li>' : '');
}

function addWord(fr, de, source) {
  fr = fr.trim();
  de = de.trim();
  if (!fr || !de) return false;
  if (state.vocab.some((w) => T.normalize(w.fr) === T.normalize(fr))) return false;
  state.vocab.push(makeWord(fr, de, source));
  return true;
}

// ---------- Podcasts ----------
async function loadPodcasts() {
  try {
    podcasts = await api('/api/podcasts');
  } catch {
    podcasts = [];
  }
}
const allEpisodes = () => podcasts.flatMap((f) => f.episodes.map((e) => ({ ...e, feedTitle: f.title, feedImage: f.image })));
const findEpisode = (id) => allEpisodes().find((e) => e.id === id);
const anyDownloading = () => podcasts.some((f) => f.episodes.some((e) => e.download && !e.download.error));

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    await loadPodcasts();
    const { name } = currentRoute();
    if (name === 'podcasts') renderFeeds();
    if (name === 'aufgabe') render();
    stopPollingIfIdle();
  }, 1500);
}
function stopPollingIfIdle() {
  if (pollTimer && !anyDownloading()) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function renderPodcasts() {
  view.innerHTML = `
    <section class="card">
      <h2>Podcast suchen</h2>
      <form class="row" data-form="search">
        <input class="grow" type="search" name="q" placeholder="z. B. Journal en français facile" required>
        <button class="btn">Suchen</button>
      </form>
      <div class="row" style="margin-top:10px">
        <span class="muted small">Empfehlungen:</span>
        ${SUGGESTED_PODCASTS.map((s) => `<button class="chip" data-action="suggest" data-q="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <details style="margin-top:12px">
        <summary>RSS-Feed direkt eingeben</summary>
        <form class="row" data-form="feed-url" style="margin-top:10px">
          <input class="grow" type="url" name="url" placeholder="https://…/feed.xml" required>
          <button class="btn">Abonnieren</button>
        </form>
      </details>
      <div id="search-results"></div>
    </section>
    <div id="feeds"></div>`;
  renderSearchResults();
  renderFeeds();
}

function renderSearchResults() {
  const box = $('#search-results');
  if (!box) return;
  const subscribed = new Set(podcasts.map((p) => p.feedUrl));
  box.innerHTML = searchResults.length
    ? `<ul class="list" style="margin-top:14px">${searchResults
        .map(
          (r) => `<li>
            <img src="${esc(r.image)}" alt="" width="48" height="48" style="border-radius:8px">
            <div class="grow"><div class="ep-title">${esc(r.title)}</div><div class="muted small">${esc(r.author)} · ${esc(r.genre || '')}</div></div>
            ${
              subscribed.has(r.feedUrl)
                ? '<span class="badge good">abonniert</span>'
                : `<button class="btn small" data-action="subscribe" data-url="${esc(r.feedUrl)}">Abonnieren</button>`
            }
          </li>`
        )
        .join('')}</ul>`
    : '';
}

function renderFeeds() {
  const box = $('#feeds');
  if (!box) return;
  if (!podcasts.length) {
    box.innerHTML = `<section class="card muted">Noch keine Podcasts abonniert. Suche oben nach einem Podcast – zum Einstieg eignet sich
      <em>Journal en français facile</em> (RFI, 10 Minuten Nachrichten in einfachem Französisch).</section>`;
    return;
  }
  const taskByEp = new Map(state.tasks.map((t) => [t.episodeId, t]));
  box.innerHTML = podcasts
    .map((f) => {
      const limit = Number(sessionStorage.getItem(`feed-limit-${f.id}`)) || 8;
      return `<section class="card">
        <div class="feed-head">
          ${f.image ? `<img src="${esc(f.image)}" alt="">` : ''}
          <div class="grow"><h2 style="margin:0">${esc(f.title)}</h2><div class="muted small">${esc(f.author || '')} · ${f.episodes.length} Episoden</div></div>
          <button class="iconbtn" data-action="refresh-feed" data-id="${f.id}" title="Neue Episoden laden">⟳</button>
          <button class="iconbtn" data-action="remove-feed" data-id="${f.id}" title="Abo entfernen">🗑</button>
        </div>
        <ul class="list" style="margin-top:10px">
          ${f.episodes
            .slice(0, limit)
            .map((e) => episodeRow(e, taskByEp.get(e.id)))
            .join('')}
        </ul>
        ${f.episodes.length > limit ? `<button class="btn ghost small" data-action="more-episodes" data-id="${f.id}" data-limit="${limit + 10}">Weitere Episoden</button>` : ''}
      </section>`;
    })
    .join('');
}

function episodeRow(e, task) {
  const dl = e.download;
  let dlPart;
  if (e.file) dlPart = `<span class="badge good" title="Offline verfügbar">⬇ geladen</span>
      <button class="iconbtn" data-action="delete-file" data-id="${e.id}" title="Datei löschen">✕</button>`;
  else if (dl?.error) dlPart = `<span class="badge" style="color:var(--bad)" title="${esc(dl.error)}">Fehler</span>
      <button class="btn ghost small" data-action="download" data-id="${e.id}">Erneut</button>`;
  else if (dl) {
    const p = dl.total ? dl.received / dl.total : 0;
    dlPart = `<div class="dl-bar" title="${dl.total ? pct(p) : fmt(dl.received / 1e6) + ' MB'}"><div style="width:${dl.total ? p * 100 : 30}%"></div></div>`;
  } else dlPart = `<button class="btn ghost small" data-action="download" data-id="${e.id}">⬇ Laden</button>`;
  return `<li>
    <button class="iconbtn" data-action="play" data-id="${e.id}" title="Abspielen">▶</button>
    <div class="grow">
      <div class="ep-title">${esc(e.title)}</div>
      <div class="muted small">${fmtDate(e.pubDate)}${e.duration ? ` · ${fmtDuration(e.duration)}` : ''}</div>
    </div>
    ${dlPart}
    ${
      task
        ? `<a class="btn small ${task.done ? 'good' : 'ghost'}" href="#/aufgabe/${task.id}">${task.done ? '✓ Aufgabe' : 'Zur Aufgabe'}</a>`
        : `<button class="btn small" data-action="create-task" data-id="${e.id}">Als Aufgabe</button>`
    }
  </li>`;
}

// ---------- Player ----------
function playEpisode(ep, taskId = null) {
  if (!ep) return toast('Episode nicht gefunden – ist der Podcast noch abonniert?');
  const src = ep.file ? `/audio/${ep.file}` : ep.audioUrl;
  if (player.episode?.id !== ep.id) {
    audio.src = src;
    player.episode = ep;
    const task = state.tasks.find((t) => t.id === taskId) || state.tasks.find((t) => t.episodeId === ep.id);
    player.taskId = task?.id || null;
    if (task?.position) audio.currentTime = task.position;
  }
  audio.playbackRate = Number($('#speed').value);
  $('#player-title').textContent = `${ep.feedTitle ? ep.feedTitle + ' – ' : ''}${ep.title}`;
  $('#player').hidden = false;
  audio.play().catch(() => {});
}

let listenSaveCounter = 0;
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  if (player.lastTime !== null && !audio.paused) {
    const delta = t - player.lastTime;
    if (delta > 0 && delta < 3) {
      const real = delta / (audio.playbackRate || 1);
      day().listenSec += real;
      const task = state.tasks.find((x) => x.id === player.taskId);
      if (task) {
        task.listenSec = (task.listenSec || 0) + real;
        task.position = t;
        if (audio.duration) task.progress = Math.max(task.progress || 0, t / audio.duration);
        updateTaskProgressUI(task);
      }
      if (++listenSaveCounter % 20 === 0) save();
    }
  }
  player.lastTime = t;
});
audio.addEventListener('seeking', () => (player.lastTime = null));
audio.addEventListener('pause', () => save());
audio.addEventListener('ended', () => {
  const task = state.tasks.find((x) => x.id === player.taskId);
  if (task) {
    task.progress = 1;
    updateTaskProgressUI(task);
  }
  save();
});
$('#speed').addEventListener('change', (e) => (audio.playbackRate = Number(e.target.value)));

function updateTaskProgressUI(task) {
  const bar = document.getElementById(`task-progress-${task.id}`);
  if (!bar) return;
  bar.style.width = `${(task.progress || 0) * 100}%`;
  const label = document.getElementById(`task-listen-${task.id}`);
  if (label) label.textContent = `${pct(task.progress || 0)} gehört · ${fmtDuration(task.listenSec) || '0 min'} Hörzeit`;
}

// ---------- Aufgaben ----------
function createTask(ep) {
  const existing = state.tasks.find((t) => t.episodeId === ep.id);
  if (existing) return existing;
  const notes = ep.text || '';
  const task = {
    id: uid(),
    episodeId: ep.id,
    title: ep.title,
    feedTitle: ep.feedTitle,
    duration: ep.duration || 0,
    createdAt: Date.now(),
    transcript: T.countWords(notes) >= 120 ? notes : '',
    transcriptFromFeed: T.countWords(notes) >= 120,
    showNotes: notes,
    progress: 0,
    listenSec: 0,
    heard: null,
    cloze: null,
    answers: { topic: '', details: '', summary: '' },
    understood: 50,
    ignored: [],
    noted: '',
    done: false,
  };
  state.tasks.unshift(task);
  save();
  return task;
}

function renderTasks() {
  const open = state.tasks.filter((t) => !t.done);
  const done = state.tasks.filter((t) => t.done);
  const row = (t) => {
    const words = T.countWords(t.transcript);
    return `<li>
      <div class="grow">
        <a class="ep-title" href="#/aufgabe/${t.id}">${esc(t.title)}</a>
        <div class="muted small">${esc(t.feedTitle || '')} · ${pct(t.progress || 0)} gehört
          ${words ? ` · ${fmt(words)} Wörter Transkript` : ''}
          ${t.done ? ` · erledigt am ${fmtDate(t.doneAt)}` : ''}</div>
      </div>
      ${t.done ? '<span class="badge good">✓ erledigt</span>' : `<a class="btn small" href="#/aufgabe/${t.id}">Weiter</a>`}
    </li>`;
  };
  view.innerHTML = `
    <section class="card">
      <h2>Offene Hör-Aufgaben</h2>
      ${open.length ? `<ul class="list">${open.map(row).join('')}</ul>` : `<p class="muted">Keine offenen Aufgaben. Wähle unter <a href="#/podcasts">Podcasts</a> eine Episode und klicke auf „Als Aufgabe“.</p>`}
    </section>
    ${done.length ? `<section class="card"><h2>Erledigt</h2><ul class="list">${done.map(row).join('')}</ul></section>` : ''}`;
}

function renderTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) {
    view.innerHTML = `<section class="card">Aufgabe nicht gefunden. <a href="#/aufgaben">Zur Übersicht</a></section>`;
    return;
  }
  const ep = findEpisode(task.episodeId);
  const hasText = T.countWords(task.transcript) > 0;
  const known = knownSet();
  const a = hasText ? T.analyze(task.transcript, known) : null;
  // Wörter, die schon im Wortschatz sind (aber noch nicht gelernt), werden nicht erneut vorgeschlagen.
  const inVocab = T.buildKnownSet(state.vocab.map((w) => w.fr));
  const unknownAll = a ? a.unknown.filter((u) => !T.STOPWORDS.has(u.word) && u.word.length > 2) : [];
  const training = unknownAll.filter((u) => inVocab.has(u.word));
  const learnable = unknownAll.filter((u) => !inVocab.has(u.word) && !task.ignored.includes(u.word)).slice(0, 25);
  const writtenWords = T.countWords(Object.values(task.answers).join(' '));
  const heardWords = hasText ? a.tokens : Math.round((task.listenSec / 60) * WORDS_PER_MINUTE);
  let step = 0;
  const card = (title, done, body) => {
    step++;
    return `<section class="card ${done ? 'done' : ''}"><h2><span class="step-num">${done ? '✓' : step}</span>${title}</h2>${body}</section>`;
  };

  view.innerHTML = `
    <p><a href="#/aufgaben">← Alle Aufgaben</a></p>
    <h1>${esc(task.title)}</h1>
    <p class="muted">${esc(task.feedTitle || '')}${task.duration ? ` · ${fmtDuration(task.duration)}` : ''}
      ${task.done ? ' · <span class="badge good">erledigt</span>' : ''}</p>

    ${card(
      'Episode anhören',
      (task.progress || 0) >= 0.9,
      `<p class="muted">Höre die ganze Episode – ruhig zweimal. Beim ersten Mal nur zuhören, beim zweiten Mal Notizen machen.</p>
       <div class="row">
         <button class="btn" data-action="play-task" data-id="${task.id}" ${ep ? '' : 'disabled'}>▶ Abspielen</button>
         ${ep && !ep.file ? (ep.download && !ep.download.error ? '<span class="muted small">wird heruntergeladen…</span>' : `<button class="btn ghost" data-action="download" data-id="${ep.id}">⬇ Für offline laden</button>`) : ''}
         ${ep?.file ? '<span class="badge good">offline verfügbar</span>' : ''}
         ${!ep ? '<span class="muted small">Podcast ist nicht mehr abonniert.</span>' : ''}
       </div>
       <div class="progress good" style="margin:14px 0 6px;max-width:none"><div id="task-progress-${task.id}" style="width:${(task.progress || 0) * 100}%"></div></div>
       <div class="muted small" id="task-listen-${task.id}">${pct(task.progress || 0)} gehört · ${fmtDuration(task.listenSec) || '0 min'} Hörzeit</div>`
    )}

    ${card(
      'Transkript & Wortanalyse',
      hasText,
      `${
        task.transcriptFromFeed
          ? '<p class="note">Der Text wurde aus den Shownotes des Feeds übernommen. Prüfe, ob er wirklich das Gesprochene wiedergibt – sonst ersetze ihn.</p>'
          : '<p class="muted">Viele Lern-Podcasts veröffentlichen ein Transkript auf ihrer Webseite (z. B. RFI „Journal en français facile“). Füge es hier ein – daraus entstehen Wortanalyse, Hör-Check und Lückentext.</p>'
      }
       ${
         hasText
           ? `<div class="grid" style="margin:12px 0">
               <div class="stat"><div class="stat-num">${fmt(a.tokens)}</div><div class="stat-label">Wörter im Text</div></div>
               <div class="stat"><div class="stat-num">${fmt(a.unique)}</div><div class="stat-label">verschiedene Wörter</div></div>
               <div class="stat"><div class="stat-num" style="color:${a.coverage >= 0.9 ? 'var(--good)' : 'var(--primary)'}">${pct(a.coverage)}</div><div class="stat-label">davon kennst du</div></div>
               <div class="stat"><div class="stat-num">${fmt(a.unique - a.knownUnique)}</div><div class="stat-label">unbekannte Wörter</div></div>
             </div>
             <p class="muted small">Ab etwa 95 % bekannter Wörter versteht man einen Text ohne Wörterbuch. Gezählt werden nur deine <em>gelernten</em> Wörter; Formen werden grob erkannt, Eigennamen (${fmt(a.names.size)}) zählen als bekannt.</p>`
           : ''
       }
       <details ${hasText ? '' : 'open'}>
         <summary>${hasText ? 'Transkript bearbeiten' : 'Transkript einfügen'}</summary>
         <form data-form="transcript" data-id="${task.id}" style="margin-top:10px">
           <textarea name="text" lang="fr" style="min-height:180px" placeholder="Transkript der Episode hier einfügen…">${esc(task.transcript)}</textarea>
           <div class="row" style="margin-top:8px">
             <button class="btn">Speichern & analysieren</button>
             ${task.showNotes && !task.transcript ? `<button type="button" class="btn ghost" data-action="use-notes" data-id="${task.id}">Shownotes übernehmen</button>` : ''}
           </div>
         </form>
       </details>`
    )}

    ${card(
      'Neue Wörter sammeln',
      false,
      hasText
        ? learnable.length
          ? `<p class="muted">Die häufigsten unbekannten Wörter aus dem Transkript. Trage die Bedeutung ein und übernimm sie in deinen Wortschatz.</p>
             <ul class="list">${learnable
               .map(
                 (u) => `<li>
                   <button class="iconbtn" data-action="speak" data-text="${esc(u.word)}">🔊</button>
                   <span class="word-fr" lang="fr" style="min-width:8em">${esc(u.word)}</span>
                   <span class="badge">${u.count}×</span>
                   <form class="row grow" data-form="learn-word" data-word="${esc(u.word)}" data-task="${task.id}">
                     <input class="grow" type="text" name="de" placeholder="Bedeutung" autocomplete="off">
                     <button class="btn small">+</button>
                     <button type="button" class="iconbtn" data-action="ignore-word" data-word="${esc(u.word)}" data-task="${task.id}" title="Ignorieren">✕</button>
                   </form>
                 </li>`
               )
               .join('')}</ul>`
          + (training.length ? `<p class="muted small" style="margin-top:10px">Schon im Wortschatz, aber noch nicht gelernt: ${training
              .slice(0, 30)
              .map((u) => `<span lang="fr">${esc(u.word)}</span>`)
              .join(', ')} – diese Wörter kommen über „Lernen“ dran.</p>` : '')
          : '<p>Keine neuen Wörter mehr – alles ist schon in deinem Wortschatz. Très bien ! 👏</p>'
        : `<p class="muted">Schreib Wörter auf, die du beim Hören verstanden oder nachgeschlagen hast – eins pro Zeile, <code>mot = Bedeutung</code>.</p>
           <form data-form="noted-words" data-task="${task.id}">
             <textarea name="text" lang="fr" placeholder="la grève = der Streik&#10;le chômage = die Arbeitslosigkeit">${esc(task.noted)}</textarea>
             <div class="row" style="margin-top:8px"><button class="btn">In den Wortschatz übernehmen</button></div>
           </form>`
    )}

    ${hasText ? card('Hör-Check: Welche Wörter kamen vor?', !!task.heard, heardCheckBody(task)) : ''}
    ${hasText ? card('Lückentext', !!task.cloze, clozeBody(task)) : ''}

    ${card(
      'Verständnisfragen',
      !!(task.answers.topic && task.answers.summary),
      `<p class="muted">Antworte möglichst auf Französisch. Jedes Wort, das du schreibst, zählt.</p>
       ${question(task, 'topic', 'De quoi parle l\'épisode ?', 'Worum geht es? (1 Satz)')}
       ${question(task, 'details', 'Qu\'est-ce que tu as retenu ?', 'Wer? Was? Wo? Wann? Zahlen, Namen, Details …')}
       ${question(task, 'summary', 'Résume l\'épisode en trois phrases.', 'Zusammenfassung in eigenen Worten')}
       <label class="field"><span>Wie viel hast du verstanden? <strong id="understood-val">${task.understood} %</strong></span>
         <input type="range" min="0" max="100" step="5" value="${task.understood}" data-input="understood" data-task="${task.id}" style="width:100%">
       </label>
       <p class="muted small">Geschrieben: <strong id="written-total">${fmt(writtenWords)}</strong> französische Wörter</p>`
    )}

    <section class="card ${task.done ? 'done' : ''}">
      <h2>Abschluss</h2>
      <div class="grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-num">${hasText ? '' : 'ca. '}${fmt(heardWords)}</div><div class="stat-label">Wörter gehört</div></div>
        <div class="stat"><div class="stat-num">${fmt(writtenWords)}</div><div class="stat-label">Wörter geschrieben</div></div>
        ${task.heard ? `<div class="stat"><div class="stat-num">${task.heard.score}/${task.heard.total}</div><div class="stat-label">Hör-Check</div></div>` : ''}
        ${task.cloze ? `<div class="stat"><div class="stat-num">${task.cloze.score}/${task.cloze.total}</div><div class="stat-label">Lückentext</div></div>` : ''}
      </div>
      ${
        task.done
          ? `<p>Erledigt am ${fmtDate(task.doneAt)}. Die gehörten und geschriebenen Wörter sind in deiner Statistik.</p>
             <button class="btn ghost small" data-action="reopen-task" data-id="${task.id}">Wieder öffnen</button>`
          : `<div class="row"><button class="btn big" data-action="finish-task" data-id="${task.id}">Aufgabe abschließen</button>
             <button class="btn ghost small" data-action="delete-task" data-id="${task.id}">Aufgabe löschen</button></div>`
      }
    </section>`;
}

function question(task, key, fr, de) {
  return `<label class="field"><span lang="fr">${esc(fr)}</span>
    <textarea lang="fr" data-input="answer" data-key="${key}" data-task="${task.id}" placeholder="${esc(de)}">${esc(task.answers[key])}</textarea>
    <div class="wc" id="wc-${key}">${fmt(T.countWords(task.answers[key]))} Wörter</div></label>`;
}

function heardCheckBody(task) {
  const items = T.makeHeardCheck(task.transcript, state.vocab.map((w) => w.fr).concat(BASE_WORDS.map((w) => w.fr)), task.id);
  const res = task.heard;
  return `<p class="muted">Kreuze an, welche Wörter du in der Episode gehört hast. Nicht schummeln – erst hören, dann ankreuzen!</p>
    <form data-form="heard" data-task="${task.id}">
      <div class="check-grid">${items
        .map((it, i) => {
          const checked = res ? res.picked.includes(it.word) : false;
          const cls = res ? (checked === it.inText ? 'right' : 'wrong') : '';
          return `<label class="check-item ${cls}"><input type="checkbox" name="w${i}" value="${esc(it.word)}" ${checked ? 'checked' : ''} ${res ? 'disabled' : ''}>
            <span lang="fr">${esc(it.word)}</span>${res && it.inText ? ' <span class="muted small">(kam vor)</span>' : ''}</label>`;
        })
        .join('')}</div>
      <div class="row" style="margin-top:12px">
        ${res ? `<strong>${res.score} von ${res.total} richtig</strong><button type="button" class="btn ghost small" data-action="reset-heard" data-task="${task.id}">Nochmal</button>` : '<button class="btn">Auswerten</button>'}
      </div>
    </form>`;
}

function clozeBody(task) {
  const items = T.makeCloze(task.transcript, 6, task.id);
  if (!items.length) return '<p class="muted">Im Transkript wurden keine passenden Sätze gefunden.</p>';
  const res = task.cloze;
  return `<p class="muted">Spiele die Episode nochmal ab und ergänze die fehlenden Wörter. Akzente sind beim Prüfen egal.</p>
    <form data-form="cloze" data-task="${task.id}">
      ${items
        .map((it, i) => {
          const given = res?.given[i] ?? '';
          const ok = res && T.looseEqual(given, it.answer);
          return `<div class="cloze" lang="fr">${esc(it.before)}<input type="text" name="c${i}" value="${esc(given)}" autocomplete="off" autocapitalize="off" spellcheck="false"
            class="${res ? (ok ? 'right' : 'wrong') : ''}" ${res ? 'disabled' : ''}>${res && !ok ? ` <strong>(${esc(it.answer)})</strong>` : ''}${esc(it.after)}</div>`;
        })
        .join('')}
      <div class="row">${
        res
          ? `<strong>${res.score} von ${res.total} richtig</strong><button type="button" class="btn ghost small" data-action="reset-cloze" data-task="${task.id}">Nochmal</button>`
          : '<button class="btn">Prüfen</button>'
      }</div>
    </form>`;
}

function parseWordLines(text) {
  return text
    .split('\n')
    .map((line) => line.split(/\s*(?:=|;|\||\t| - | – )\s*/))
    .filter((p) => p.length >= 2 && p[0].trim() && p[1].trim())
    .map(([fr, ...rest]) => ({ fr: fr.trim(), de: rest.join(', ').trim() }));
}

// ---------- Aktionen ----------
const actions = {
  reveal() {
    if (!session) return;
    session.revealed = true;
    renderLearn();
  },
  grade(el) {
    if (!session) return;
    const word = state.vocab.find((w) => w.id === session.queue[0]);
    if (!word) return;
    const result = el.dataset.result;
    grade(word, result);
    session.queue.shift();
    session.done++;
    if (result === 'wrong') session.queue.splice(Math.min(3, session.queue.length), 0, word.id);
    else session.correct++;
    session.revealed = false;
    renderLearn();
  },
  'more-new'() {
    const fresh = newWords().slice(0, 10);
    session = { queue: fresh.map((w) => w.id), revealed: false, done: 0, correct: 0 };
    renderLearn();
  },
  speak: (el) => speak(el.dataset.text),
  'delete-word'(el) {
    const w = state.vocab.find((x) => x.id === el.dataset.id);
    if (!w || !confirm(`„${w.fr}“ löschen?`)) return;
    if (w.box >= KNOWN_BOX) day().learned--;
    state.vocab = state.vocab.filter((x) => x.id !== w.id);
    save();
    renderHeader();
    renderVocabList();
  },
  export() {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mot-a-mot-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  async suggest(el) {
    const input = $('[data-form="search"] input');
    input.value = el.dataset.q;
    await doSearch(el.dataset.q);
  },
  async subscribe(el) {
    el.disabled = true;
    el.textContent = 'Lade…';
    try {
      const feed = await api('/api/podcasts', { method: 'POST', body: { feedUrl: el.dataset.url } });
      await loadPodcasts();
      toast(`„${feed.title}“ abonniert`);
      renderSearchResults();
      renderFeeds();
    } catch (err) {
      toast(err.message);
      el.disabled = false;
      el.textContent = 'Abonnieren';
    }
  },
  async 'refresh-feed'(el) {
    try {
      await api(`/api/podcasts/${el.dataset.id}/refresh`, { method: 'POST' });
      await loadPodcasts();
      renderFeeds();
      toast('Episoden aktualisiert');
    } catch (err) {
      toast(err.message);
    }
  },
  async 'remove-feed'(el) {
    const f = podcasts.find((p) => p.id === el.dataset.id);
    if (!f || !confirm(`Abo „${f.title}“ und alle geladenen Episoden entfernen?`)) return;
    await api(`/api/podcasts/${f.id}`, { method: 'DELETE' });
    await loadPodcasts();
    renderFeeds();
  },
  'more-episodes'(el) {
    sessionStorage.setItem(`feed-limit-${el.dataset.id}`, el.dataset.limit);
    renderFeeds();
  },
  async download(el) {
    try {
      await api(`/api/episodes/${el.dataset.id}/download`, { method: 'POST' });
      await loadPodcasts();
      render();
      startPolling();
    } catch (err) {
      toast(err.message);
    }
  },
  async 'delete-file'(el) {
    if (player.episode?.id === el.dataset.id) actions['close-player']();
    await api(`/api/episodes/${el.dataset.id}/download`, { method: 'DELETE' });
    await loadPodcasts();
    renderFeeds();
  },
  play: (el) => playEpisode(findEpisode(el.dataset.id)),
  'play-task'(el) {
    const task = state.tasks.find((t) => t.id === el.dataset.id);
    playEpisode(findEpisode(task?.episodeId), task?.id);
  },
  'create-task'(el) {
    const ep = findEpisode(el.dataset.id);
    if (!ep) return;
    const task = createTask(ep);
    location.hash = `#/aufgabe/${task.id}`;
  },
  seek(el) {
    audio.currentTime = Math.max(0, audio.currentTime + Number(el.dataset.delta));
  },
  'close-player'() {
    audio.pause();
    save();
    audio.removeAttribute('src');
    audio.load();
    player.episode = null;
    player.taskId = null;
    $('#player').hidden = true;
  },
  'use-notes'(el) {
    const task = state.tasks.find((t) => t.id === el.dataset.id);
    task.transcript = task.showNotes;
    task.transcriptFromFeed = true;
    save();
    render();
  },
  'ignore-word'(el) {
    const task = state.tasks.find((t) => t.id === el.dataset.task);
    task.ignored.push(el.dataset.word);
    save();
    render();
  },
  'reset-heard'(el) {
    state.tasks.find((t) => t.id === el.dataset.task).heard = null;
    save();
    render();
  },
  'reset-cloze'(el) {
    state.tasks.find((t) => t.id === el.dataset.task).cloze = null;
    save();
    render();
  },
  'finish-task'(el) {
    const task = state.tasks.find((t) => t.id === el.dataset.id);
    if ((task.progress || 0) < 0.5 && !confirm('Du hast weniger als die Hälfte der Episode gehört. Trotzdem abschließen?')) return;
    const heard = T.countWords(task.transcript) || Math.round((task.listenSec / 60) * WORDS_PER_MINUTE);
    const written = T.countWords(Object.values(task.answers).join(' '));
    task.done = true;
    task.doneAt = Date.now();
    task.credited = { heard, written, day: todayKey() };
    day().heard += heard;
    day().written += written;
    save();
    toast(`Super! +${fmt(heard)} Wörter gehört, +${fmt(written)} geschrieben`);
    render();
  },
  'reopen-task'(el) {
    const task = state.tasks.find((t) => t.id === el.dataset.id);
    if (task.credited) {
      const d = day(task.credited.day);
      d.heard -= task.credited.heard;
      d.written -= task.credited.written;
      task.credited = null;
    }
    task.done = false;
    save();
    render();
  },
  'delete-task'(el) {
    if (!confirm('Aufgabe löschen? Deine Antworten gehen verloren.')) return;
    state.tasks = state.tasks.filter((t) => t.id !== el.dataset.id);
    save();
    location.hash = '#/aufgaben';
  },
};

async function doSearch(q) {
  const box = $('#search-results');
  box.innerHTML = '<p class="muted" style="margin-top:12px">Suche…</p>';
  try {
    searchResults = await api(`/api/podcasts/search?q=${encodeURIComponent(q)}`);
    if (!searchResults.length) box.innerHTML = '<p class="muted" style="margin-top:12px">Nichts gefunden.</p>';
    else renderSearchResults();
  } catch (err) {
    box.innerHTML = `<p class="muted" style="margin-top:12px">Suche fehlgeschlagen: ${esc(err.message)}</p>`;
  }
}

const forms = {
  'add-word'(form) {
    const ok = addWord(form.fr.value, form.de.value, 'eigene');
    if (!ok) return toast('Wort ist schon im Wortschatz.');
    save();
    form.reset();
    form.fr.focus();
    toast('Wort hinzugefügt');
    renderVocabList();
  },
  'import-words'(form) {
    const items = parseWordLines(form.text.value);
    const added = items.filter((w) => addWord(w.fr, w.de, 'Import')).length;
    save();
    toast(`${added} von ${items.length} Wörtern importiert`);
    form.reset();
    renderVocab();
  },
  search: (form) => doSearch(form.q.value.trim()),
  'feed-url'(form) {
    const btn = form.querySelector('button');
    btn.dataset.url = form.url.value.trim();
    actions.subscribe(btn);
  },
  transcript(form) {
    const task = state.tasks.find((t) => t.id === form.dataset.id);
    task.transcript = form.text.value.trim();
    task.transcriptFromFeed = false;
    task.heard = null;
    task.cloze = null;
    save();
    render();
  },
  'learn-word'(form) {
    const de = form.de.value.trim();
    if (!de) return form.de.focus();
    if (!addWord(form.dataset.word, de, 'Podcast')) toast('Wort ist schon im Wortschatz.');
    else toast(`„${form.dataset.word}“ wird ab jetzt geübt`);
    const task = state.tasks.find((t) => t.id === form.dataset.task);
    task.ignored.push(form.dataset.word);
    save();
    render();
  },
  'noted-words'(form) {
    const task = state.tasks.find((t) => t.id === form.dataset.task);
    task.noted = form.text.value;
    const items = parseWordLines(form.text.value);
    const added = items.filter((w) => addWord(w.fr, w.de, 'Podcast')).length;
    save();
    toast(items.length ? `${added} neue Wörter übernommen` : 'Format: mot = Bedeutung');
  },
  heard(form) {
    const task = state.tasks.find((t) => t.id === form.dataset.task);
    const items = T.makeHeardCheck(task.transcript, state.vocab.map((w) => w.fr).concat(BASE_WORDS.map((w) => w.fr)), task.id);
    const picked = [...form.querySelectorAll('input:checked')].map((i) => i.value);
    const score = items.filter((it) => picked.includes(it.word) === it.inText).length;
    task.heard = { picked, score, total: items.length };
    save();
    render();
  },
  cloze(form) {
    const task = state.tasks.find((t) => t.id === form.dataset.task);
    const items = T.makeCloze(task.transcript, 6, task.id);
    const given = items.map((_, i) => form[`c${i}`].value);
    const score = items.filter((it, i) => T.looseEqual(given[i], it.answer)).length;
    task.cloze = { given, score, total: items.length };
    save();
    render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    const v = el.type === 'number' ? Math.max(0, Math.min(100, Number(el.value) || 0)) : el.value;
    state.settings[el.dataset.setting] = v;
    session = null;
    save();
    return;
  }
  switch (el.dataset.input) {
    case 'vocab-q':
    case 'vocab-filter':
      sessionStorage.setItem(el.dataset.input, el.value);
      renderVocabList();
      break;
    case 'answer': {
      const task = state.tasks.find((t) => t.id === el.dataset.task);
      task.answers[el.dataset.key] = el.value;
      $(`#wc-${el.dataset.key}`).textContent = `${fmt(T.countWords(el.value))} Wörter`;
      $('#written-total').textContent = fmt(T.countWords(Object.values(task.answers).join(' ')));
      save();
      break;
    }
    case 'understood': {
      const task = state.tasks.find((t) => t.id === el.dataset.task);
      task.understood = Number(el.value);
      $('#understood-val').textContent = `${el.value} %`;
      save();
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.dataset.input !== 'import-backup') return;
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.vocab)) throw new Error();
    if (!confirm(`Sicherung mit ${data.vocab.length} Wörtern laden? Der aktuelle Stand wird ersetzt.`)) return;
    state = data;
    session = null;
    save();
    render();
    toast('Sicherung geladen');
  } catch {
    toast('Ungültige Sicherungsdatei');
  }
});

document.addEventListener('keydown', (e) => {
  if (currentRoute().name !== 'lernen' || !session || e.target.matches('input, textarea, select')) return;
  if (e.key === ' ' && !session.revealed) {
    e.preventDefault();
    actions.reveal();
  } else if (session.revealed && (e.key === '1' || e.key === '2')) {
    actions.grade({ dataset: { result: e.key === '1' ? 'wrong' : 'ok' } });
  }
});

window.addEventListener('hashchange', render);

// ---------- Start ----------
await loadState();
await loadPodcasts();
render();
if (anyDownloading()) startPolling();
