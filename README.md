```
████████╗ █████╗ ██╗   ██╗████████╗ ██████╗ ██╗      ██████╗  ██████╗  ██████╗ ███████╗
╚══██╔══╝██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██║     ██╔═══██╗██╔════╝ ██╔═══██╗██╔════╝
   ██║   ███████║██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║  ███╗██║   ██║███████╗
   ██║   ██╔══██║██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║   ██║██║   ██║╚════██║
   ██║   ██║  ██║╚██████╔╝   ██║   ╚██████╔╝███████╗╚██████╔╝╚██████╔╝╚██████╔╝███████║
   ╚═╝   ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝  ╚═════╝╚══════╝
```

```
   ██╗   ██╗███╗   ██╗██████╗ ███████╗██████╗ ██╗     ███████╗ █████╗ ███████╗
   ██║   ██║████╗  ██║██╔══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝
   ██║   ██║██╔██╗ ██║██║  ██║█████╗  ██████╔╝██║     █████╗  ███████║█████╗
   ██║   ██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗██║     ██╔══╝  ██╔══██║██╔══╝
   ╚██████╔╝██║ ╚████║██████╔╝███████╗██║  ██║███████╗███████╗██║  ██║██║
    ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝
```

```
  ┌───────────────────────────────────────────────────────────────────────┐
  │                                                                       │
  │   ☽  UNDERLEAF  —  Local LaTeX IDE                                   │
  │      by Iannis Bardakos / CognitiveNexus Research Practice           │
  │      © 2026                                                           │
  │                                                                       │
  │   Monaco editor · PDF preview · Mind map · Markdown + Readability    │
  │   Annotations · Arrows · Sketch layer · AI error fixing              │
  │                                                                       │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Download the app (no build, no Node) — macOS

Prebuilt **Underleaf.app** for Apple Silicon **and** Intel Macs is on the
[Releases](../../releases) page. Pick whichever is easier:

### Easiest — one line in Terminal

```bash
curl -fsSL https://raw.githubusercontent.com/Jbardakos/UNDERLEAF/main/install-app.sh | bash
```

Auto-detects your Mac, downloads the right build, removes the macOS quarantine
flag, installs to `/Applications`, and launches. Because it downloads over
`curl` (not a browser), macOS never quarantines it — so there's **no
"damaged app" / unidentified-developer wall**.

### Or — download + double-click

1. From [Releases](../../releases) download `Underleaf-<version>-mac-arm64.zip`
   (Apple Silicon) or `…-mac-x64.zip` (Intel).
2. Unzip. Inside is `Underleaf.app` and **`Install Underleaf.command`**.
3. **Right-click → Open** the `Install Underleaf.command` (once, to get past
   Gatekeeper). It strips quarantine, installs to `/Applications`, and opens
   the app.

> The app is ad-hoc signed, **not** notarized — that's why the first launch
> needs the installer (or a right-click → Open). The installer handles the
> `xattr -dr com.apple.quarantine` step for you.

### LaTeX is required to compile PDFs

Underleaf shells out to `pdflatex` / `xelatex`. Install **MacTeX** once:
**[tug.org/mactex](https://www.tug.org/mactex)** (≈4 GB). Editing, Markdown,
Mind Map and Annotations work without it.

### Open a `.tex` straight from Finder

After installing, right-click any `.tex` → **Open With → Underleaf**. It loads
the file, compiles it, and writes a PDF **named after the document's `\title{}`
into the file's own folder**.

---

## Install — new M2 Mac (build from source)

### 1 — Node.js (once ever)

**[nodejs.org](https://nodejs.org)** → green LTS button → download → install

### 2 — Download

Grab `underleaf-complete.tar.gz` from [Releases](../../releases)

### 3 — Three commands

```bash
cd ~/Downloads
tar xzf underleaf-complete.tar.gz
bash dark-underleaf/install.sh
```

App opens automatically.

---

## Launch again later

```bash
cd ~/dark-underleaf-app && npm run electron
```

---

## LaTeX (needed to compile `.tex` files)

**[tug.org/mactex](https://www.tug.org/mactex)** → download `MacTeX.pkg` → install

> 4 GB download — start it now in the background.  
> Underleaf works for Markdown, Mind Map, and Annotations without it.

---

## What's inside

```
underleaf/
├── server.js          Express + WebSocket backend
├── ai.js              AI provider (Ollama / Claude / OpenAI / Gemini)
├── electron-main.js   Desktop app entry point
├── package.json
└── public/
    ├── index.html     Full SPA — Monaco editor, all UI
    ├── mindmap.js     SVG mind map engine + bitmap sketch
    └── annotations.js Sticky notes + curved arrow overlay
```

---

## Features

| | |
|---|---|
| **Editor** | Monaco with LaTeX / BibTeX syntax, autocomplete, 6 themes |
| **Compile** | pdflatex · xelatex · lualatex · BibTeX, streamed log |
| **AI Fix** | Analyses compile errors via Ollama / Claude / OpenAI / Gemini |
| **Markdown** | Full GFM preview with sentence-level readability highlighting |
| **Readability** | Flesch, FK Grade, Fog, word freq chart, word cloud, histogram |
| **Annotations** | Sticky notes anchored to words, exportable as `.txt` |
| **Arrows** | Curved SVG arrows between words, exportable as `.png` |
| **Mind Map** | SVG tree with rich nodes (text + image + audio), per-project |
| **Sketch** | Fast bitmap overlay on mind map — pen / marker / eraser |
| **Projects** | Per-project file tree, ZIP download, drag-drop image upload |

---

## Part of the CognitiveNexus Research Practice

> *tautologos — the word that speaks itself*

---

*Built at BNBU-UIC · School of Culture & Creativity · Zhuhai*
