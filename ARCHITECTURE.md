# Underleaf — Architecture Reference

## System overview

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                        │
│  electron-main.js  →  finds free port  →  loads server  │
│                    →  BrowserWindow(localhost:PORT)      │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│               Node.js / Express Server                   │
│                     server.js                            │
│                                                          │
│  HTTP routes         WebSocket         File system       │
│  /api/*              ws://…            ~/dark-underleaf/ │
└──────────┬───────────────┬─────────────────┬────────────┘
           │               │                 │
    ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
    │  REST API   │  │  Compile   │  │  Projects   │
    │  (JSON)     │  │  Stream    │  │  & Data     │
    └─────────────┘  └────────────┘  └─────────────┘
           │
┌──────────▼──────────────────────────────────────────────┐
│                  Browser / SPA                           │
│                   index.html                             │
│                                                          │
│  Monaco Editor    Markdown Preview    Mind Map Panel     │
│  (index.html)     (index.html)        (mindmap.js)       │
│                                                          │
│  Annotations Engine    Readability Analysis              │
│  (annotations.js)      (index.html)                      │
└─────────────────────────────────────────────────────────┘
```

## Server (server.js)

### Port & startup
```
PORT = process.env.PORT || 3737
DATA_DIR    = ~/dark-underleaf/
PROJECTS_DIR = ~/dark-underleaf/projects/   (or settings.projectsDir)
```

### Project ID
Projects are UUID v4 strings. The project folder is `PROJECTS_DIR/<uuid>/`.
`getProjectDir(id)` is the central function — throws if project doesn't exist.

### Compile pipeline
1. Client sends `POST /api/projects/:id/compile { engine, mainFile }`
2. Server opens WebSocket notification channel
3. Spawns: `pdflatex -interaction=nonstopmode -output-directory=.output <mainFile>`
4. Streams stdout/stderr line by line via WS messages `{ type:'log', line }`
5. Runs BibTeX pass if `.bib` files present
6. Optionally re-runs pdflatex for references
7. Sends `{ type:'done', success, pdf }` or `{ type:'error', errors[] }`

Error dedup: a `seenErrors` Set prevents duplicate lines across multiple passes.

### Settings
Persisted as JSON. Key fields:
```json
{
  "engines": { "pdflatex": "/path", "xelatex": "/path", ... },
  "defaultEngine": "pdflatex",
  "projectsDir": "/custom/path",
  "fontSize": 14,
  "editorTheme": "underleaf-bw",
  "wordWrap": false,
  "ai": { "ollamaHost": "...", "claudeKey": "...", ... },
  "firstRun": false
}
```

## Frontend state (index.html)

Global `S` object:
```javascript
S = {
  editor:      MonacoEditor,
  projectId:   string | null,
  projectName: string | null,
  tabs:        [{ path, content, modified }],
  activeTab:   string | null,
  settings:    object,
  fileTree:    array,
  detEngines:  object,
}
```

### Tab lifecycle
1. `openFile(fp)` — fetches content, creates tab, calls `switchTab`
2. `switchTab(fp)` — saves current tab content, sets new Monaco model language
3. Editor `onDidChangeModelContent` → `scheduleSave()` → `saveFile()` after 1.2s
4. `updateMdPreview(fp, content)` called from `switchTab` — shows MD preview for `.md` files

### Compile flow (frontend)
1. `compile()` → POST to `/api/projects/:id/compile`
2. WebSocket messages update `#log-content` in real time
3. On `done`: calls `refreshPdf()` if success, shows AI fix button if failure

## Mind Map (mindmap.js)

### IIFE pattern
```javascript
window.MindMapApp = (() => {
  // private state
  let state = { nodes: {}, rootId, viewport, sketchLines };
  // ... all functions ...
  return { init, loadMap, addChild, ... }; // public API
})();
```

### Render pipeline
```
renderAll()
  ├── renderEdges()   — SVG <path> bezier curves between nodes
  └── renderNodes()   — SVG <g> groups for each visible node
                          renderNode(n)
                            ├── background <rect>
                            ├── depth bar (left edge color)
                            ├── title <text>
                            ├── body text (wrapped lines) if n.body
                            ├── image zone <image> if n.imageData
                            ├── collapse toggle
                            └── add-child button
```

### Node height
Auto-calculated in `renderNode`:
```
n.h = TITLE_H (36) + BODY_H (0–38 based on text) + IMG_H (0 or 56)
n.h = max(n.h, NODE_H=52)
```

### Sketch bitmap
- `overlayCanvas` — visible canvas (z-index 1, below SVG)
- `sketchBitmap` — offscreen canvas, accumulates all strokes
- On each stroke move: bezier to `sketchBitmap`, then `drawImage(sketchBitmap)` to `overlayCanvas`
- Speed-based width: `w = sketchSize * (1 - min(speed*0.4, 0.6))`
- Tools: pen (normal), marker (multiply blend, 35% alpha), eraser (destination-out)

### Save format
Sketch lines stored as downsampled point arrays (every 3rd point):
```json
{
  "tool": "pen",
  "color": "#5aaa5a",
  "size": 3,
  "points": [{"x":100,"y":200,"t":1234567890}, ...]
}
```

## Annotations (annotations.js)

### IIFE pattern — same as MindMapApp

### Word wrapping
After `marked.parse()` renders the HTML, `wrapWords(body)` walks all text nodes
inside `p, li, blockquote p, td, h1–h6` and replaces them with:
```html
<span class="aw" data-wid="42">word</span>
```
Each word gets a unique incrementing `wid`.

### Note positioning
Notes are `position:absolute` inside `#md-preview-body` (which has `position:relative`).
`note.x` and `note.y` are viewport-relative coordinates within the body div.
Connector lines are per-note SVG overlays drawn from word to note box.

### Arrow rendering
Single SVG overlay `#ann-arrows-svg` covers the entire preview body.
Arrows are quadratic bezier curves: `M x1,y1 Q midX,midY x2,y2`
where midpoint is lifted above the straight line by `abs(x2-x1)*0.35`.

### Persistence format
```json
{
  "notes": [
    { "id": "n1234", "wid": "42", "word": "example",
      "text": "my note", "x": 200, "y": 150,
      "minimized": false, "color": "#f0a830" }
  ],
  "arrows": [
    { "id": "a5678", "fromWid": "42", "fromWord": "example",
      "toWid": "99", "toWord": "result",
      "label": "", "color": "#f08030" }
  ]
}
```

## Electron (electron-main.js)

### Startup sequence
1. `findFreePort(3737)` — tries ports until one is free
2. `startServer(port)` — sets `process.env.PORT`, `require('./server.js')`
3. Shows splash `BrowserWindow` (frameless)
4. `waitForServer(port)` — polls `/api/status` every 300ms, 30 retries
5. Creates main `BrowserWindow`, loads `http://127.0.0.1:PORT`
6. On `ready-to-show`: closes splash, shows main window

### Menu
Native app menu with: File, Edit, Compile, View, Help
Compile shortcuts call `mainWindow.webContents.executeJavaScript('compile()')`.

## GitHub Actions (build.yml)

Two parallel jobs:
- `build-mac` on `macos-latest`: `npm run build:mac` → uploads `dist/*.dmg`
- `build-windows` on `windows-latest`: `npm run build:win` → uploads `dist/*.exe`

Artifacts available for 90 days. Attach to Release manually.

## Readability analysis (in index.html)

All done client-side in `runReadabilityAnalysis(markdownText)`:

1. `plainText(md)` — strips markdown syntax
2. Tokenize: words (regex `\b[a-zA-Z'-]+\b`), sentences (split on `.!?`), paragraphs
3. Compute: Flesch Reading Ease, FK Grade Level, Gunning Fog, avg sentence/word length
4. `syllableCount(word)` — heuristic vowel group counting
5. Render: stat grid, score bars, histogram canvas, frequency bar chart canvas, word cloud

Stopwords list: ~60 common English function words.

## Theme system

6 themes defined as Monaco editor themes + CSS variable overrides:
- `underleaf-bw` — dark black/white
- `underleaf-nord` — Nord palette
- `underleaf-dracula` — Dracula palette
- `underleaf-solarized` — Solarized dark
- `underleaf-paper` — light/paper
- `underleaf-matrix` — green on black

`applyTheme(name)` sets Monaco theme + calls `applyThemeToUI(name)` which updates
`#md-preview-body`, `#md-preview-panel` background/text colors.
Font size changes propagate via `changeFontSize(delta)` to both Monaco and `body.style.fontSize`.
