import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/js/text.js';
import { BASE_WORDS } from '../public/js/words.js';

test('tokenize löst Elisionen auf und zählt Wörter', () => {
  assert.deepEqual(T.tokenize("L'homme qu'il a vu aujourd'hui"), ['le', 'homme', 'que', 'il', 'a', 'vu', "aujourd'hui"]);
  assert.deepEqual(T.tokenize('C’est peut-être vrai !'), ['ce', 'est', 'peut-être', 'vrai']);
  assert.equal(T.countWords('Bonjour, ça va ? Oui, très bien.'), 6);
});

test('vocabKey entfernt Artikel und Pronomen', () => {
  assert.equal(T.vocabKey('la maison'), 'maison');
  assert.equal(T.vocabKey("l'école"), 'école');
  assert.equal(T.vocabKey('se lever'), 'lever');
  assert.equal(T.vocabKey('faire, tun'), 'faire');
});

test('buildKnownSet erkennt Flexionsformen', () => {
  const known = T.buildKnownSet(['parler', 'être', 'la maison', 'grand', 'finir']);
  for (const w of ['parle', 'parlons', 'parlé', 'est', 'sont', 'maisons', 'grande', 'grands', 'finissons']) {
    assert.ok(known.has(w), w);
  }
  assert.ok(!known.has('chien'));
});

test('analyze berechnet Abdeckung und unbekannte Wörter', () => {
  const known = T.buildKnownSet(['le', 'chat', 'être', 'petit']);
  const a = T.analyze('Le chat est petit. Le chien est grand, le chien dort.', known);
  assert.equal(a.tokens, 11);
  assert.equal(a.knownTokens, 7);
  assert.equal(a.unknown[0].word, 'chien');
  assert.equal(a.unknown[0].count, 2);
  assert.ok(Math.abs(a.coverage - 7 / 11) < 1e-9);
});

const TEXT =
  "Bonsoir à tous et bienvenue dans ce journal. Le gouvernement français a présenté aujourd'hui son nouveau budget pour l'année prochaine. " +
  'Les syndicats critiquent fortement les économies prévues dans les hôpitaux publics. En Allemagne, les électeurs votent dimanche pour choisir leur parlement. ' +
  'Dans le sport, la France a gagné son match de football contre le Brésil hier soir.';

test('makeCloze erzeugt stabile Lücken aus echten Sätzen', () => {
  const a = T.makeCloze(TEXT, 3, 'seed');
  const b = T.makeCloze(TEXT, 3, 'seed');
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  for (const c of a) {
    assert.ok(TEXT.includes(c.before + c.answer + c.after));
    assert.ok(c.answer.length >= 4);
  }
});

test('makeHeardCheck mischt echte Wörter und Ablenker', () => {
  const items = T.makeHeardCheck(TEXT, BASE_WORDS.map((w) => w.fr), 'x');
  const tokens = new Set(T.tokenize(TEXT));
  const inText = items.filter((i) => i.inText);
  const out = items.filter((i) => !i.inText);
  assert.equal(inText.length, 8);
  assert.equal(out.length, 4);
  for (const i of inText) assert.ok(tokens.has(i.word), i.word);
  for (const i of out) assert.ok(!tokens.has(i.word), i.word);
});

test('looseEqual ignoriert Akzente und Groß-/Kleinschreibung', () => {
  assert.ok(T.looseEqual('Electeurs', 'électeurs'));
  assert.ok(!T.looseEqual('électeur', 'électeurs'));
});

test('Grundwortschatz hat keine doppelten Einträge', () => {
  const seen = new Set();
  for (const w of BASE_WORDS) {
    assert.ok(!seen.has(w.fr), w.fr);
    seen.add(w.fr);
  }
});

test('properNouns erkennt Namen, aber keine Satzanfänge', () => {
  const names = T.properNouns('Hier, la France a battu le Brésil. Selon Paris, la france gagne. Bonsoir à tous.');
  assert.ok(names.has('brésil'));
  assert.ok(names.has('paris'));
  assert.ok(!names.has('france'), 'kommt auch klein vor');
  assert.ok(!names.has('selon') && !names.has('bonsoir'), 'nur am Satzanfang groß');
});
