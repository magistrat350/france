// Mot à mot – lokaler Server: liefert die App aus, speichert den Lernstand,
// sucht/abonniert Podcasts und lädt Episoden zum Offline-Hören herunter.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseFeed } from './lib/feed.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PODCASTS_FILE = path.join(DATA_DIR, 'podcasts.json');
const PORT = Number(process.env.PORT) || 3000;
const MAX_EPISODES = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
};

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

// ---------- Speicher ----------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

let podcasts = [];
const savePodcasts = () => writeJson(PODCASTS_FILE, podcasts);
const downloads = new Map(); // episodeId -> { received, total, error }

// ---------- Podcasts ----------

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MotAMot/1.0 (podcast reader)' } });
  if (!res.ok) throw new Error(`Feed nicht erreichbar (HTTP ${res.status})`);
  return res.text();
}

async function searchPodcasts(term) {
  const url = `https://itunes.apple.com/search?media=podcast&limit=20&term=${encodeURIComponent(term)}`;
  const data = JSON.parse(await fetchText(url));
  return (data.results || [])
    .filter((r) => r.feedUrl)
    .map((r) => ({
      title: r.collectionName,
      author: r.artistName,
      image: r.artworkUrl100,
      feedUrl: r.feedUrl,
      genre: r.primaryGenreName,
    }));
}

function mergeEpisodes(feedId, parsed, existing = []) {
  const known = new Map(existing.map((e) => [e.id, e]));
  return parsed.episodes.slice(0, MAX_EPISODES).map((ep) => {
    const id = hash(`${feedId}|${ep.guid}`);
    const old = known.get(id);
    return { ...ep, id, feedId, file: old?.file || null };
  });
}

async function subscribe(feedUrl) {
  const id = hash(feedUrl);
  const parsed = parseFeed(await fetchText(feedUrl));
  if (!parsed.episodes.length) throw new Error('Im Feed wurden keine Audio-Episoden gefunden.');
  const existing = podcasts.find((p) => p.id === id);
  const feed = {
    id,
    feedUrl,
    title: parsed.title || feedUrl,
    author: parsed.author,
    description: parsed.description,
    image: parsed.image,
    updatedAt: new Date().toISOString(),
    episodes: mergeEpisodes(id, parsed, existing?.episodes),
  };
  podcasts = existing ? podcasts.map((p) => (p.id === id ? feed : p)) : [...podcasts, feed];
  await savePodcasts();
  return feed;
}

function findEpisode(episodeId) {
  for (const feed of podcasts) {
    const ep = feed.episodes.find((e) => e.id === episodeId);
    if (ep) return { feed, ep };
  }
  return null;
}

function extensionFor(ep) {
  const fromUrl = path.extname(new URL(ep.audioUrl).pathname).toLowerCase();
  if (MIME[fromUrl]?.startsWith('audio/')) return fromUrl;
  if (ep.audioType?.includes('mp4') || ep.audioType?.includes('m4a')) return '.m4a';
  return '.mp3';
}

async function downloadEpisode(episodeId) {
  const found = findEpisode(episodeId);
  if (!found) throw new Error('Episode nicht gefunden');
  const { ep } = found;
  if (ep.file || downloads.has(episodeId)) return;

  const status = { received: 0, total: 0, error: null };
  downloads.set(episodeId, status);
  const file = `${episodeId}${extensionFor(ep)}`;
  const target = path.join(AUDIO_DIR, file);
  const tmp = `${target}.part`;

  (async () => {
    try {
      const res = await fetch(ep.audioUrl, { headers: { 'User-Agent': 'MotAMot/1.0 (podcast reader)' } });
      if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
      status.total = Number(res.headers.get('content-length')) || 0;
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => (status.received += chunk.length));
      await pipeline(body, fs.createWriteStream(tmp));
      await fsp.rename(tmp, target);
      ep.file = file;
      await savePodcasts();
      downloads.delete(episodeId);
    } catch (err) {
      status.error = err.message;
      await fsp.rm(tmp, { force: true });
    }
  })();
}

async function deleteEpisodeFile(episodeId) {
  const found = findEpisode(episodeId);
  if (!found?.ep.file) return;
  await fsp.rm(path.join(AUDIO_DIR, found.ep.file), { force: true });
  found.ep.file = null;
  await savePodcasts();
}

// ---------- HTTP ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Anfrage zu groß');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(req, res, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    return send(res, 404, 'Nicht gefunden');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function safeJoin(base, rel) {
  const full = path.join(base, path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
  return full.startsWith(base) ? full : null;
}

function podcastSummary() {
  return podcasts.map((feed) => ({
    ...feed,
    episodes: feed.episodes.map((ep) => {
      const dl = downloads.get(ep.id);
      return { ...ep, download: dl ? { ...dl } : null };
    }),
  }));
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/state' && method === 'GET') {
    return sendJson(res, 200, await readJson(STATE_FILE, null));
  }
  if (pathname === '/api/state' && method === 'PUT') {
    await writeJson(STATE_FILE, await readBody(req));
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/podcasts/search' && method === 'GET') {
    const term = url.searchParams.get('q')?.trim();
    if (!term) return sendJson(res, 400, { error: 'Suchbegriff fehlt' });
    return sendJson(res, 200, await searchPodcasts(term));
  }
  if (pathname === '/api/podcasts' && method === 'GET') {
    return sendJson(res, 200, podcastSummary());
  }
  if (pathname === '/api/podcasts' && method === 'POST') {
    const { feedUrl } = await readBody(req);
    if (!/^https?:\/\//i.test(feedUrl || '')) return sendJson(res, 400, { error: 'Ungültige Feed-URL' });
    return sendJson(res, 200, await subscribe(feedUrl.trim()));
  }

  let m = pathname.match(/^\/api\/podcasts\/([a-f0-9]+)(\/refresh)?$/);
  if (m && method === 'POST' && m[2]) {
    const feed = podcasts.find((p) => p.id === m[1]);
    if (!feed) return sendJson(res, 404, { error: 'Podcast nicht gefunden' });
    return sendJson(res, 200, await subscribe(feed.feedUrl));
  }
  if (m && method === 'DELETE' && !m[2]) {
    const feed = podcasts.find((p) => p.id === m[1]);
    if (feed) {
      for (const ep of feed.episodes) if (ep.file) await fsp.rm(path.join(AUDIO_DIR, ep.file), { force: true });
      podcasts = podcasts.filter((p) => p.id !== m[1]);
      await savePodcasts();
    }
    return sendJson(res, 200, { ok: true });
  }

  m = pathname.match(/^\/api\/episodes\/([a-f0-9]+)\/download$/);
  if (m && method === 'POST') {
    await downloadEpisode(m[1]);
    return sendJson(res, 200, { ok: true });
  }
  if (m && method === 'DELETE') {
    downloads.delete(m[1]);
    await deleteEpisodeFile(m[1]);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/audio/')) {
      const file = safeJoin(AUDIO_DIR, url.pathname.slice('/audio/'.length));
      return file ? serveFile(req, res, file) : send(res, 403, 'Verboten');
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = safeJoin(PUBLIC_DIR, rel);
    return file ? serveFile(req, res, file) : send(res, 403, 'Verboten');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Serverfehler' });
  }
});

await fsp.mkdir(AUDIO_DIR, { recursive: true });
podcasts = await readJson(PODCASTS_FILE, []);
server.listen(PORT, () => {
  console.log(`Mot à mot läuft auf http://localhost:${PORT}`);
});
