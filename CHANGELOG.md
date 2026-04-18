# Changelog

## v0.1.0-alpha — tautologos (2026-04)

### First pre-release

**Core IDE**
- Monaco Editor with custom LaTeX + BibTeX Monarch tokenizer
- LaTeX compilation: pdflatex / xelatex / lualatex with BibTeX pass
- Real-time compile log streaming via WebSocket
- PDF preview pane with auto-refresh
- File tree with create / rename / delete / ZIP download
- Drag-and-drop image upload to project folder
- Auto-save (1.2s debounce)
- Document outline panel (live section parsing, click-to-jump)
- 6 syntax themes: B&W · Nord · Dracula · Solarized · Paper · Matrix
- Font size control propagated to all panels

**AI Error Fixing**
- Supports: Ollama (local), Claude API, OpenAI / OpenRouter / Groq, Gemini
- Structured diagnosis → fix suggestions after failed compile

**Markdown Preview**
- Full GFM rendering via marked.js
- Sentence-level readability highlighting (green/amber/red by word count)
- Auto-activates for `.md` files, replaces PDF pane

**Readability Analysis**
- Flesch Reading Ease, Flesch-Kincaid Grade, Gunning Fog
- Sentence length histogram
- Top-20 word frequency bar chart
- Word cloud
- Reading level badge (A/B/C/D)

**Mind Map**
- SVG tree with pan/zoom viewport
- Rich nodes: title + body text (wrapped) + image thumbnail
- Node types: text, URL, image (base64), audio (MediaRecorder)
- Edit panel: title, body, type, image upload, audio record/replay, color
- Collapse/expand subtrees, auto-layout, context menu
- Export tree → `.tex` (depth → section/subsection/…)
- Per-project persistence in `.mindmap/map.json`

**Sketch Layer (Mind Map)**
- Fast persistent bitmap canvas (offscreen + composite)
- Smooth quadratic bezier interpolation
- Speed-based line width
- Tools: ✒ Pen · 🖍 Marker (multiply) · ⌫ Eraser
- Color palette + size slider
- Custom cursor showing brush size

**Annotations (Markdown/Text)**
- Every word wrapped as clickable span
- Sticky notes anchored to words: drag, minimize, color, delete
- Curved SVG arrows between any two words, with optional label
- Both layers toggle independently, saved per-file
- Export: notes → `.txt`, arrows → `.png`

**Desktop App**
- Electron wrapper for Mac (arm64 + x64 DMG) and Windows (NSIS installer + portable)
- Splash screen, native app menu, external links open in browser
- Auto port negotiation if 3737 is busy
- GitHub Actions CI: builds both platforms on push

**Settings**
- Engine path detection (auto-detect from PATH)
- Custom projects directory with Browse button
- Per-project and global settings persistence
