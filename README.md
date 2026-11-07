# Arc — DXF to Plasma

Die Oberfläche einschließlich Hilfetexten, Konturhinweisen und Fehlermeldungen ist auf Deutsch. Für die Veröffentlichung per FTP lade **[web/index.html](web/index.html)** herunter und lege diese eine Datei als `index.html` im gewünschten Ordner deiner Webseite ab. Vorhandene Blechvorgaben bleiben kompatibel; die JSON-Sicherung heißt jetzt `arc-blechvorgaben.json`.

Die Arbeitsfläche zeigt Schnittparameter links, Zeichnung und Werkzeuge in der Mitte sowie Konturauswahl und Schnittseiten rechts. Position, Drehung und Nullpunktkoordinaten lassen sich über „Position & Nullpunkt“ aufklappen. DXF-Dateien können auf das Dateifeld oder direkt auf die Zeichenfläche gezogen werden. Der G-Code-Download befindet sich oben rechts. Auf kleinen Bildschirmen stehen Zeichnung und Bearbeitung vor den weiteren Einstellungen.

## Teile ohne DXF zeichnen

**[web/teile.html](web/teile.html)** ist die zweite eigenständige App. Form wählen, Fertigmaße eingeben, Schnittbahnen prüfen und G-Code speichern. Verfügbar sind:

- Rechteck oder Quadrat, mit optionalen Eckenradien.
- Kreis oder Ring; Innendurchmesser 0 erzeugt eine volle Scheibe.
- Lasche mit rundem Kopf und optionalem Loch in dessen Mitte.
- Rundflansch mit Mittelöffnung, Lochkreisdurchmesser, 2–32 Schraubenlöchern und Startwinkel ab +X gegen den Uhrzeigersinn.
- Rechteckige Flanschplatte mit vier symmetrischen Ecklöchern, optionalen Rundungen und Mittelöffnung. Randabstände werden bis zur Lochmitte gemessen.
- Langlasche mit zwei runden Enden und optionalen Löchern in den Rundungsmittelpunkten.

Alle Maße sind in Millimetern und beschreiben das fertige Teil. Die Vorschau zeigt Außen- und Innenschnitte, Gesamtabmessungen, Schnittfolge, Schnittfuge und Überlappung. Ungültige Maße, sich berührende/überlappende Löcher oder Löcher außerhalb des Werkstücks sperren die Berechnung. Eine kleinere Öffnung als die eingestellte Schnittfuge sperrt den G-Code-Export. Es gelten dieselben CAM-Grenzen und Controllerannahmen wie beim DXF-Modul. Es wird jeweils ein parametrisches Teil bearbeitet; freies Skizzieren und Teileverschachtelung sind nicht enthalten.

Die Teile-App verwendet den gemeinsamen Parser, Konturanalyse, Schnittfugenkorrektur, Positionierung, G-Code-Generator und Blechvorgabenspeicher. Auf derselben Website und im selben Browser werden Blechvorgaben sowie gültige Plasma-Ein/Aus-Befehle zwischen beiden Modulen geteilt. M-Befehle werden beim Bearbeiten getrennt von Blechdicken gespeichert (`arc.machine.v1`), Standard M8/M9. Die zuletzt gewählte Form und gültige Maße je Vorlage werden lokal gespeichert (`arc.parts.v1`). Form-/Maßänderungen setzen Position und Schnittseiten zurück; Blechvorgaben verändern die Geometrie nicht. Eine neue Seite liest gespeicherte Vorgaben ein; bereits geöffnete Tabs müssen neu geladen werden. Für unterschiedliche Domains oder lokale HTML-Dateien ist gemeinsamer Browser-Speicher nicht garantiert; Blechvorgaben lassen sich per JSON übertragen.

### Zwei Dateien per FTP veröffentlichen

1. `web/index.html` als `index.html` hochladen (DXF-Modul).
2. `web/teile.html` als `teile.html` in denselben Ordner hochladen (Teile-Modul).
3. `https://deine-domain.de/teile.html` öffnen. Oben mit **DXF / Teile** wechseln.

Jede HTML-Datei funktioniert für sich ohne zusätzliche Assets oder Serverprogramm. `npm run build` erzeugt beide FTP-Dateien und Kopien unter `dist/`. Die Quelldatei `teile.html` und `quick/` enthalten die bearbeitbare Oberfläche und den Vorlagengenerator; für FTP ausschließlich die Dateien aus `web/` verwenden. **DXF sichern** exportiert bei Bedarf die Geometrie ohne Schnittfugenkorrektur für andere Programme. Docker stellt beide Apps automatisch bereit.

A browser app for converting flat ASCII DXF drawings to configurable plasma G-code. Files are parsed on your device and are never uploaded. No account, API key, backend, or package installation is required. The polygon offset engine is vendored locally with its licenses.

## Public server deployment (v1.0)

### FTP: download and upload one file

The ready-to-upload app is committed as **[web/index.html](web/index.html)**. Open that file on GitHub and use **Download raw file** to save it as `index.html`. Upload it by FTP into a folder such as `plasma` inside your website's document root, then open `https://your-domain.com/plasma/`. No other files, build tools, PHP or database are required. The repository-root `index.html` is the development entry point; use the self-contained file in `web/` for single-file FTP deployment. `npm run build` refreshes both `web/index.html` and `dist/arc.html`.

The production app is a static website. DXF parsing and G-code generation run in the visitor's browser; the server only serves the app. No database or upload directory is needed.

### Docker Compose with automatic HTTPS

Requires Docker with Compose on your server, a domain with DNS A/AAAA records pointing to that server, and inbound TCP ports 80/443 (optionally UDP 443 for HTTP/3). Remove stale AAAA records if your server has no working IPv6. If another reverse proxy already occupies these ports, use the static hosting option below.

```sh
git clone https://github.com/MrChaos1234/dxf_to_plasma.git
cd dxf_to_plasma
git checkout v1.0
cp .env.example .env
# Edit .env: DOMAIN=plasma.your-domain.com
docker compose up -d --build
```

Open `https://plasma.your-domain.com`. Caddy obtains and renews TLS certificates automatically; certificate state survives container updates in Docker volumes. Only the compiled app is served, not the repository, tests, or environment files. Check startup with `docker compose logs --tail=100 web`. Stop with `docker compose down`; omit `-v` to retain certificates. Updating to another release: `git fetch --tags`, check out its tag, then run `docker compose up -d --build` again. Local startup can use `DOMAIN=http://localhost docker compose up -d --build` (HTTP only).

### Existing web server or static hosting

```sh
npm test
npm run build
```

Upload **only** `dist/arc.html` to your web root as `index.html`. It works under a domain root or a subdirectory, without URL rewrites, APIs or external dependencies. Use HTTPS and serve HTML with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`. Node is needed only for building, not on the serving machine. Alternatively download `arc.html` from the GitHub v1.0 release and rename it to `index.html` without building anything. GitHub Actions tests and builds each main-branch push; version tags also publish the standalone file as a release asset after the Docker build passes.

Thickness presets remain local to each browser and website origin; they are not shared between users or synchronized to the server. Moving from an offline file or another domain requires exporting/importing the presets JSON. Drawings and G-code are processed locally, while ordinary web-server access logs can record requests for the website itself. The public app has no login.

## Open directly in Safari

Run `npm run build` and open `dist/arc.html` in Safari. This self-contained file includes the styles, converter, SVG preview and sample drawing. It works offline without a server or external assets. Use the **Drop a DXF file here** area inside the app to select a drawing; uploading to a chat interface does not load it into the app.

## Run

Requires Python 3 for the static server; Node.js 18+ to run tests.

```sh
cd /workspace/dxf_to_plasma
npm start
```

The server listens on port 3000. Upload a DXF or choose **Try a sample drawing**, set the plasma commands and cutting parameters, inspect the preview and G-code, then download the `.nc` file. Stop the server with Ctrl+C.

```sh
npm test
```

## Sheet-thickness defaults and XY-only machines

This app generates **X/Y motion only**. It does not emit Z-axis height moves or C-axis commands. Configure your plasma-on/off M-codes; each contour travels with the torch off, enables the torch, waits for the selected pierce delay, cuts at the selected feed rate, completes any overlap, and disables the torch before the next rapid move. Feed is specified on the first cutting move of every contour, including contours that begin with an arc.

In **Sheet defaults**, enter a thickness in millimeters and your feed rate, pierce delay, cut overlap and plasma kerf width, then click **Save thickness preset**. All four process values are saved under that thickness. Choosing a thickness in the top selector loads its defaults without changing contour-side assignments or plasma M-codes. Editing fields does not overwrite a saved preset until you click Save; saving the same thickness updates it. Delete removes the selected preset while leaving current cutting values in the fields.

Presets and the last selected thickness persist as JSON in this browser using local storage (key `arc.sheet-presets.v1`). They are operator-supplied values; no recommended cut table is guessed from thickness. **Vorgaben als JSON herunterladen** saves an `arc-blechvorgaben.json` backup containing thickness, feed, delay, overlap and kerf; **JSON importieren** adds new thicknesses and keeps existing values for matching thicknesses. Existing `arc-thickness-presets.json` backups remain compatible. Back up the library before replacing or moving the standalone HTML file, switching browsers, or clearing browser data. Some Safari/private-browsing configurations restrict local storage; the app reports save failures, keeps values for the current tab, and allows JSON export/import instead of claiming persistence.

**Cut overlap** is a distance in millimeters along the actual compensated toolpath. A closed contour completes one loop, then continues over the first requested length with the torch still on. The continuation follows the original line and arc directions, crossing corners as needed; circles retain compact arc output. Pink dashed strokes mark overlap in the preview, and cut length includes it. Open paths receive no overlap. If overlap is as long as or longer than any resulting closed loop, export is blocked with the contour number so you can reduce it. A split offset receives overlap on each resulting loop.

## Choose where each contour cuts

1. Select a thickness preset or set **Plasma kerf width** in Sheet defaults to the measured cut width for your process, then upload a DXF.
2. The app analyzes closed-contour nesting: outer boundaries default to Outside, holes to Inside, and islands inside holes to Outside. Winding and file order do not affect classification. Each automatic choice is labeled Auto, and selecting a contour shows the reasoning.
3. Choose **On line**, **Outside**, or **Inside** in the selected-contour controls. On line keeps the torch center on the drawing; Inside/Outside offset the center by half the kerf width. Each contour keeps its own choice, independent of nesting or drawing direction.
4. To assign many contours quickly, activate an Outside, Inside, or On line toolbar tool and click the contours. Return to **Select** to inspect without changing assignments. **Clear choices** leaves every contour unassigned; **Suggest cut sides** analyzes them again while preserving manual assignments. Undo restores both choices and whether they were automatic or manual.
5. Check the dashed reference drawing against the actual torch centerline. Both use the same cut-side colors: amber for Inside, blue for Outside, green for On line, and gray for unassigned geometry. Pink marks overlap. The on-screen legend remains visible on small screens. The translucent band shows kerf width, and numbered starts show actual cut order. Scroll or use +/− to zoom, drag with Select to pan, and use Fit to reset the view. The preview and exported G-code use the same compensated and positioned geometry.

Inside/Outside requires a closed contour. Unambiguous same-layer LINE, ARC and polyline endpoints within 0.00001 mm are automatically joined; branching geometry and visible gaps are not joined. Open contours start unassigned and require an explicit On line choice. Crossing, touching, near-coincident, self-intersecting or otherwise unverifiable contours are also left unassigned. Ambiguous enclosing boundaries make their descendants uncertain. Known geometry remains visible while pending contours wait for review; export is blocked until every contour has an explicit or confident automatic choice. Drawing errors, warnings and pending-choice messages sit immediately below the graphic, above the selected-contour controls.

Automatic analysis assumes ordinary through-cut sheet geometry; engraving intentions cannot be inferred from nesting, so review and override as appropriate. Boundary proximity is evaluated using approximately 0.01 mm bands around sampled geometry, conservatively leaving boundaries within about 0.02 mm for manual review. Drawings above 500 contours, 50,000 sampled vertices or 10,000 overlapping boundary comparisons fall back to manual review. File replacement and unit changes rerun automatic analysis. Drawings and contour-side assignments are not retained between page loads; saved thickness presets are retained.

General closed-contour offsets use Clipper with round joins and a 0.01 mm approximation budget for curve sampling, polygon offsets and bounded arc refitting. Circles retain exact native arcs. Curved runs are recovered as compact G2/G3 moves where the tolerance permits; the remaining offset edges are G1 moves. Inward offsets that split a narrow shape produce multiple closed paths, all shown and exported. Collapsed offsets and self-intersecting source contours block export with a contour-specific message.

## Cut order

**Inside first · outside last** is the default. Verified containment creates dependencies: every contained feature, including open on-line work, is cut before the enclosing boundary. This also handles nested islands correctly; an outside island must finish before the hole enclosing it is released. Between eligible contours, Inside is preferred over On line, then Outside. Separate outside contours are prioritized from smaller to larger enclosed area, leaving a single large outer outline last. Split offset loops stay together as one source-contour group. Geometry that could not be classified confidently uses the selected cut sides and stable size/file-order priorities.

The preview start markers and contour list show the actual sequence, and the travel lines follow that same sequence. **Original DXF order** is available as an explicit override. Neither mode performs nearest-travel optimization or automatic part packing.

## Drawing placement and work zero

Use **Rotation** (counterclockwise degrees) or the ±90° buttons to rotate the entire drawing around the center of its original bounding box. **Move X/Y** translates it in millimeters after rotation. The **Move drawing** tool lets you drag the geometry; dragging with Select only pans the view and does not change output. Transforms preserve arc centers, direction, kerf offsets and overlap without flattening native arcs. The source DXF and cut-side choices are unchanged.

The red **X0 Y0** marker is the work zero. It starts at the original drawing's lower-left bounds when a file loads. It stays fixed as you move/rotate the drawing. Set its drawing-space X/Y coordinates directly, use **Zero at lower left**, **Zero at center**, or **CAD 0,0**, or choose **Set zero** and click the preview. Clicking snaps within 12 screen pixels to nearby vertices, arc centers and drawing-bound anchors; otherwise it uses the clicked location. The marker moves independently of the geometry.

Exported coordinates equal rotated drawing coordinates plus X/Y translation minus the chosen work zero. The preview shows the placed drawing and the zero marker in the same drawing-coordinate space. A zero at the center, an outside kerf offset, or moving past zero can produce negative G-code coordinates. The app does **not** emit homing, G92, or controller work-offset-setting commands: align your controller's physical work zero to the chosen reference before cutting. **Reset placement** restores rotation/movement to zero and the source lower-left work zero. File/unit changes also reset placement; sheet-thickness presets do not change placement or cut order. Positioning is per drawing and is not saved in the sheet-default JSON.

`G40` cancels controller compensation because kerf compensation is already applied to the coordinates here.

## Supported geometry

- LINE, ARC, CIRCLE, LWPOLYLINE (including bulges), and 2D POLYLINE.
- SPLINE: flat control-point B-splines and positive-weight rational NURBS, degrees 1–10, including closed/periodic curves with a consistent knot/control-point definition. Each knot span is converted to rational Bezier form, then subdivided until its entire control hull lies within 0.01 mm of the output line segment. The tolerance applies in millimeters even for inch drawings. Preview and on-line G-code use those same G1 segments; existing kerf-compensation approximation is additional when Inside/Outside is selected. Closed splines participate in nesting, cut order and compensation; open splines require an explicit On line choice and can join matching LINE/ARC endpoints. Native LINE/ARC/CIRCLE output is unchanged.
- Flat XY drawings at Z=0 with the standard extrusion direction.
- Automatic `$INSUNITS` handling for millimeters, inches, feet, centimeters and meters; manual drawing-unit override. Unspecified units default to millimeters with a warning.
- On-line arcs, circles and polyline bulges export as native G2/G3 moves with incremental I/J center offsets. Full circles use two semicircles; other arcs are split only when they exceed 180°. The SVG preview draws native arcs. Original drawing dimensions use exact extrema, and cut length uses the resulting line/arc toolpaths.

POINT reference markers are ignored with a notice. They do not create cut paths, pierces, or drilling operations, and do not affect drawing dimensions. A drawing containing only points cannot be exported.

Spline records with only fit points and no authoritative control-point/knot definition, nonpositive or ill-conditioned weights, discontinuities, inconsistent closed endpoints, malformed data, excessive degree/complexity, or nonzero Z coordinates block import with an explanation. Curves are never closed by inventing a straight cut. Limits are 4096 original control points, 4 million knot-insertion control operations, 20,000 refined controls and 100,000 subdivision calls; reaching a limit blocks import rather than reducing accuracy. Export fit-only splines from CAD with control points and knots first.

Other unsupported entities, including INSERT blocks, ELLIPSE, text, and dimensions, block export rather than silently producing an incomplete cut. Flatten the drawing and explode or remove unsupported entities in CAD first. Binary DXF is unsupported. Maximum input size: 10 MB.

## Controller assumptions

Output uses millimeters (`G21`), absolute coordinates (`G90`), XY plane (`G17`), feed per minute (`G94`), and configurable `G4 P` dwell units. The web UI defaults to **milliseconds for Mach3**: enable **General Config → G04 Dwell in ms** in Mach3. If that checkbox is disabled, select **Sekunden** in the app instead. The app setting and the controller setting must match; the app cannot detect or change Mach3 configuration. Pierce delay and thickness-preset delay values always remain in **seconds**; 0.5 s emits `M8`, then `G4 P500` in millisecond mode or `G4 P0.5` in seconds mode, then the first cutting move. Dwell is emitted once per contour/offset loop, immediately after torch-on; zero delay omits G4. G-code header comments identify the selected unit. The dwell unit is a machine setting saved alongside M-codes (`arc.machine.v1`), independent of thickness presets. Existing saved custom M-codes are preserved. Drawings with arcs also use `G91.1` for incremental I/J centers; the controller must support this mode and G2/G3 interpolation. Feed rate is set once per contour and retained modally. Torch on and off accept one M-code, optionally with an S or P parameter. Defaults are M8 and M9; confirm the commands and their immediate or synchronized behavior with your controller documentation.

Each resulting contour or offset loop uses the selected cut-order strategy and the XY-only sequence described above, with no height movements. No automatic homing, probing, physical work-offset setting, torch height control, machine-limit checking, lead-ins, or part packing is implemented.

**Simulate and dry-run before cutting.** Check scale, kerf width, overlap, chosen cut sides, work offset, M-codes, dwell convention, machine envelope, and cut order. The preview shows geometry and travel, not machine collision validation. Disconnected open contours pierce separately.
