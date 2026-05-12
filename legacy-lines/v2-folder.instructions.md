---
description: Dateistruktur und Implementierungsrichtlinien für HTML Protot v2 (aktiv in Entwicklung).
applyTo:
  - "index.html"
  - "assets/**"
---

# V2 Dateistruktur & State

## Ziel
- Saubere Architektur mit klarer Modulverantwortung
- Zentrale State-Verwaltung für Dots und Genres in `core/state.js`
- Feature-Module arbeiten unabhängig, sind aber über State gekoppelt
- Nur `drag.js` schreibt State direkt; andere Module lesen State und rendern
- Der aktuelle Prototyp ist ein reiner Frontend-/SVG-Stand ohne Backend oder API-Anbindung

## Aufbau

**CSS-Struktur:**
- `variables.css`: Design-Tokens (Farben, Größen, zentrale CSS-Variablen)
- `base.css`: Globale Basis (Reset, Grundtypografie, Body-Layout)
- `layout.css`: Layout der Hauptflächen (Stage, SVG-Rahmen)
- `components.css`: Komponentenstyles (Ring, Labels, Dots)
- `animations.css`: Keyframes und Animationen (incl. Partikelanimationen)
- `responsive.css`: Media Queries für kleinere Viewports

**JavaScript-Struktur:**
- `app.js`: Bootstrap, initialisiert Ring, Tree-Layer, Highlights, Labels, Drag-Verhalten und den Ambient-Particle-Loop
- `config/*`: Konstanten (Radien, Dots, Limits, Settings)
- `config/musicbrainz.js`: API-Endpunkt, Cache und Timeout für die Live-Anbindung
- `data/*`: Reine Fachdaten (aktuell Genre-Label-Array)
- `core/*`: Basis-APIs (DOM, SVG, State)
- `data/musicbrainz/api.js`: Live-Client für den MusicBrainz-Genre-Index
- `modules/*`: Feature-Module (Ring, Labels, Highlights, Drag, Particles, Tree-Rendering, Clusters, Bridges)
- `utils/*`: Allgemeine Hilfsfunktionen (Geometrie, Math, Farben, etc.)

## Aktueller Implementierungsstand

- Die Visualisierung arbeitet mit einem festen 12er-Ring und einem SVG-ViewBox von `1600x1600`
- Es gibt aktuell 3 Draggable Dots und 12 Genre-Segmente
- `ringLabels` in `data/genres.js` steuert sowohl die Beschriftung als auch die Genre-Indizierung
- `data/musicbrainz/api.js` lädt live `genre/all?fmt=txt` von MusicBrainz und cached die Ergebnisliste lokal
 - `modules/bridges.js` berechnet Branch-Verbindungen und Tree-Layouts
- `highlights.js` rendert die aktiven Genre-Oval-Highlights und färbt sie mit der Farbe des aktivierenden Dots
- `particles.js` erzeugt einen ambienten Pull-Effekt für Dots außerhalb des Kreises
- `utils/colors.js` enthält Hilfen für Farb-Mischung und Aufhellung; `utils/random.js` enthält generische Zufallshilfen

## Zuordnungsregel für neuen Code

| Kategorie | Zielordner | Beispiel |
|-----------|-----------|---------|
| Konstanten/Config | `config/` | `RING_RADIUS`, `DOT_RADIUS` |
| Statische Inhalte | `data/` | Genre-Label-Array |
| DOM/SVG-Primitives | `core/` | `createSvgElement()`, `toSvgCoordinates()` |
| State-Management | `core/state.js` | `updateDotPosition()` |
| Features/UI-Verhalten | `modules/` | Drag, Particles, Ring-Rendering |
| Generische Utilities | `utils/` | `distance()`, `angle()`, `getRandomColor()` |
| Styling | `css/` | Nach Ebene (variables/components/animations) |

## Datenmodell-Hinweis für spätere Erweiterungen

- Wenn Musikdaten oder Genre-Hierarchien hinzukommen, sollten sie nicht direkt in UI-Module geschrieben werden
- Rohdaten und Normalisierung gehören zuerst in `data/` oder in ein neues Adapter-Modul unter `core/` bzw. `modules/`
- Wenn Genre- und Subgenre-Bäume eingeführt werden, braucht der State eine explizite Repräsentation für Parent-/Child-Beziehungen statt nur flacher Label-Arrays
- Die aktuell implementierte MusicBrainz-Schicht ist eine echte Live-Anbindung an `genre/all`; bei Fehlern wird stattdessen eine sichtbare Statusmeldung angezeigt

## State-Management (Core)

**Zustandshalter:** `assets/js/core/state.js`
- Speichert Dot-Positionen, inCircle-Status, activeGenre pro Dot
- Speichert Genre-Status (active/inactive, welcher Dot hat es aktiviert)
- Nur diese Funktionen schreiben State:
  - `updateDotPosition(dotId, x, y)` → Wird bei pointermove aufgerufen
  - `updateDotInCircle(dotId, inCircle)` → Bei Kreis-Einritt/Austritt
  - `updateDotActiveGenre(dotId, genreId)` → Bei Genre-Aktivation/Deaktivation

**Lesezugriff:** Alle Module können lesen (`getDots()`, `getGenres()`, `getDot()`, etc.)

**Subscriber-Pattern:** Module rufen ihre eigenen Update-Funktionen auf
- Beispiel: `drag.js` ruft `updateHighlights()` auf, wenn sich State ändert

## Drag-Verhalten (aktuell)
- Dots werden mit Pointer-Events (pointerdown → pointermove → pointerup) gesteuert
- Bei pointermove wird geprüft: inCircle? → dann Genre aktivieren
- Nur "außerhalb → innen" triggert Aktivation (kein Re-Activation bei Bewegung)
- Bei "innen → außerhalb" wird Genre deaktiviert
- Die Triggerlogik basiert auf der geometrischen Position zum Kreis, nicht auf externen Daten oder Netzwerkzustand

## Module (Übersicht)

- `ring.js` → Rendert den Ring-Stroke
- `highlights.js` → Rendert Genre-Ovals mit Farbe des aktivierenden Dots
- `labels.js` → Rendert Genre-Textlabels
 - (Hinweis) Tree-Generation/Clustering wurde ausgelagert/entfernt in v2; Kern-UI-Features rendern weiterhin ohne Tree-Layout
- `bridges.js` → Berechnet Branch-Pfade und Tree-Layouts
- `drag.js` → Drag-Mechanik, State-Updates, Particle-Trigger
- `particles.js` → [NEU] Partikeleffekt für "Pull"-Visualisierung beim Annähern
- Leere Module bleiben nur dann bestehen, wenn sie kurzfristig als Platzhalter für geplante Funktionen dienen; neue Funktionen sollten aber bevorzugt in die vorhandenen Rollen eingehängt werden

## Hinweis
Leere Platzhalterdateien sind erlaubt, sollten aber entweder zeitnah verwendet oder entfernt werden, damit die Struktur klar bleibt.
