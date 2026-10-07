# Mot à mot – Französisch lernen mit Wortzähler und Podcasts

Eine kleine Lern-App für Französisch, bei der **die Anzahl der gelernten Wörter immer im Vordergrund steht**:
groß in der Kopfzeile, als Meilenstein-Fortschritt auf der Startseite und bei jeder Hör-Aufgabe als
„Wie viel Prozent dieses Podcasts verstehe ich schon?“.

## Funktionen

- **Wortzähler** – ein Wort zählt als *gelernt*, wenn du es an zwei verschiedenen Tagen richtig gewusst hast
  (oder mit „Kenne ich schon“ markierst). Vergisst du es wieder, wird es abgezogen. Meilensteine: 50, 100, 250 … 10.000.
- **Vokabeltrainer** mit Leitner-System (Wiederholung nach 1, 2, 4, 8 … Tagen), Aussprache per Sprachausgabe,
  Richtung FR→DE, DE→FR oder gemischt. 350 Wörter Grundwortschatz sind vorinstalliert.
- **Podcasts** – Suche über das Apple-Podcast-Verzeichnis oder direkte RSS-URL, Abo, Episoden **herunterladen**
  (offline hören) oder streamen. Player mit ±10 s und Geschwindigkeit 0,75×–1,25×.
- **Hör-Aufgaben** zu jeder Episode:
  1. Episode anhören (Fortschritt wird automatisch gemessen)
  2. Transkript einfügen → **Wortanalyse**: Wörter im Text, verschiedene Wörter, Anteil, den du schon kennst
  3. Neue Wörter sammeln – die häufigsten unbekannten Wörter mit einem Klick in den Wortschatz
  4. Hör-Check – welche Wörter kamen in der Episode vor?
  5. Lückentext aus Sätzen des Transkripts
  6. Verständnisfragen auf Französisch (mit Wortzähler für das Geschriebene)
  7. Abschluss – gehörte und geschriebene Wörter wandern in deine Statistik

  Ohne Transkript gibt es die Schritte Hören, Wörter notieren und Verständnisfragen.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18. Es werden keine weiteren Pakete benötigt.

```bash
npm start
```

Dann im Browser <http://localhost:3000> öffnen. Port ändern: `PORT=8080 npm start`.

Lernstand, Abos und heruntergeladene Episoden liegen im Ordner `data/` (wird nicht ins Git übernommen).
Eine Sicherung des Lernstands kannst du unter *Vokabeln → Sicherung herunterladen* erstellen.

## Empfohlene Podcasts

Einfach im Tab *Podcasts* auf eine Empfehlung klicken:

| Podcast | Niveau | Transkript |
|---|---|---|
| Journal en français facile (RFI) | A2–B1 | auf rfi.fr |
| InnerFrench | B1–B2 | auf innerfrench.com |
| Français Authentique | B1–B2 | teilweise |
| Easy French | A2–B2 | für Mitglieder |
| Coffee Break French | A1–B1 | – |

## Tests

```bash
npm test
```

## Aufbau

- `server.js` – Node-Server ohne Abhängigkeiten: statische Dateien, Lernstand, Podcast-Suche, RSS, Downloads (mit Range-Support zum Spulen)
- `lib/feed.js` – RSS-Parser
- `public/js/app.js` – Oberfläche (Übersicht, Lernen, Vokabeln, Podcasts, Aufgaben)
- `public/js/text.js` – Wortzählung, Formenerkennung, Abdeckung, Lückentext und Hör-Check
- `public/js/words.js` – Grundwortschatz
