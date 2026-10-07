// Minimaler RSS-Parser für Podcast-Feeds (ohne externe Abhängigkeiten).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function unwrap(s) {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(s);
}

function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = xml.match(re);
  return m ? unwrap(m[1]).trim() : '';
}

function attr(xml, name, attribute) {
  const re = new RegExp(`<${name}\\s[^>]*?${attribute}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1]) : '';
}

export function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function parseDuration(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value.split(':').reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);
}

export function parseFeed(xml) {
  const firstItem = xml.search(/<item[\s>]/i);
  const channel = firstItem >= 0 ? xml.slice(0, firstItem) : xml;
  const items = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  return {
    title: tag(channel, 'title'),
    author: tag(channel, 'itunes:author'),
    description: stripHtml(tag(channel, 'description')),
    image: attr(channel, 'itunes:image', 'href') || tag(tag(channel, 'image'), 'url'),
    episodes: items
      .map((item) => {
        const html = tag(item, 'content:encoded') || tag(item, 'description');
        return {
          guid: tag(item, 'guid') || attr(item, 'enclosure', 'url'),
          title: stripHtml(tag(item, 'title')),
          pubDate: tag(item, 'pubDate'),
          duration: parseDuration(tag(item, 'itunes:duration')),
          audioUrl: attr(item, 'enclosure', 'url'),
          audioType: attr(item, 'enclosure', 'type'),
          text: stripHtml(html),
        };
      })
      .filter((e) => e.audioUrl),
  };
}
