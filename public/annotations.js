/**
 * Underleaf Annotation Engine
 * Per-document sticky notes anchored to words, and curved arrow connections.
 * Works on the #md-preview-body element.
 */
'use strict';

window.Annotations = (() => {

// ─── State ───────────────────────────────────────────────────────────────────

let state = { notes: [], arrows: [] };
let projectId    = null;
let filename     = null;
let notesVisible = false;
let arrowsVisible= false;
let noteMode     = false;  // clicking a word creates a note
let arrowMode    = false;  // clicking words creates arrow endpoints
let arrowFrom    = null;   // { wordId, el }
let svgOverlay   = null;
let saveTimer    = null;

// Theme colour maps for the 6 underleaf themes
const THEME_NOTE_BG = {
  'underleaf-bw':        { bg:'#1a1a1a', border:'#444',    text:'#ccc',  head:'#2a2a2a' },
  'underleaf-nord':      { bg:'#2e3440', border:'#4c566a', text:'#e5e9f0',head:'#3b4252' },
  'underleaf-dracula':   { bg:'#282a36', border:'#6272a4', text:'#f8f8f2',head:'#44475a' },
  'underleaf-solarized': { bg:'#002b36', border:'#586e75', text:'#839496',head:'#073642' },
  'underleaf-paper':     { bg:'#fafaf7', border:'#ccc',    text:'#333',   head:'#f0eee9' },
  'underleaf-matrix':    { bg:'#000',    border:'#003300', text:'#00b300',head:'#001100' },
};

function themeColors() {
  const t = window.S?.settings?.editorTheme || 'underleaf-bw';
  return THEME_NOTE_BG[t] || THEME_NOTE_BG['underleaf-bw'];
}

// ─── Init / Load / Save ──────────────────────────────────────────────────────

async function load(pid, fname) {
  projectId = pid; filename = fname;
  state = { notes: [], arrows: [] };
  try {
    const safe = fname.replace(/[^a-zA-Z0-9._-]/g,'_');
    const data = await fetch(`/api/projects/${pid}/annotations/${safe}`).then(r=>r.json());
    state.notes  = data.notes  || [];
    state.arrows = data.arrows || [];
  } catch {}
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  if (!projectId || !filename) return;
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g,'_');
  try {
    await fetch(`/api/projects/${projectId}/annotations/${safe}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state)
    });
  } catch {}
}

// ─── Word Wrapping ───────────────────────────────────────────────────────────

let wordIdCounter = 0;

function wrapWords(container) {
  // Walk all text nodes in paragraphs, list items etc
  const els = container.querySelectorAll('p, li, blockquote p, td, h1, h2, h3, h4, h5, h6');
  els.forEach(el => {
    if (el.closest('pre') || el.closest('code')) return;
    wrapTextNodes(el);
  });
}

function wrapTextNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  nodes.forEach(tn => {
    if (!tn.textContent.trim()) return;
    const frag = document.createDocumentFragment();
    const parts = tn.textContent.split(/(\s+)/);
    parts.forEach(part => {
      if (!part.trim()) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'aw';
        span.dataset.wid = ++wordIdCounter;
        span.textContent = part;
        span.addEventListener('click', onWordClick);
        span.addEventListener('mouseenter', onWordHover);
        span.addEventListener('mouseleave', onWordLeave);
        frag.appendChild(span);
      }
    });
    tn.parentNode.replaceChild(frag, tn);
  });
}

function onWordClick(e) {
  if (!noteMode && !arrowMode) return;
  e.stopPropagation();

  const wid    = this.dataset.wid;
  const word   = this.textContent.trim();
  const rect   = this.getBoundingClientRect();
  const previewRect = document.getElementById('md-preview-body').getBoundingClientRect();
  const x = rect.left - previewRect.left + rect.width/2;
  const y = rect.top  - previewRect.top  + rect.top - previewRect.top;

  if (noteMode) {
    createNote(wid, word, x, y);
    return;
  }
  if (arrowMode) {
    if (!arrowFrom) {
      arrowFrom = { wid, el: this };
      this.style.outline = '2px solid #f08030';
      showToast('Now click the destination word');
    } else {
      if (arrowFrom.wid !== wid) {
        const arrow = {
          id:   'a' + Date.now(),
          fromWid: arrowFrom.wid,
          fromWord: arrowFrom.el.textContent.trim(),
          toWid:   wid,
          toWord:  word,
          label:   '',
          color:   '#f08030',
        };
        state.arrows.push(arrow);
        arrowFrom.el.style.outline = '';
        arrowFrom = null;
        scheduleSave();
        renderArrows();
      }
    }
  }
}

function onWordHover() {
  if (!noteMode && !arrowMode) return;
  this.style.background = 'rgba(255,200,100,0.2)';
  this.style.cursor = noteMode ? 'cell' : 'crosshair';
}

function onWordLeave() {
  this.style.background = '';
  this.style.cursor = '';
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function createNote(wid, word, x, y) {
  const note = {
    id: 'n' + Date.now(),
    wid, word,
    text: '',
    x, y,
    minimized: false,
    color: '#f0a830',
  };
  state.notes.push(note);
  scheduleSave();
  renderNote(note, true);
}

function renderAllNotes() {
  document.querySelectorAll('.ann-note').forEach(e => e.remove());
  if (!notesVisible) return;
  state.notes.forEach(n => renderNote(n, false));
}

function renderNote(note, focusNow) {
  const body = document.getElementById('md-preview-body');
  if (!body) return;
  const c = themeColors();

  const box = document.createElement('div');
  box.className  = 'ann-note';
  box.dataset.id = note.id;
  box.style.cssText = `
    position:absolute;
    left:${note.x}px; top:${note.y + body.scrollTop}px;
    width:200px; z-index:50;
    font-family:var(--font-mono); font-size:10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    border-radius:5px; overflow:hidden;
    border:1px solid ${c.border};
    background:${c.bg};
  `;

  const head = document.createElement('div');
  head.style.cssText = `
    display:flex; align-items:center; gap:4px;
    padding:4px 6px; background:${c.head};
    border-bottom:1px solid ${c.border};
    cursor:move; user-select:none;
  `;

  const dot = document.createElement('div');
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${note.color};flex-shrink:0`;

  const label = document.createElement('span');
  label.style.cssText = `flex:1; color:${c.text}; font-size:9px; opacity:0.7`;
  label.textContent = '↩ ' + note.word;

  const minBtn = document.createElement('button');
  minBtn.textContent = note.minimized ? '▸' : '▾';
  minBtn.style.cssText = `background:none;border:none;color:${c.text};cursor:pointer;font-size:10px;padding:0 2px`;
  minBtn.title = 'Minimize';
  minBtn.addEventListener('click', () => {
    note.minimized = !note.minimized;
    minBtn.textContent = note.minimized ? '▸' : '▾';
    content.style.display = note.minimized ? 'none' : 'block';
    scheduleSave();
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.style.cssText = `background:none;border:none;color:#c66;cursor:pointer;font-size:10px;padding:0 2px`;
  delBtn.title = 'Delete note';
  delBtn.addEventListener('click', () => {
    state.notes = state.notes.filter(n => n.id !== note.id);
    box.remove();
    scheduleSave();
  });

  head.appendChild(dot); head.appendChild(label); head.appendChild(minBtn); head.appendChild(delBtn);

  const content = document.createElement('div');
  content.style.cssText = `display:${note.minimized ? 'none' : 'block'}`;

  const ta = document.createElement('textarea');
  ta.value = note.text;
  ta.placeholder = 'Type note here…';
  ta.style.cssText = `
    width:100%;box-sizing:border-box; padding:6px 8px;
    background:${c.bg}; color:${c.text}; border:none; outline:none;
    font-family:var(--font-mono); font-size:10px; line-height:1.5;
    resize:vertical; min-height:60px;
  `;
  ta.addEventListener('input', () => { note.text = ta.value; scheduleSave(); });

  // Color picker row
  const cpRow = document.createElement('div');
  cpRow.style.cssText = `display:flex;gap:4px;padding:4px 6px;background:${c.head};border-top:1px solid ${c.border}`;
  ['#f0a830','#60c060','#6090f0','#f06060','#a060f0','#808080'].forEach(col => {
    const sw = document.createElement('div');
    sw.style.cssText = `width:14px;height:14px;border-radius:50%;background:${col};cursor:pointer;border:2px solid ${col===note.color?'#fff':'transparent'}`;
    sw.addEventListener('click', () => {
      note.color = col; dot.style.background = col;
      cpRow.querySelectorAll('div').forEach(d => d.style.borderColor = d.style.background===col?'#fff':'transparent');
      scheduleSave();
    });
    cpRow.appendChild(sw);
  });

  content.appendChild(ta); content.appendChild(cpRow);
  box.appendChild(head); box.appendChild(content);

  // Make draggable
  makeDraggable(box, head, note, body);

  // Draw connector line to word
  const wSpan = body.querySelector(`[data-wid="${note.wid}"]`);
  if (wSpan) drawConnector(box, wSpan, body, note.id);

  body.style.position = 'relative';
  body.appendChild(box);

  if (focusNow) setTimeout(() => ta.focus(), 50);
  // Highlight anchor word
  if (wSpan) { wSpan.style.background = note.color + '33'; wSpan.style.borderBottom = '2px solid ' + note.color; }
}

function drawConnector(noteBox, wordSpan, body, noteId) {
  // Draw SVG line from word to note — redrawn on drag
  const svgId = 'ann-conn-' + noteId;
  let svg = document.getElementById(svgId);
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.id = svgId;
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:49;overflow:visible';
    svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
    body.appendChild(svg);
  }
  svg.innerHTML = '';
  const br = body.getBoundingClientRect();
  const wr = wordSpan.getBoundingClientRect();
  const nr = noteBox.getBoundingClientRect();
  const wx = wr.left - br.left + wr.width/2;
  const wy = wr.top  - br.top  + wr.height + body.scrollTop;
  const nx = nr.left - br.left + 10;
  const ny = nr.top  - br.top  + body.scrollTop + 10;
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  const cx1 = wx, cy1 = wy + Math.abs(ny-wy)*0.5;
  const cx2 = nx, cy2 = ny - Math.abs(ny-wy)*0.3;
  path.setAttribute('d', `M${wx},${wy} C${cx1},${cy1} ${cx2},${cy2} ${nx},${ny}`);
  path.setAttribute('fill','none'); path.setAttribute('stroke','#f0a83066');
  path.setAttribute('stroke-width','1'); path.setAttribute('stroke-dasharray','3,3');
  svg.appendChild(path);
}

function makeDraggable(box, handle, note, body) {
  let ox=0, oy=0, dragging=false;
  handle.addEventListener('mousedown', e => {
    dragging = true;
    const r = box.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const br = body.getBoundingClientRect();
    note.x = e.clientX - br.left - ox;
    note.y = e.clientY - br.top  - oy + body.scrollTop;
    box.style.left = note.x + 'px';
    box.style.top  = (note.y) + 'px';
    // Redraw connector
    const wSpan = body.querySelector(`[data-wid="${note.wid}"]`);
    if (wSpan) drawConnector(box, wSpan, body, note.id);
    scheduleSave();
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

// ─── Arrows ─────────────────────────────────────────────────────────────────

function renderArrows() {
  if (!svgOverlay) {
    const body = document.getElementById('md-preview-body');
    if (!body) return;
    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svgOverlay.id = 'ann-arrows-svg';
    svgOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:48;overflow:visible';
    svgOverlay.setAttribute('width','100%'); svgOverlay.setAttribute('height','100%');
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML = `<marker id="ann-arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#f08030"/>
    </marker>`;
    svgOverlay.appendChild(defs);
    body.style.position = 'relative';
    body.appendChild(svgOverlay);
  }
  // Clear arrows only (keep defs)
  Array.from(svgOverlay.children).forEach(c => { if (c.tagName !== 'defs' && c.tagName !== 'DEFS') c.remove(); });

  if (!arrowsVisible) return;

  const body = document.getElementById('md-preview-body');
  const br = body.getBoundingClientRect();

  state.arrows.forEach(arr => {
    const fromEl = body.querySelector(`[data-wid="${arr.fromWid}"]`);
    const toEl   = body.querySelector(`[data-wid="${arr.toWid}"]`);
    if (!fromEl || !toEl) return;

    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const x1 = fr.left - br.left + fr.width/2;
    const y1 = fr.top  - br.top  + body.scrollTop + fr.height/2;
    const x2 = tr.left - br.left + tr.width/2;
    const y2 = tr.top  - br.top  + body.scrollTop + tr.height/2;

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');

    // Curved path
    const mid_x = (x1+x2)/2;
    const mid_y = Math.min(y1,y2) - Math.abs(x2-x1)*0.35 - 30;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${x1},${y1} Q${mid_x},${mid_y} ${x2},${y2}`);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', arr.color || '#f08030');
    path.setAttribute('stroke-width','1.5');
    path.setAttribute('marker-end','url(#ann-arr)');
    g.appendChild(path);

    // Label if present
    if (arr.label) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', mid_x); txt.setAttribute('y', mid_y - 4);
      txt.setAttribute('text-anchor','middle'); txt.setAttribute('font-size','9');
      txt.setAttribute('fill', arr.color || '#f08030');
      txt.setAttribute('font-family','monospace');
      txt.textContent = arr.label;
      g.appendChild(txt);
    }

    // Delete button (small ×)
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx', mid_x); circle.setAttribute('cy', mid_y);
    circle.setAttribute('r','7'); circle.setAttribute('fill','#1a1a1a');
    circle.setAttribute('stroke', arr.color||'#f08030'); circle.setAttribute('stroke-width','1');
    circle.style.cursor = 'pointer'; circle.style.pointerEvents = 'all';
    circle.addEventListener('click', () => {
      state.arrows = state.arrows.filter(a => a.id !== arr.id);
      scheduleSave(); renderArrows();
    });
    const xt = document.createElementNS('http://www.w3.org/2000/svg','text');
    xt.setAttribute('x', mid_x); xt.setAttribute('y', mid_y+3.5);
    xt.setAttribute('text-anchor','middle'); xt.setAttribute('font-size','8');
    xt.setAttribute('fill','#c66'); xt.setAttribute('pointer-events','none');
    xt.textContent = '×';
    g.appendChild(circle); g.appendChild(xt);

    svgOverlay.appendChild(g);
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

function exportNotesTxt() {
  if (!state.notes.length) { showToast('No notes to export'); return; }
  const lines = [`Annotations for: ${filename}`, `Exported: ${new Date().toLocaleString()}`, '─'.repeat(50), ''];
  state.notes.forEach((n,i) => {
    lines.push(`[Note ${i+1}] anchored to: "${n.word}"`);
    lines.push(n.text || '(empty)');
    lines.push('');
  });
  if (state.arrows.length) {
    lines.push('─'.repeat(50));
    lines.push('ARROWS:');
    state.arrows.forEach(a => lines.push(`  "${a.fromWord}" ──▶ "${a.toWord}"${a.label ? ' ['+a.label+']' : ''}`));
  }
  const blob = new Blob([lines.join('\n')], { type:'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/\.[^.]+$/,'') + '-annotations.txt';
  a.click();
}

async function exportArrowsPng() {
  const body = document.getElementById('md-preview-body');
  if (!body) return;
  showToast('Capturing PNG…');
  try {
    // Use html2canvas if available, otherwise capture SVG
    const svgEl = document.getElementById('ann-arrows-svg');
    if (!svgEl) { showToast('No arrows to export'); return; }
    const r = body.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width  = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    // Render SVG to image
    const xml = new XMLSerializer().serializeToString(svgEl);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a'); a.href = canvas.toDataURL('image/png');
      a.download = filename.replace(/\.[^.]+$/,'') + '-arrows.png';
      a.click();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  } catch(e) { showToast('Export failed: ' + e.message); }
}

function showToast(msg) {
  // Use main app toast if available
  if (window.toast) { window.toast(msg, 'info'); return; }
  const el = document.getElementById('toast');
  if (el) { el.textContent = msg; el.className = 'show info'; setTimeout(()=>el.className='info',2000); }
}

// ─── Public API ──────────────────────────────────────────────────────────────

return {
  load,
  saveNow,

  // Called after markdown is rendered into #md-preview-body
  attach(pid, fname) {
    projectId = pid; filename = fname;
    const body = document.getElementById('md-preview-body');
    if (!body) return;
    svgOverlay = null;
    wrapWords(body);
    renderAllNotes();
    renderArrows();
  },

  setNotesVisible(v) {
    notesVisible = v;
    renderAllNotes();
    // Highlight all anchor words
    const body = document.getElementById('md-preview-body');
    if (!body) return;
    if (v) {
      state.notes.forEach(n => {
        const w = body.querySelector(`[data-wid="${n.wid}"]`);
        if (w) { w.style.background = n.color+'33'; w.style.borderBottom='2px solid '+n.color; }
      });
    } else {
      body.querySelectorAll('[data-wid]').forEach(w => { w.style.background=''; w.style.borderBottom=''; });
    }
  },

  setArrowsVisible(v) {
    arrowsVisible = v;
    renderArrows();
  },

  setNoteMode(v) {
    noteMode = v;
    arrowMode = false;
    arrowFrom = null;
    const body = document.getElementById('md-preview-body');
    if (body) body.style.cursor = v ? 'cell' : '';
  },

  setArrowMode(v) {
    arrowMode = v;
    noteMode  = false;
    arrowFrom = null;
    if (!v && arrowFrom) { arrowFrom.el.style.outline=''; arrowFrom=null; }
    const body = document.getElementById('md-preview-body');
    if (body) body.style.cursor = v ? 'crosshair' : '';
  },

  exportNotesTxt,
  exportArrowsPng,

  get hasNotes() { return state.notes.length > 0; },
  get hasArrows() { return state.arrows.length > 0; },
};

})();
