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

## Install — new M2 Mac

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
