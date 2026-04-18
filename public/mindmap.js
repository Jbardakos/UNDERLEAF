/**
 * Underleaf Mind Map Engine
 * SVG-based, Canvas sketch overlay, per-project persistence
 */
'use strict';

window.MindMapApp = (() => {

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_W = 180, NODE_H = 52, NODE_MIN_H = 52;
const CHILD_OFFSET_X = 260, CHILD_OFFSET_Y = 80;
const TYPE_ICON  = { text: '◻', url: '⊞', image: '▣', audio: '◎' };
const PALETTE    = ['#181818','#0d1a2e','#0d1f0d','#200f0f','#130d20','#1a180a'];
const PAL_STROKE = ['#333','#2a4a7a','#2a5a2a','#6a1a1a','#2a1a5a','#4a3a0a'];

const SVGNS = 'http://www.w3.org/2000/svg';

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  nodes: {}, rootId: null,
  viewport: { x: 300, y: 250, scale: 1 },
  sketchLines: []
};

let projectId = null;
let container, svgEl, vpGrp, edgeGrp, nodeGrp, overlayCanvas, octx;
let selectedId = null;
let dragging   = null;   // { id, ox, oy, mx, my }
let panning    = null;   // { sx, sy, vx, vy }
let editingId  = null;
let sketchActive = false;
let sketchDrawing = false;
let sketchCurrent = null;
let recorder = null, recordingId = null, recordChunks = [];
let saveTimer = null;
let mmOpen = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

function init(cont) {
  container = cont;

  // Canvas for sketch (bottom)
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;';
  container.appendChild(overlayCanvas);
  octx = overlayCanvas.getContext('2d');

  // SVG (top)
  svgEl = document.createElementNS(SVGNS, 'svg');
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;cursor:default;';
  svgEl.setAttribute('width','100%'); svgEl.setAttribute('height','100%');
  container.appendChild(svgEl);

  // Defs
  const defs = mkSvg('defs');
  defs.innerHTML = `<filter id="mm-shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/></filter>
  <marker id="mm-arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
    <path d="M0,0 L7,2.5 L0,5 Z" fill="#3a3a3a"/>
  </marker>`;
  svgEl.appendChild(defs);

  // Grid pattern
  const pattern = mkSvg('pattern');
  pattern.setAttribute('id','mm-grid'); pattern.setAttribute('width','40'); pattern.setAttribute('height','40');
  pattern.setAttribute('patternUnits','userSpaceOnUse');
  const gridPath = mkSvg('path');
  gridPath.setAttribute('d','M 40 0 L 0 0 0 40'); gridPath.setAttribute('fill','none');
  gridPath.setAttribute('stroke','#1a1a1a'); gridPath.setAttribute('stroke-width','0.5');
  pattern.appendChild(gridPath); defs.appendChild(pattern);

  const gridRect = mkSvg('rect');
  gridRect.setAttribute('width','100%'); gridRect.setAttribute('height','100%');
  gridRect.setAttribute('fill','url(#mm-grid)'); svgEl.appendChild(gridRect);

  // Viewport group
  vpGrp = mkSvg('g'); vpGrp.id = 'mm-vp'; svgEl.appendChild(vpGrp);
  edgeGrp = mkSvg('g'); edgeGrp.id = 'mm-edges'; vpGrp.appendChild(edgeGrp);
  nodeGrp = mkSvg('g'); nodeGrp.id = 'mm-nodes'; vpGrp.appendChild(nodeGrp);

  // Events
  svgEl.addEventListener('mousedown',  onMouseDown);
  svgEl.addEventListener('mousemove',  onMouseMove);
  svgEl.addEventListener('mouseup',    onMouseUp);
  svgEl.addEventListener('mouseleave', onMouseUp);
  svgEl.addEventListener('wheel',      onWheel, { passive: false });
  svgEl.addEventListener('dblclick',   onDblClick);
  svgEl.addEventListener('contextmenu', onContextMenu);

  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(container);
  resizeCanvas();
  applyViewport();
}

// resizeCanvas moved to sketch section

// ─── Load / Save ──────────────────────────────────────────────────────────────

async function loadMap(pid) {
  projectId = pid;
  try {
    const data = await fetch(`/api/projects/${pid}/mindmap`).then(r => r.json());
    state = { nodes: data.nodes || {}, rootId: data.rootId || null,
              viewport: data.viewport || { x:300, y:250, scale:1 },
              sketchLines: data.sketchLines || [] };
  } catch { state = { nodes:{}, rootId:null, viewport:{x:300,y:250,scale:1}, sketchLines:[] }; }
  applyViewport();
  renderAll();
  redrawSketch();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMap, 800);
}

async function saveMap() {
  if (!projectId) return;
  try {
    await fetch(`/api/projects/${projectId}/mindmap`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state)
    });
  } catch {}
}

// ─── Node CRUD ────────────────────────────────────────────────────────────────

function genId() { return 'n' + Math.random().toString(36).slice(2,9); }

function createNode(opts = {}) {
  const id = genId();
  state.nodes[id] = {
    id, x: opts.x||200, y: opts.y||200,
    w: NODE_W, h: NODE_H,
    title:    opts.title || 'New node',
    body:     opts.body  || '',
    type:     opts.type  || 'text',
    imageData:opts.imageData || null,
    audioFile:opts.audioFile || null,
    audioData:opts.audioData || null,
    color:    opts.color != null ? opts.color : 0,
    children: [],
    parentId: opts.parentId || null,
    collapsed:false,
  };
  if (opts.parentId && state.nodes[opts.parentId]) {
    state.nodes[opts.parentId].children.push(id);
  }
  if (!state.rootId) state.rootId = id;
  return id;
}

function deleteNode(id) {
  const n = state.nodes[id]; if (!n) return;
  // Detach from parent
  if (n.parentId && state.nodes[n.parentId]) {
    state.nodes[n.parentId].children = state.nodes[n.parentId].children.filter(c => c !== id);
  }
  // Delete subtree
  [...n.children].forEach(cid => deleteNode(cid));
  delete state.nodes[id];
  if (state.rootId === id) state.rootId = null;
  if (selectedId === id) selectedId = null;
}

function addChild(parentId) {
  if (!parentId) parentId = selectedId || state.rootId;
  const parent = state.nodes[parentId]; if (!parent) return;
  const depth  = getDepth(parentId);
  const sibCount = parent.children.length;
  const cx = parent.x + CHILD_OFFSET_X;
  const cy = parent.y + (sibCount - Math.floor(sibCount/2)) * CHILD_OFFSET_Y;
  const id = createNode({ parentId, x: cx, y: cy,
    title: depth === 0 ? 'Section' : depth === 1 ? 'Subsection' : 'Item',
    color: Math.min(depth+1, PALETTE.length-1) });
  selectedId = id;
  renderAll();
  scheduleSave();
  return id;
}

function getDepth(id) {
  let d = 0, cur = state.nodes[id];
  while (cur && cur.parentId) { d++; cur = state.nodes[cur.parentId]; }
  return d;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderAll() {
  renderEdges();
  renderNodes();
}

function applyViewport() {
  if (!vpGrp) return;
  const { x, y, scale } = state.viewport;
  vpGrp.setAttribute('transform', `translate(${x},${y}) scale(${scale})`);
}

function renderEdges() {
  edgeGrp.innerHTML = '';
  Object.values(state.nodes).forEach(n => {
    if (!n.parentId || !state.nodes[n.parentId]) return;
    const p = state.nodes[n.parentId];
    if (p.collapsed) return;
    const path = mkSvg('path');
    const x1 = p.x + p.w/2, y1 = p.y;
    const x2 = n.x,          y2 = n.y + n.h/2;
    const cx1 = x1 + (x2-x1)*0.5, cy1 = y1;
    const cx2 = x1 + (x2-x1)*0.5, cy2 = y2;
    path.setAttribute('d', `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', '#3a3a3a');
    path.setAttribute('stroke-width','1.5');
    path.setAttribute('marker-end','url(#mm-arr)');
    edgeGrp.appendChild(path);
  });
}

function renderNodes() {
  // Remove old nodes
  nodeGrp.innerHTML = '';
  Object.values(state.nodes).forEach(n => {
    if (n.parentId && state.nodes[n.parentId]?.collapsed) return;
    renderNode(n);
  });
}

function renderNode(n) {
  const depth      = getDepth(n.id);
  const isSelected = selectedId === n.id;
  const col        = PALETTE[n.color] || PALETTE[0];
  const stroke     = PAL_STROKE[n.color] || PAL_STROKE[0];
  const hasBody    = n.body && n.body.trim().length > 0;
  const hasImg     = !!n.imageData;
  const hasAudio   = !!(n.audioFile || n.audioData);

  // Dynamic height: base + body zone + image zone
  const IMG_H   = hasImg  ? 56 : 0;
  const BODY_H  = hasBody ? Math.min(38, Math.ceil(n.body.trim().length / 22) * 14 + 6) : 0;
  const TITLE_H = 36;
  n.h = TITLE_H + BODY_H + IMG_H;
  n.h = Math.max(n.h, NODE_H);

  const g = mkSvg('g');
  g.setAttribute('data-id', n.id);
  g.setAttribute('transform', `translate(${n.x},${n.y - n.h/2})`);
  g.style.cursor = 'grab';

  if (isSelected) g.setAttribute('filter','url(#mm-shadow)');

  // Background
  const rect = mkSvg('rect');
  rect.setAttribute('width', n.w); rect.setAttribute('height', n.h);
  rect.setAttribute('rx','6'); rect.setAttribute('ry','6');
  rect.setAttribute('fill', col);
  rect.setAttribute('stroke', isSelected ? '#ffffff' : stroke);
  rect.setAttribute('stroke-width', isSelected ? 2 : 1);
  g.appendChild(rect);

  // Left depth bar
  const depthColors = ['#555','#2a6','#28a','#a62','#62a','#aa6'];
  const bar = mkSvg('rect');
  bar.setAttribute('width','4'); bar.setAttribute('height', n.h);
  bar.setAttribute('rx','3');
  bar.setAttribute('fill', depthColors[Math.min(depth, depthColors.length-1)]);
  g.appendChild(bar);

  // ── Title zone (always) ──────────────────────────────────────────────
  const typeIcon = TYPE_ICON[n.type] || '◻';
  const badge = mkSvg('text');
  badge.setAttribute('x', n.w - 12); badge.setAttribute('y', 14);
  badge.setAttribute('font-size','10'); badge.setAttribute('fill','#555');
  badge.setAttribute('text-anchor','middle');
  badge.textContent = typeIcon;
  g.appendChild(badge);

  if (hasAudio) {
    const ai = mkSvg('text');
    ai.setAttribute('x', n.w - 24); ai.setAttribute('y', 14);
    ai.setAttribute('font-size','9'); ai.setAttribute('fill','#c84');
    ai.textContent = '◎';
    g.appendChild(ai);
  }

  const title = mkSvg('text');
  title.setAttribute('x', '10'); title.setAttribute('y', TITLE_H/2 + 1);
  title.setAttribute('dominant-baseline','middle');
  title.setAttribute('font-family', "'JetBrains Mono','Fira Code',monospace");
  title.setAttribute('font-size', depth === 0 ? '13' : '11');
  title.setAttribute('font-weight', depth <= 1 ? '600' : '400');
  title.setAttribute('fill', '#d8d4cc');
  title.setAttribute('pointer-events','none');
  title.textContent = truncate(n.title, n.w - 30);
  g.appendChild(title);

  // ── Body text zone ───────────────────────────────────────────────────
  if (hasBody) {
    // Divider
    const div = mkSvg('line');
    div.setAttribute('x1','6'); div.setAttribute('y1', TITLE_H);
    div.setAttribute('x2', n.w - 6); div.setAttribute('y2', TITLE_H);
    div.setAttribute('stroke','#333'); div.setAttribute('stroke-width','0.5');
    g.appendChild(div);

    // Body text — wrap into multiple lines
    const maxChars = Math.floor((n.w - 20) / 5.5);
    const words = n.body.trim().split(/\s+/);
    const lines = []; let cur = '';
    words.forEach(w => {
      if ((cur + ' ' + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    const showLines = lines.slice(0, 3);

    showLines.forEach((line, i) => {
      const bt = mkSvg('text');
      bt.setAttribute('x','8');
      bt.setAttribute('y', TITLE_H + 11 + i * 13);
      bt.setAttribute('font-size','9');
      bt.setAttribute('fill','#7a7870');
      bt.setAttribute('pointer-events','none');
      bt.setAttribute('font-family', "'JetBrains Mono','Fira Code',monospace");
      bt.textContent = line + (i === 2 && lines.length > 3 ? '…' : '');
      g.appendChild(bt);
    });
  }

  // ── Image zone ───────────────────────────────────────────────────────
  if (hasImg) {
    const imgY = TITLE_H + BODY_H + 4;
    // Divider above image
    const div2 = mkSvg('line');
    div2.setAttribute('x1','6'); div2.setAttribute('y1', TITLE_H + BODY_H);
    div2.setAttribute('x2', n.w - 6); div2.setAttribute('y2', TITLE_H + BODY_H);
    div2.setAttribute('stroke','#333'); div2.setAttribute('stroke-width','0.5');
    g.appendChild(div2);

    // Clip path for rounded image
    const clipId = 'img-clip-' + n.id;
    const clipPath = mkSvg('clipPath');
    clipPath.setAttribute('id', clipId);
    const clipRect = mkSvg('rect');
    clipRect.setAttribute('x', '6'); clipRect.setAttribute('y', imgY);
    clipRect.setAttribute('width', n.w - 12); clipRect.setAttribute('height', IMG_H - 6);
    clipRect.setAttribute('rx','4');
    clipPath.appendChild(clipRect);
    g.appendChild(clipPath);

    const img = mkSvg('image');
    img.setAttribute('x','6'); img.setAttribute('y', imgY);
    img.setAttribute('width', n.w - 12); img.setAttribute('height', IMG_H - 6);
    img.setAttribute('href', n.imageData);
    img.setAttribute('preserveAspectRatio','xMidYMid slice');
    img.setAttribute('clip-path', `url(#${clipId})`);
    g.appendChild(img);
  }

  // Collapse toggle (if has children)
  if (n.children.length > 0) {
    const cg = mkSvg('g');
    cg.setAttribute('transform', `translate(${n.w/2 - 8}, ${n.h})`);
    cg.style.cursor = 'pointer';
    cg.setAttribute('data-action','collapse');
    cg.setAttribute('data-id', n.id);
    const cr = mkSvg('rect');
    cr.setAttribute('width','16'); cr.setAttribute('height','14');
    cr.setAttribute('rx','3'); cr.setAttribute('fill','#2a2a2a');
    cr.setAttribute('stroke','#444');
    cg.appendChild(cr);
    const ct = mkSvg('text');
    ct.setAttribute('x','8'); ct.setAttribute('y','10');
    ct.setAttribute('text-anchor','middle'); ct.setAttribute('font-size','10');
    ct.setAttribute('fill','#888'); ct.setAttribute('pointer-events','none');
    ct.textContent = n.collapsed ? '+' : '−';
    cg.appendChild(ct);
    g.appendChild(cg);
  }

  // Add-child button (hover reveal via CSS class trick)
  const addBtn = mkSvg('g');
  addBtn.setAttribute('transform', `translate(${n.w}, ${n.h/2 - 10})`);
  addBtn.style.cursor = 'pointer';
  addBtn.setAttribute('data-action','addchild');
  addBtn.setAttribute('data-id', n.id);
  addBtn.style.opacity = isSelected ? '1' : '0';
  addBtn.id = `mm-add-${n.id}`;
  const ab = mkSvg('rect');
  ab.setAttribute('width','20'); ab.setAttribute('height','20');
  ab.setAttribute('rx','10'); ab.setAttribute('fill','#2a3a2a'); ab.setAttribute('stroke','#4a6a4a');
  addBtn.appendChild(ab);
  const at = mkSvg('text');
  at.setAttribute('x','10'); at.setAttribute('y','14');
  at.setAttribute('text-anchor','middle'); at.setAttribute('font-size','14');
  at.setAttribute('fill','#6a6'); at.setAttribute('pointer-events','none');
  at.textContent = '+';
  addBtn.appendChild(at);
  g.appendChild(addBtn);

  // Mouse events on node group
  g.addEventListener('mouseenter', () => {
    const ab = document.getElementById(`mm-add-${n.id}`);
    if (ab) ab.style.opacity = '1';
  });
  g.addEventListener('mouseleave', e => {
    if (!e.relatedTarget?.closest?.(`[data-id="${n.id}"]`)) {
      const ab = document.getElementById(`mm-add-${n.id}`);
      if (ab && selectedId !== n.id) ab.style.opacity = '0';
    }
  });

  nodeGrp.appendChild(g);
}

function truncate(str, maxPx, fontSize = 11) {
  const charsPerPx = 0.6 / fontSize * 11;
  const max = Math.floor(maxPx * charsPerPx);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ─── Mouse Events ─────────────────────────────────────────────────────────────

function svgCoords(e) {
  const r = svgEl.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const { x, y, scale } = state.viewport;
  return { cx: (mx - x) / scale, cy: (my - y) / scale, mx, my };
}

function nodeAt(cx, cy) {
  for (const n of Object.values(state.nodes)) {
    if (n.parentId && state.nodes[n.parentId]?.collapsed) continue;
    if (cx >= n.x && cx <= n.x + n.w && cy >= n.y - n.h/2 && cy <= n.y + n.h/2) return n;
  }
  return null;
}

function onMouseDown(e) {
  if (e.button === 2) return;
  if (sketchActive) { startSketch(e); return; }

  // Check for action elements
  const action = e.target.closest?.('[data-action]');
  if (action) {
    const aid = action.getAttribute('data-id');
    const act = action.getAttribute('data-action');
    if (act === 'addchild') { e.stopPropagation(); addChild(aid); return; }
    if (act === 'collapse') { e.stopPropagation(); toggleCollapse(aid); return; }
  }

  const { cx, cy, mx, my } = svgCoords(e);
  const n = nodeAt(cx, cy);

  if (n) {
    if (editingId && editingId !== n.id) stopEdit();
    selectedId = n.id;
    dragging = { id: n.id, ox: cx - n.x, oy: cy - n.y, mx, my };
    svgEl.style.cursor = 'grabbing';
  } else {
    if (editingId) stopEdit();
    selectedId = null;
    panning = { sx: mx, sy: my, vx: state.viewport.x, vy: state.viewport.y };
    svgEl.style.cursor = 'grabbing';
  }
  renderAll();
}

function onMouseMove(e) {
  if (sketchActive && sketchDrawing) { continueSketch(e); return; }
  if (dragging) {
    const { cx, cy } = svgCoords(e);
    const n = state.nodes[dragging.id]; if (!n) return;
    n.x = cx - dragging.ox;
    n.y = cy - dragging.oy;
    renderAll();
  } else if (panning) {
    const r = svgEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    state.viewport.x = panning.vx + (mx - panning.sx);
    state.viewport.y = panning.vy + (my - panning.sy);
    applyViewport();
  }
}

function onMouseUp(e) {
  if (sketchDrawing) { endSketch(); }
  if (dragging) { scheduleSave(); }
  if (panning) { scheduleSave(); }
  dragging = null; panning = null;
  svgEl.style.cursor = sketchActive ? 'crosshair' : 'default';
}

function onWheel(e) {
  e.preventDefault();
  const r   = svgEl.getBoundingClientRect();
  const mx  = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const { x, y, scale } = state.viewport;
  const newScale = Math.max(0.2, Math.min(3, scale * factor));
  state.viewport.x = mx - (mx - x) * (newScale / scale);
  state.viewport.y = my - (my - y) * (newScale / scale);
  state.viewport.scale = newScale;
  applyViewport();
  updateZoomLabel();
}

function onDblClick(e) {
  if (sketchActive) return;
  const { cx, cy } = svgCoords(e);
  const n = nodeAt(cx, cy);
  if (n) startEdit(n.id);
  else {
    // Create root or floating node
    const id = createNode({ x: cx, y: cy, title: 'New node',
      parentId: null, color: 0 });
    if (!state.rootId) state.rootId = id;
    renderAll(); scheduleSave();
    setTimeout(() => startEdit(id), 50);
  }
}

function onContextMenu(e) {
  e.preventDefault();
  const { cx, cy } = svgCoords(e);
  const n = nodeAt(cx, cy);
  if (n) showNodeMenu(n, e.clientX, e.clientY);
}

function toggleCollapse(id) {
  const n = state.nodes[id]; if (!n) return;
  n.collapsed = !n.collapsed;
  renderAll(); scheduleSave();
}

// ─── Inline Editing ───────────────────────────────────────────────────────────

function startEdit(id) {
  if (editingId === id) return;
  if (editingId) stopEdit();
  const n = state.nodes[id]; if (!n) return;
  editingId = id;

  // Show node editor panel
  showEditPanel(n);
}

function stopEdit() {
  if (!editingId) return;
  const panel = document.getElementById('mm-edit-panel');
  if (panel) {
    // Save from panel
    const n = state.nodes[editingId];
    if (n) {
      n.title = document.getElementById('mm-ep-title')?.value || n.title;
      n.body  = document.getElementById('mm-ep-body')?.value  || n.body;
    }
  }
  editingId = null;
  if (panel) panel.style.display = 'none';
  renderAll(); scheduleSave();
}

function showEditPanel(n) {
  let panel = document.getElementById('mm-edit-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'mm-edit-panel';
    panel.style.cssText = `
      position:absolute;right:10px;top:50px;width:280px;
      background:#1a1a1a;border:1px solid #333;border-radius:6px;
      padding:14px;z-index:300;font-family:var(--font-mono);font-size:11px;
      box-shadow:0 8px 28px rgba(0,0,0,0.7);
    `;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="color:#888;letter-spacing:0.1em;font-size:9px;text-transform:uppercase">Node</span>
        <button id="mm-ep-close" style="background:none;border:none;color:#555;cursor:pointer;font-size:14px">✕</button>
      </div>
      <div style="margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">TITLE</label>
        <input id="mm-ep-title" style="width:100%;background:#111;border:1px solid #333;color:#ccc;padding:5px 7px;border-radius:3px;font-family:var(--font-mono);font-size:11px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">TYPE</label>
        <select id="mm-ep-type" style="width:100%;background:#111;border:1px solid #333;color:#ccc;padding:4px 6px;border-radius:3px;font-family:var(--font-mono);font-size:10px">
          <option value="text">◻ Text</option>
          <option value="url">⊞ URL / Link</option>
          <option value="image">▣ Image</option>
          <option value="audio">◎ Audio Note</option>
        </select>
      </div>
      <div style="margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">CONTENT / NOTES</label>
        <textarea id="mm-ep-body" rows="3" style="width:100%;background:#111;border:1px solid #333;color:#ccc;padding:5px 7px;border-radius:3px;font-family:var(--font-mono);font-size:10px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div id="mm-ep-url-row" style="display:none;margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">URL</label>
        <input id="mm-ep-url" placeholder="https://..." style="width:100%;background:#111;border:1px solid #333;color:#8af;padding:5px 7px;border-radius:3px;font-family:var(--font-mono);font-size:10px;box-sizing:border-box">
      </div>
      <div id="mm-ep-img-row" style="display:none;margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">IMAGE</label>
        <input type="file" id="mm-ep-img-file" accept="image/*" style="font-size:10px;color:#888;width:100%">
        <div id="mm-ep-img-thumb" style="margin-top:5px;max-height:80px;overflow:hidden;border-radius:3px"></div>
      </div>
      <div id="mm-ep-audio-row" style="display:none;margin-bottom:8px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:3px">AUDIO NOTE</label>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="mm-ep-rec" style="flex:1;background:#2a1a1a;border:1px solid #6a2a2a;color:#c66;padding:5px;border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--font-mono)">⏺ Record</button>
          <button id="mm-ep-stop" style="flex:1;background:#1a1a2a;border:1px solid #3a3a6a;color:#66c;padding:5px;border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--font-mono);display:none">⏹ Stop</button>
        </div>
        <div id="mm-ep-audio-play" style="margin-top:6px"></div>
      </div>
      <div style="margin-bottom:10px">
        <label style="color:#555;font-size:9px;display:block;margin-bottom:5px">COLOR</label>
        <div id="mm-ep-colors" style="display:flex;gap:4px"></div>
      </div>
      <div style="display:flex;gap:6px">
        <button id="mm-ep-save" style="flex:1;background:#1e2e1e;border:1px solid #3a5a3a;color:#8a8;padding:5px;border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--font-mono)">Save</button>
        <button id="mm-ep-del" style="background:#2a1414;border:1px solid #6a2222;color:#c66;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--font-mono)">Delete</button>
        <button id="mm-ep-child" style="background:#1a1a2e;border:1px solid #2a2a6a;color:#88a;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--font-mono)">+ Child</button>
      </div>
    `;
    container.appendChild(panel);
    wireEditPanel();
  }

  // Populate
  document.getElementById('mm-ep-title').value = n.title;
  document.getElementById('mm-ep-body').value  = n.body || '';
  document.getElementById('mm-ep-type').value  = n.type || 'text';
  document.getElementById('mm-ep-url').value   = (n.type === 'url') ? (n.body || '') : '';
  updateTypeRows(n.type, n);

  // Colors
  const colorDiv = document.getElementById('mm-ep-colors');
  colorDiv.innerHTML = '';
  PALETTE.forEach((col, i) => {
    const sw = document.createElement('div');
    sw.style.cssText = `width:20px;height:20px;background:${col};border-radius:50%;cursor:pointer;border:2px solid ${i===n.color?'#fff':'transparent'}`;
    sw.addEventListener('click', () => {
      n.color = i;
      colorDiv.querySelectorAll('div').forEach((d,j) => d.style.border = `2px solid ${j===i?'#fff':'transparent'}`);
      renderAll(); scheduleSave();
    });
    colorDiv.appendChild(sw);
  });

  // Audio playback
  const audioPlay = document.getElementById('mm-ep-audio-play');
  audioPlay.innerHTML = '';
  if (n.audioFile) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.cssText = 'width:100%;height:28px';
    audio.src = `/api/projects/${projectId}/mindmap/audio/${n.audioFile}`;
    audioPlay.appendChild(audio);
  } else if (n.audioData) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.cssText = 'width:100%;height:28px';
    audio.src = n.audioData;
    audioPlay.appendChild(audio);
  }

  // Image thumb
  const thumb = document.getElementById('mm-ep-img-thumb');
  thumb.innerHTML = '';
  if (n.imageData) {
    const img = document.createElement('img');
    img.src = n.imageData; img.style.cssText = 'max-width:100%;border-radius:3px';
    thumb.appendChild(img);
  }

  panel.style.display = 'block';
}

function updateTypeRows(type, n) {
  document.getElementById('mm-ep-url-row').style.display   = type === 'url'   ? 'block' : 'none';
  document.getElementById('mm-ep-img-row').style.display   = type === 'image' ? 'block' : 'none';
  document.getElementById('mm-ep-audio-row').style.display = type === 'audio' ? 'block' : 'none';
}

function wireEditPanel() {
  document.getElementById('mm-ep-close').addEventListener('click', stopEdit);
  document.getElementById('mm-ep-type').addEventListener('change', e => {
    const n = state.nodes[editingId]; if (!n) return;
    n.type = e.target.value;
    updateTypeRows(n.type, n);
  });
  document.getElementById('mm-ep-save').addEventListener('click', () => {
    const n = state.nodes[editingId]; if (!n) return;
    n.title = document.getElementById('mm-ep-title').value.trim() || 'Node';
    n.body  = document.getElementById('mm-ep-body').value;
    n.type  = document.getElementById('mm-ep-type').value;
    if (n.type === 'url') n.body = document.getElementById('mm-ep-url').value;
    stopEdit();
  });
  document.getElementById('mm-ep-del').addEventListener('click', () => {
    const id = editingId; stopEdit(); deleteNode(id); renderAll(); scheduleSave();
  });
  document.getElementById('mm-ep-child').addEventListener('click', () => {
    if (editingId) addChild(editingId);
  });
  document.getElementById('mm-ep-img-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const n = state.nodes[editingId]; if (!n) return;
      n.imageData = ev.target.result;
      n.type = 'image';
      const thumb = document.getElementById('mm-ep-img-thumb');
      thumb.innerHTML = `<img src="${n.imageData}" style="max-width:100%;border-radius:3px">`;
      renderAll(); scheduleSave();
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('mm-ep-rec').addEventListener('click', startRecording);
  document.getElementById('mm-ep-stop').addEventListener('click', stopRecording);
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    recordingId = editingId;
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => recordChunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(recordChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = async ev => {
        const n = state.nodes[recordingId]; if (!n) return;
        // Store as base64 in node directly (small recordings)
        n.audioData = ev.target.result;
        n.type = 'audio';
        // Show playback
        const audioPlay = document.getElementById('mm-ep-audio-play');
        if (audioPlay) {
          audioPlay.innerHTML = '';
          const audio = document.createElement('audio');
          audio.controls = true; audio.style.cssText = 'width:100%;height:28px';
          audio.src = n.audioData; audioPlay.appendChild(audio);
        }
        renderAll(); scheduleSave();
        stream.getTracks().forEach(t => t.stop());
      };
      reader.readAsDataURL(blob);
      document.getElementById('mm-ep-rec').style.display = 'block';
      document.getElementById('mm-ep-stop').style.display = 'none';
    };
    recorder.start();
    document.getElementById('mm-ep-rec').style.display  = 'none';
    document.getElementById('mm-ep-stop').style.display = 'block';
    // Red pulse on rec button
    document.getElementById('mm-ep-stop').style.animation = 'cpulse 1s infinite';
  } catch (err) {
    alert('Microphone access denied: ' + err.message);
  }
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

// ─── Node Context Menu ────────────────────────────────────────────────────────

function showNodeMenu(n, mx, my) {
  let menu = document.getElementById('mm-ctx');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'mm-ctx';
    menu.style.cssText = 'position:fixed;background:#1a1a1a;border:1px solid #333;border-radius:5px;padding:4px 0;min-width:160px;z-index:400;box-shadow:0 6px 20px rgba(0,0,0,0.7);font-family:var(--font-mono);font-size:11px';
    document.body.appendChild(menu);
  }
  menu.innerHTML = `
    <div class="mm-ci" data-act="edit">✏ Edit node</div>
    <div class="mm-ci" data-act="child">+ Add child</div>
    <div class="mm-ci" data-act="sibling">→ Add sibling</div>
    <div class="mm-ci" style="border-top:1px solid #2a2a2a;margin-top:3px;padding-top:3px" data-act="color">🎨 Change color…</div>
    <div class="mm-ci" data-act="collapse">${n.collapsed ? '▸ Expand' : '▾ Collapse'}</div>
    <div class="mm-ci" style="color:#c66;border-top:1px solid #2a2a2a;margin-top:3px;padding-top:3px" data-act="delete">🗑 Delete subtree</div>
  `;
  menu.querySelectorAll('.mm-ci').forEach(ci => {
    ci.style.cssText += 'padding:6px 14px;cursor:pointer;';
    ci.addEventListener('mouseenter', () => ci.style.background = '#2a2a2a');
    ci.addEventListener('mouseleave', () => ci.style.background = '');
    ci.addEventListener('click', () => {
      const act = ci.getAttribute('data-act');
      if (act === 'edit')     { startEdit(n.id); }
      if (act === 'child')    { addChild(n.id); }
      if (act === 'sibling')  { if (n.parentId) addChild(n.parentId); }
      if (act === 'collapse') { toggleCollapse(n.id); }
      if (act === 'delete')   { if (confirm('Delete this node and all its children?')) { deleteNode(n.id); renderAll(); scheduleSave(); } }
      menu.style.display = 'none';
    });
  });
  menu.style.left = mx + 'px'; menu.style.top = my + 'px'; menu.style.display = 'block';
  setTimeout(() => document.addEventListener('click', () => { menu.style.display='none'; }, { once:true }), 50);
}

// ─── Sketch Layer — Fast Bitmap ───────────────────────────────────────────────
// Uses a persistent bitmap canvas. Drawing is live on a 2nd "live" canvas,
// committed to main on stroke end. Smooth bezier interpolation.

let sketchBitmap    = null;  // offscreen persistent bitmap
let sketchLiveCtx   = null;  // live stroke canvas (same as octx for now)
let sketchColor     = '#5aaa5a';
let sketchSize      = 3;
let sketchLastPt    = null;
let sketchPrevPt    = null;
let sketchLastTime  = 0;

const SKETCH_TOOLS = { pen: 'pen', marker: 'marker', eraser: 'eraser' };
let sketchTool = 'pen';

function setSketch(on) {
  sketchActive = on;
  svgEl.style.cursor = on ? 'none' : 'default';
  overlayCanvas.style.pointerEvents = on ? 'auto' : 'none';
  overlayCanvas.style.cursor = on ? 'none' : 'default';
  if (on) {
    // Ensure bitmap is initialised
    if (!sketchBitmap) initSketchBitmap();
    overlayCanvas.addEventListener('mousedown',  _skDown);
    overlayCanvas.addEventListener('mousemove',  _skMove);
    overlayCanvas.addEventListener('mouseup',    _skUp);
    overlayCanvas.addEventListener('mouseleave', _skUp);
    overlayCanvas.addEventListener('touchstart', _skTouchDown, { passive:false });
    overlayCanvas.addEventListener('touchmove',  _skTouchMove, { passive:false });
    overlayCanvas.addEventListener('touchend',   _skUp);
  } else {
    overlayCanvas.removeEventListener('mousedown',  _skDown);
    overlayCanvas.removeEventListener('mousemove',  _skMove);
    overlayCanvas.removeEventListener('mouseup',    _skUp);
    overlayCanvas.removeEventListener('mouseleave', _skUp);
  }
  renderSketchCursor(null);
}

function initSketchBitmap() {
  sketchBitmap = document.createElement('canvas');
  sketchBitmap.width  = overlayCanvas.width;
  sketchBitmap.height = overlayCanvas.height;
  const bctx = sketchBitmap.getContext('2d');
  // Restore existing lines into bitmap
  state.sketchLines.forEach(line => _renderLineOnCtx(bctx, line));
}

let _cursorRaf;
function renderSketchCursor(pt) {
  if (!sketchActive) return;
  // Composite bitmap + cursor onto overlay
  octx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  if (sketchBitmap) octx.drawImage(sketchBitmap, 0, 0);
  if (pt) {
    const r = sketchTool === 'eraser' ? sketchSize*4 : sketchSize;
    octx.save();
    octx.beginPath();
    octx.arc(pt.x, pt.y, r/2, 0, Math.PI*2);
    if (sketchTool === 'eraser') {
      octx.strokeStyle = '#888'; octx.lineWidth = 1; octx.setLineDash([3,3]);
      octx.stroke();
    } else {
      octx.fillStyle = sketchColor; octx.fill();
      octx.strokeStyle = 'rgba(255,255,255,0.4)'; octx.lineWidth = 0.5; octx.stroke();
    }
    octx.restore();
  }
}

function _ptFromMouse(e) {
  const r = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: Date.now() };
}
function _ptFromTouch(e) {
  e.preventDefault();
  const t = e.touches[0], r = overlayCanvas.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top, t: Date.now() };
}

function _skDown(e)       { if (!sketchActive) return; _beginStroke(_ptFromMouse(e)); }
function _skMove(e)       { _continueStroke(_ptFromMouse(e)); }
function _skUp()          { _endStroke(); }
function _skTouchDown(e)  { if (!sketchActive) return; _beginStroke(_ptFromTouch(e)); }
function _skTouchMove(e)  { _continueStroke(_ptFromTouch(e)); }

function _beginStroke(pt) {
  sketchDrawing = true;
  sketchLastPt  = pt;
  sketchPrevPt  = pt;
  sketchLastTime = pt.t;
  if (!sketchBitmap) initSketchBitmap();
  sketchCurrent = { tool: sketchTool, color: sketchColor, size: sketchSize, points: [pt] };
}

function _continueStroke(pt) {
  renderSketchCursor(pt);
  if (!sketchDrawing || !sketchCurrent) return;
  sketchCurrent.points.push(pt);

  const bctx = sketchBitmap.getContext('2d');
  const pts  = sketchCurrent.points;
  const n    = pts.length;

  if (sketchTool === 'eraser') {
    bctx.save();
    bctx.globalCompositeOperation = 'destination-out';
    bctx.beginPath();
    bctx.arc(pt.x, pt.y, sketchSize*4, 0, Math.PI*2);
    bctx.fill();
    bctx.restore();
  } else if (n >= 3) {
    // Smooth bezier: midpoints between last 3 points
    const p0 = pts[n-3], p1 = pts[n-2], p2 = pts[n-1];
    const mid1 = { x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 };
    const mid2 = { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 };
    // Speed-based width: faster = thinner
    const dt   = Math.max(1, pt.t - sketchLastTime);
    const dist = Math.hypot(p2.x-p1.x, p2.y-p1.y);
    const speed= dist / dt;
    const w    = Math.max(0.5, sketchSize * (1 - Math.min(speed*0.4, 0.6)));
    sketchLastTime = pt.t;

    bctx.save();
    if (sketchTool === 'marker') {
      bctx.globalAlpha = 0.35;
      bctx.globalCompositeOperation = 'multiply';
    }
    bctx.beginPath();
    bctx.moveTo(mid1.x, mid1.y);
    bctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    bctx.strokeStyle = sketchColor;
    bctx.lineWidth   = w;
    bctx.lineCap     = 'round';
    bctx.lineJoin    = 'round';
    bctx.stroke();
    bctx.restore();
  } else if (n === 2) {
    const p0 = pts[0], p1 = pts[1];
    bctx.beginPath();
    bctx.moveTo(p0.x, p0.y); bctx.lineTo(p1.x, p1.y);
    bctx.strokeStyle = sketchColor; bctx.lineWidth = sketchSize;
    bctx.lineCap = 'round'; bctx.stroke();
  }

  // Composite onto visible canvas immediately
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  octx.drawImage(sketchBitmap, 0, 0);
  sketchPrevPt = pt;
}

function _endStroke() {
  if (!sketchDrawing) return;
  sketchDrawing = false;
  if (sketchCurrent && sketchCurrent.points.length > 1) {
    // Store compact version (downsample to every 3rd point for save)
    const compact = { ...sketchCurrent, points: sketchCurrent.points.filter((_,i)=>i%3===0||i===sketchCurrent.points.length-1) };
    state.sketchLines.push(compact);
    scheduleSave();
  }
  sketchCurrent = null;
  renderSketchCursor(null);
}

function _renderLineOnCtx(ctx, line) {
  const pts = line.points;
  if (!pts || pts.length < 2) return;
  ctx.save();
  if (line.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, (line.size||3)*4, 0, Math.PI*2); ctx.fill();
    });
  } else {
    if (line.tool === 'marker') { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; }
    ctx.strokeStyle = line.color || '#5aaa5a';
    ctx.lineWidth   = line.size  || 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1; i<pts.length-1; i++) {
      const mx = (pts[i].x+pts[i+1].x)/2;
      const my = (pts[i].y+pts[i+1].y)/2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    ctx.stroke();
  }
  ctx.restore();
}

function redrawSketch() {
  if (!sketchBitmap) { initSketchBitmap(); return; }
  const bctx = sketchBitmap.getContext('2d');
  bctx.clearRect(0,0,sketchBitmap.width,sketchBitmap.height);
  state.sketchLines.forEach(line => _renderLineOnCtx(bctx, line));
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  octx.drawImage(sketchBitmap, 0, 0);
}

function clearSketch() {
  state.sketchLines = [];
  if (sketchBitmap) sketchBitmap.getContext('2d').clearRect(0,0,sketchBitmap.width,sketchBitmap.height);
  octx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  scheduleSave();
}

// Resize — rebuild bitmap from saved lines
function resizeCanvas() {
  const r = container.getBoundingClientRect();
  overlayCanvas.width  = r.width;
  overlayCanvas.height = r.height;
  sketchBitmap = null;  // will re-init on next draw
  if (state.sketchLines.length) initSketchBitmap();
  redrawSketch();
}

// ─── Auto Layout (tree) ───────────────────────────────────────────────────────

function autoLayout() {
  if (!state.rootId || !state.nodes[state.rootId]) return;
  layoutNode(state.rootId, 100, 0, 0);
  // Center on viewport
  const vals = Object.values(state.nodes);
  if (!vals.length) return;
  const minX = Math.min(...vals.map(n => n.x));
  const maxX = Math.max(...vals.map(n => n.x + n.w));
  const minY = Math.min(...vals.map(n => n.y - n.h/2));
  const maxY = Math.max(...vals.map(n => n.y + n.h/2));
  const r = container.getBoundingClientRect();
  const padX = (r.width  - (maxX - minX)) / 2;
  const padY = (r.height - (maxY - minY)) / 2;
  vals.forEach(n => { n.x -= minX - padX; n.y -= minY - padY; });
  state.viewport = { x: 0, y: 0, scale: 1 };
  applyViewport(); renderAll(); scheduleSave();
}

function layoutNode(id, x, y, depth) {
  const n = state.nodes[id]; if (!n) return 0;
  n.x = x; n.y = y;
  const vy = CHILD_OFFSET_Y;
  const vx = NODE_W + 80;
  if (!n.children.length) return vy;
  const heights = n.children.map(cid => {
    const cn = state.nodes[cid]; if (!cn) return vy;
    return Math.max(vy, layoutNode(cid, x + vx, 0, depth + 1));
  });
  const total = heights.reduce((a,b) => a+b, 0);
  let cy = y - total/2;
  n.children.forEach((cid, i) => {
    const cn = state.nodes[cid]; if (!cn) return;
    cn.y = cy + heights[i]/2; cn.x = x + vx;
    layoutSubtree(cid, cy);
    cy += heights[i];
  });
  return total;
}

function layoutSubtree(id, baseY) {
  const n = state.nodes[id]; if (!n) return;
  const vx = NODE_W + 80, vy = CHILD_OFFSET_Y;
  const heights = n.children.map(cid => Math.max(vy, subtreeHeight(cid)));
  const total = heights.reduce((a,b)=>a+b,0);
  let cy = n.y - total/2;
  n.children.forEach((cid, i) => {
    const cn = state.nodes[cid]; if (!cn) return;
    cn.x = n.x + vx; cn.y = cy + heights[i]/2;
    layoutSubtree(cid, cy);
    cy += heights[i];
  });
}

function subtreeHeight(id) {
  const n = state.nodes[id]; if (!n) return CHILD_OFFSET_Y;
  if (!n.children.length) return CHILD_OFFSET_Y;
  return n.children.reduce((s, cid) => s + subtreeHeight(cid), 0);
}

// ─── LaTeX Export ─────────────────────────────────────────────────────────────

const DEPTH_CMDS = ['\\chapter','\\section','\\subsection','\\subsubsection','\\paragraph','\\subparagraph'];

function exportToLatex(title) {
  if (!state.rootId || !state.nodes[state.rootId]) return '';
  const root = state.nodes[state.rootId];
  const lines = [
    `% Generated by Underleaf Mind Map — ${new Date().toLocaleDateString()}`,
    `% Source: ${title || 'Mind Map'}`,
    '',
    '\\documentclass[12pt,a4paper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{geometry}',
    '\\geometry{margin=2.5cm}',
    '',
    `\\title{${escTex(root.title)}}`,
    '\\author{}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
  ];
  walkExport(root.id, -1, lines);
  lines.push('', '\\end{document}');
  return lines.join('\n');
}

function walkExport(id, depth, lines) {
  const n = state.nodes[id]; if (!n) return;
  if (depth >= 0) {
    const cmd = DEPTH_CMDS[Math.min(depth, DEPTH_CMDS.length-1)];
    lines.push(`${cmd}{${escTex(n.title)}}`);
    lines.push('\\label{' + labelify(n.title) + '}');
    lines.push('');
    if (n.type === 'url' && n.body) {
      lines.push(`\\noindent\\href{${n.body}}{${escTex(n.title)}}\\\\`);
    } else if (n.type === 'image' && n.imageData) {
      lines.push('\\begin{figure}[h!]');
      lines.push('\\centering');
      lines.push(`% [Embedded image from node: ${escTex(n.title)}]`);
      lines.push(`\\caption{${escTex(n.title)}}`);
      lines.push('\\end{figure}');
    } else if (n.type === 'audio') {
      lines.push(`% [Audio note: ${escTex(n.title)}]`);
    } else if (n.body) {
      lines.push(escTex(n.body));
    }
    lines.push('');
  }
  n.children.forEach(cid => walkExport(cid, depth + 1, lines));
}

function escTex(s) {
  return (s||'').replace(/[&%$#_{}~^\\]/g, c => '\\' + c);
}

function labelify(s) {
  return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// ─── Zoom controls ────────────────────────────────────────────────────────────

function zoomIn()  { zoom(1.2); }
function zoomOut() { zoom(0.8); }
function zoomFit() {
  const vals = Object.values(state.nodes);
  if (!vals.length) return;
  const r = container.getBoundingClientRect();
  const minX = Math.min(...vals.map(n=>n.x)) - 20;
  const maxX = Math.max(...vals.map(n=>n.x+n.w)) + 20;
  const minY = Math.min(...vals.map(n=>n.y-n.h/2)) - 20;
  const maxY = Math.max(...vals.map(n=>n.y+n.h/2)) + 20;
  const scaleX = r.width  / (maxX - minX);
  const scaleY = r.height / (maxY - minY);
  const scale  = Math.min(scaleX, scaleY, 2);
  state.viewport = { x: -minX*scale + (r.width - (maxX-minX)*scale)/2,
                     y: -minY*scale + (r.height- (maxY-minY)*scale)/2, scale };
  applyViewport(); updateZoomLabel();
}

function zoom(factor) {
  const r = container.getBoundingClientRect();
  const cx = r.width/2, cy = r.height/2;
  const { x, y, scale } = state.viewport;
  const ns = Math.max(0.2, Math.min(3, scale * factor));
  state.viewport = { x: cx-(cx-x)*(ns/scale), y: cy-(cy-y)*(ns/scale), scale: ns };
  applyViewport(); updateZoomLabel();
}

function updateZoomLabel() {
  const el = document.getElementById('mm-zoom-label');
  if (el) el.textContent = Math.round(state.viewport.scale * 100) + '%';
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function mkSvg(tag) { return document.createElementNS(SVGNS, tag); }

// ─── Public API ───────────────────────────────────────────────────────────────

return {
  init,
  loadMap,
  saveMap,
  addRoot(title) {
    if (!state.rootId) {
      const id = createNode({ x:200, y:200, title: title||'Root', color:0 });
      state.rootId = id;
    } else {
      const n = state.nodes[state.rootId];
      if (n) { n.x=200; n.y=200; }
    }
    renderAll(); scheduleSave();
  },
  addChild,
  autoLayout,
  exportToLatex,
  setSketch,
  clearSketch,
  setSketchColor(c)  { sketchColor = c; },
  setSketchSize(s)   { sketchSize = s; },
  setSketchTool(t)   { sketchTool = t; },
  getSketchTool()    { return sketchTool; },
  zoomIn, zoomOut, zoomFit,
  stopEdit,
  getNodeCount() { return Object.keys(state.nodes).length; },
  getProjectId()  { return projectId; },
};

})();
