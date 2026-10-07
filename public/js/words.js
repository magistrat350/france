// Grundwortschatz: häufige französische Wörter mit deutscher Übersetzung,
// grob nach Häufigkeit sortiert. Format: "französisch|deutsch".
const RAW = `
être|sein
avoir|haben
faire|machen, tun
dire|sagen
aller|gehen
pouvoir|können
voir|sehen
savoir|wissen
vouloir|wollen
venir|kommen
devoir|müssen
prendre|nehmen
donner|geben
parler|sprechen
mettre|setzen, stellen, legen
trouver|finden
croire|glauben
penser|denken
passer|vorbeigehen, verbringen
demander|fragen, verlangen
rester|bleiben
aimer|lieben, mögen
comprendre|verstehen
partir|weggehen, abfahren
vivre|leben
connaître|kennen
arriver|ankommen
chercher|suchen
entendre|hören
attendre|warten
travailler|arbeiten
jouer|spielen
écouter|zuhören
regarder|anschauen
manger|essen
boire|trinken
écrire|schreiben
lire|lesen
apprendre|lernen
habiter|wohnen
acheter|kaufen
payer|bezahlen
ouvrir|öffnen
fermer|schließen
commencer|anfangen
finir|beenden
choisir|wählen
aider|helfen
appeler|rufen, anrufen
porter|tragen
montrer|zeigen
sortir|hinausgehen
entrer|eintreten
monter|hinaufgehen
tomber|fallen
dormir|schlafen
courir|laufen, rennen
marcher|gehen, funktionieren
changer|ändern, wechseln
oublier|vergessen
essayer|versuchen
expliquer|erklären
raconter|erzählen
répondre|antworten
perdre|verlieren
gagner|gewinnen, verdienen
utiliser|benutzen
devenir|werden
sembler|scheinen
laisser|lassen
tenir|halten
sentir|fühlen, riechen
servir|dienen
suivre|folgen
rencontrer|treffen
présenter|vorstellen
continuer|weitermachen
préférer|bevorzugen
espérer|hoffen
voyager|reisen
visiter|besichtigen
cuisiner|kochen
le jour|der Tag
la nuit|die Nacht
le matin|der Morgen
le soir|der Abend
la semaine|die Woche
le mois|der Monat
l'an|das Jahr
l'année|das Jahr
le temps|die Zeit, das Wetter
l'heure|die Stunde, Uhrzeit
la minute|die Minute
le moment|der Moment
la fois|das Mal
aujourd'hui|heute
demain|morgen
hier|gestern
maintenant|jetzt
toujours|immer
jamais|nie
souvent|oft
parfois|manchmal
déjà|schon
encore|noch
bientôt|bald
tard|spät
tôt|früh
ensuite|danach
puis|dann
enfin|endlich, schließlich
avant|vor, vorher
après|nach, danach
pendant|während
depuis|seit
l'homme|der Mann, Mensch
la femme|die Frau
l'enfant|das Kind
la fille|das Mädchen, die Tochter
le garçon|der Junge
le fils|der Sohn
le père|der Vater
la mère|die Mutter
le frère|der Bruder
la sœur|die Schwester
la famille|die Familie
l'ami|der Freund
l'amie|die Freundin
les gens|die Leute
la personne|die Person
le monde|die Welt
le pays|das Land
la ville|die Stadt
le village|das Dorf
la rue|die Straße
la maison|das Haus
l'appartement|die Wohnung
la chambre|das Zimmer
la cuisine|die Küche
la porte|die Tür
la fenêtre|das Fenster
la table|der Tisch
la chaise|der Stuhl
le lit|das Bett
l'école|die Schule
le travail|die Arbeit
le bureau|das Büro
la gare|der Bahnhof
le train|der Zug
la voiture|das Auto
le vélo|das Fahrrad
l'avion|das Flugzeug
le chemin|der Weg
la place|der Platz
le magasin|das Geschäft
le marché|der Markt
le restaurant|das Restaurant
le café|der Kaffee, das Café
l'eau|das Wasser
le pain|das Brot
le vin|der Wein
la viande|das Fleisch
le fromage|der Käse
le fruit|die Frucht
le légume|das Gemüse
le repas|die Mahlzeit
le petit-déjeuner|das Frühstück
le déjeuner|das Mittagessen
le dîner|das Abendessen
l'argent|das Geld
le prix|der Preis
le livre|das Buch
le journal|die Zeitung
la lettre|der Brief
le mot|das Wort
la phrase|der Satz
la langue|die Sprache, Zunge
la question|die Frage
la réponse|die Antwort
l'histoire|die Geschichte
la chose|die Sache, das Ding
le problème|das Problem
l'idée|die Idee
la raison|der Grund, die Vernunft
la vie|das Leben
la mort|der Tod
le corps|der Körper
la tête|der Kopf
la main|die Hand
le pied|der Fuß
l'œil|das Auge
les yeux|die Augen
le cœur|das Herz
la santé|die Gesundheit
le médecin|der Arzt
la voix|die Stimme
le nom|der Name
la musique|die Musik
la chanson|das Lied
le film|der Film
le sport|der Sport
la mer|das Meer
la montagne|der Berg
le soleil|die Sonne
la pluie|der Regen
le ciel|der Himmel
l'arbre|der Baum
la fleur|die Blume
le chien|der Hund
le chat|die Katze
la guerre|der Krieg
la paix|der Frieden
le gouvernement|die Regierung
le président|der Präsident
la politique|die Politik
l'élection|die Wahl
la loi|das Gesetz
la société|die Gesellschaft
l'entreprise|das Unternehmen
l'économie|die Wirtschaft
la crise|die Krise
le pouvoir|die Macht
la police|die Polizei
le droit|das Recht
la nouvelle|die Nachricht
l'information|die Information
le sujet|das Thema
la partie|der Teil
le côté|die Seite
le début|der Anfang
la fin|das Ende
bon|gut
mauvais|schlecht
grand|groß
petit|klein
nouveau|neu
vieux|alt
jeune|jung
beau|schön
joli|hübsch
long|lang
court|kurz
haut|hoch
bas|niedrig
facile|leicht, einfach
difficile|schwierig
important|wichtig
possible|möglich
vrai|wahr
faux|falsch
même|selbe, sogar
autre|andere
seul|allein, einzig
premier|erste
dernier|letzte
prochain|nächste
plein|voll
vide|leer
chaud|warm, heiß
froid|kalt
cher|teuer, lieb
libre|frei
heureux|glücklich
triste|traurig
content|zufrieden
fatigué|müde
malade|krank
fort|stark
simple|einfach
rapide|schnell
lent|langsam
français|französisch
allemand|deutsch
blanc|weiß
noir|schwarz
rouge|rot
bleu|blau
vert|grün
très|sehr
bien|gut (Adverb)
mal|schlecht (Adverb)
beaucoup|viel
peu|wenig
trop|zu (viel)
assez|genug, ziemlich
plus|mehr
moins|weniger
aussi|auch
ici|hier
là|da, dort
partout|überall
vite|schnell
ensemble|zusammen
peut-être|vielleicht
vraiment|wirklich
surtout|vor allem
oui|ja
non|nein
merci|danke
bonjour|guten Tag
au revoir|auf Wiedersehen
s'il vous plaît|bitte
et|und
ou|oder
mais|aber
donc|also
parce que|weil
quand|wenn, als
si|wenn, ob
comme|wie, da
pour|für, um zu
avec|mit
sans|ohne
dans|in
sur|auf
sous|unter
chez|bei
entre|zwischen
contre|gegen
vers|gegen, in Richtung
qui|wer, der/die/das
que|was, dass
quoi|was
où|wo
comment|wie
pourquoi|warum
combien|wie viel
quel|welcher
je|ich
tu|du
il|er
elle|sie (Sg.)
nous|wir
vous|ihr, Sie
on|man, wir
ce|dies, das
ça|das
tout|alles, ganz
rien|nichts
quelque chose|etwas
personne|niemand
chaque|jeder
un|ein
deux|zwei
trois|drei
quatre|vier
cinq|fünf
dix|zehn
cent|hundert
mille|tausend
`;

export const BASE_WORDS = RAW.trim()
  .split('\n')
  .map((line) => {
    const [fr, de] = line.split('|');
    return { fr: fr.trim(), de: de.trim() };
  })
  .filter((w) => w.fr && w.de);
