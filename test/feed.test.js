import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseDuration, stripHtml } from '../lib/feed.js';

const XML = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title><![CDATA[Journal en français facile]]></title>
  <itunes:author>RFI</itunes:author>
  <itunes:image href="https://example.com/cover.jpg"/>
  <description>Les infos &amp; l'actualité</description>
  <item>
    <title>Journal du 6 octobre</title>
    <guid isPermaLink="false">ep-1</guid>
    <pubDate>Mon, 06 Oct 2026 20:00:00 GMT</pubDate>
    <itunes:duration>10:05</itunes:duration>
    <enclosure url="https://example.com/ep1.mp3?x=1&amp;y=2" type="audio/mpeg" length="123"/>
    <content:encoded><![CDATA[<p>Bonsoir à tous.</p><p>Le président a parlé.</p>]]></content:encoded>
  </item>
  <item>
    <title>Ohne Audio</title>
    <guid>ep-2</guid>
  </item>
</channel>
</rss>`;

test('parseFeed liest Kanal und Episoden', () => {
  const feed = parseFeed(XML);
  assert.equal(feed.title, 'Journal en français facile');
  assert.equal(feed.author, 'RFI');
  assert.equal(feed.image, 'https://example.com/cover.jpg');
  assert.equal(feed.description, "Les infos & l'actualité");
  assert.equal(feed.episodes.length, 1, 'Episoden ohne Audio werden ignoriert');
  const [ep] = feed.episodes;
  assert.equal(ep.guid, 'ep-1');
  assert.equal(ep.duration, 605);
  assert.equal(ep.audioUrl, 'https://example.com/ep1.mp3?x=1&y=2');
  assert.equal(ep.text, 'Bonsoir à tous.\nLe président a parlé.');
});

test('parseDuration versteht Sekunden und hh:mm:ss', () => {
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration(''), 0);
});

test('stripHtml entfernt Tags und dekodiert Entities', () => {
  assert.equal(stripHtml('<b>C&#39;est</b> clair'), "C'est clair");
  assert.equal(stripHtml('a<br>b'), 'a\nb');
});
