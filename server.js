/**
 * Dark Underleaf — Server
 * Local LaTeX IDE backend: file system, compilation, engine detection
 */

const express       = require('express');
const http          = require('http');
const WebSocket     = require('ws');
const path          = require('path');
const fs            = require('fs-extra');
const { spawn, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const multer        = require('multer');
const archiver      = require('archiver');
const chokidar      = require('chokidar');
const os            = require('os');
const { detectOllama, fixErrors } = require('./ai');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT          = process.env.PORT || 3737;
const DATA_DIR      = process.env.DU_DATA || path.join(os.homedir(), 'dark-underleaf');
const PROJECTS_DIR  = path.join(DATA_DIR, 'projects');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LOG_FILE      = path.join(DATA_DIR, 'server.log');

// ─── Bootstrap ───────────────────────────────────────────────────────────────

fs.ensureDirSync(PROJECTS_DIR);

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  engines: {},
  defaultEngine: 'pdflatex',
  projectsDir: PROJECTS_DIR,
  autoCompile: false,
  autoCompileDelay: 2000,
  fontSize: 14,
  wordWrap: false,
  editorTheme: 'underleaf-bw',
  firstRun: true,
  theme: 'bw',
  ai: {
    provider:    null,
    ollamaHost:  'http://localhost:11434',
    ollamaModel: null,
    claudeKey:   '',
    claudeModel: 'claude-haiku-4-5-20251001',
    openaiKey:   '',
    openaiBase:  'https://api.openai.com/v1',
    openaiModel: 'gpt-4o-mini',
    geminiKey:   '',
    geminiModel: 'gemini-1.5-flash',
  },
};

async function loadSettings() {
  if (await fs.pathExists(SETTINGS_FILE)) {
    return { ...DEFAULT_SETTINGS, ...await fs.readJson(SETTINGS_FILE) };
  }
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings) {
  await fs.writeJson(SETTINGS_FILE, settings, { spaces: 2 });
}

// ─── Engine Detection ────────────────────────────────────────────────────────

const SEARCH_PATHS = [
  '/Library/TeX/texbin',
  '/usr/local/texlive/2024/bin/universal-darwin',
  '/usr/local/texlive/2023/bin/universal-darwin',
  '/usr/local/texlive/2022/bin/universal-darwin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/opt/local/bin',
  // Linux
  '/usr/local/texlive/2024/bin/x86_64-linux',
  '/usr/local/texlive/2023/bin/x86_64-linux',
  '/usr/local/texlive/2024/bin/aarch64-linux',
];

const ENGINE_NAMES = ['pdflatex', 'xelatex', 'lualatex', 'latex', 'platex', 'bibtex', 'biber', 'makeindex'];

async function detectEngines() {
  const found = {};

  // Try `which` first
  for (const eng of ENGINE_NAMES) {
    try {
      const p = await new Promise((res, rej) => {
        exec(`which ${eng}`, (err, stdout) => {
          if (err || !stdout.trim()) rej();
          else res(stdout.trim());
        });
      });
      found[eng] = p;
    } catch {}
  }

  // Scan known paths
  for (const dir of SEARCH_PATHS) {
    if (!await fs.pathExists(dir)) continue;
    for (const eng of ENGINE_NAMES) {
      if (found[eng]) continue;
      const full = path.join(dir, eng);
      if (await fs.pathExists(full)) {
        found[eng] = full;
      }
    }
  }

  return found;
}

// ─── Templates ───────────────────────────────────────────────────────────────

const TEMPLATES = {
  blank: {
    label: 'Blank',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper]{article}

\\begin{document}

Hello, \\LaTeX!

\\end{document}
`
    }
  },
  article: {
    label: 'Article',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{hyperref}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{microtype}

\\geometry{margin=2.5cm}

\\title{Document Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Abstract text here.
\\end{abstract}

\\section{Introduction}
\\label{sec:intro}

Begin writing here. You can reference Section~\\ref{sec:intro}.

\\section{Conclusion}

Concluding remarks.

\\bibliography{references}
\\bibliographystyle{plain}

\\end{document}
`,
      'references.bib': `@article{example2024,
  author  = {Author, First and Coauthor, Second},
  title   = {An Example Article},
  journal = {Journal Name},
  year    = {2024},
  volume  = {1},
  pages   = {1--10},
}
`
    }
  },
  beamer: {
    label: 'Beamer Presentation',
    files: {
      'main.tex': `\\documentclass[aspectratio=169,12pt]{beamer}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{tikz}

\\usetheme{Madrid}
\\usecolortheme{default}

\\title{Presentation Title}
\\subtitle{Subtitle Here}
\\author{Author Name}
\\institute{Institution}
\\date{\\today}

\\begin{document}

\\begin{frame}
\\titlepage
\\end{frame}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}

\\begin{frame}{Introduction}
\\begin{itemize}
  \\item First point
  \\item Second point
  \\item Third point
\\end{itemize}
\\end{frame}

\\section{Main Content}

\\begin{frame}{A Frame with Columns}
\\begin{columns}
  \\begin{column}{0.5\\textwidth}
    Left column content
  \\end{column}
  \\begin{column}{0.5\\textwidth}
    Right column content
  \\end{column}
\\end{columns}
\\end{frame}

\\section{Conclusion}

\\begin{frame}{Conclusion}
\\begin{block}{Summary}
  Key takeaways here.
\\end{block}
\\end{frame}

\\end{document}
`
    }
  },
  thesis: {
    label: 'Thesis / Book',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper,twoside]{book}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{hyperref}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{fancyhdr}
\\usepackage{microtype}
\\usepackage{cleveref}

\\geometry{top=3cm,bottom=3cm,inner=3.5cm,outer=2.5cm}

\\hypersetup{
  colorlinks=true,
  linkcolor=blue,
  citecolor=blue,
  urlcolor=blue,
}

\\title{Thesis Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\frontmatter
\\maketitle
\\tableofcontents

\\mainmatter

\\chapter{Introduction}
\\label{ch:intro}

Introduction goes here.

\\chapter{Background}
\\label{ch:background}

Background material.

\\chapter{Methodology}
\\label{ch:method}

Methods described here.

\\chapter{Results}
\\label{ch:results}

Results presented here.

\\chapter{Conclusion}
\\label{ch:conclusion}

Conclusions and future work.

\\backmatter

\\bibliography{references}
\\bibliographystyle{plain}

\\end{document}
`,
      'references.bib': `@book{examplebook2024,
  author    = {Author, First},
  title     = {Example Book},
  publisher = {Publisher Name},
  year      = {2024},
}
`
    }
  }
};

// ─── Express App ─────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: os.tmpdir() });

// ─── WebSocket Hub ───────────────────────────────────────────────────────────

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, ...data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getProjectDir(id) {
  const settings = await loadSettings();
  const baseDir  = settings.projectsDir || PROJECTS_DIR;
  return path.join(baseDir, id);
}

function sanitizePath(base, rel) {
  const full = path.resolve(base, rel.replace(/^\/+/, ''));
  if (!full.startsWith(path.resolve(base))) throw new Error('Path traversal denied');
  return full;
}

async function buildFileTree(dir, base) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result  = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.output') continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    if (e.isDirectory()) {
      result.push({ name: e.name, path: rel, type: 'dir', children: await buildFileTree(abs, base) });
    } else {
      const stat = await fs.stat(abs);
      result.push({ name: e.name, path: rel, type: 'file', size: stat.size });
    }
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Routes: Status & Settings ───────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  const settings = await loadSettings();
  res.json({ ok: true, version: '1.0.0', settings });
});

app.get('/api/detect-latex', async (req, res) => {
  const engines = await detectEngines();
  res.json({ engines });
});

app.get('/api/settings', async (req, res) => {
  res.json(await loadSettings());
});

app.post('/api/settings', async (req, res) => {
  const current  = await loadSettings();
  const updated  = { ...current, ...req.body, firstRun: false };
  await saveSettings(updated);
  res.json({ ok: true, settings: updated });
});

// ─── Routes: Projects ────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  const settings = await loadSettings();
  const baseDir  = settings.projectsDir || PROJECTS_DIR;
  await fs.ensureDir(baseDir);
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const projects = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = path.join(baseDir, e.name, '.meta.json');
    const meta = await fs.pathExists(metaPath) ? await fs.readJson(metaPath) : {};
    const stat = await fs.stat(path.join(baseDir, e.name));
    projects.push({ id: e.name, name: meta.name || e.name, engine: meta.engine, created: meta.created, modified: stat.mtime });
  }
  projects.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  res.json(projects);
});

app.post('/api/projects', async (req, res) => {
  const { name, template = 'article' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const settings = await loadSettings();
  const baseDir  = settings.projectsDir || PROJECTS_DIR;
  const id       = uuidv4();
  const projDir  = path.join(baseDir, id);
  await fs.ensureDir(projDir);
  await fs.ensureDir(path.join(projDir, '.output'));

  // Write template files
  const tpl = TEMPLATES[template] || TEMPLATES.article;
  for (const [fname, content] of Object.entries(tpl.files)) {
    await fs.writeFile(path.join(projDir, fname), content, 'utf8');
  }

  // Write meta
  const meta = { name, engine: null, template, created: new Date().toISOString() };
  await fs.writeJson(path.join(projDir, '.meta.json'), meta, { spaces: 2 });

  res.json({ id, name, created: meta.created });
});

app.get('/api/projects/:id', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'Not found' });
  const meta = await fs.pathExists(path.join(dir, '.meta.json'))
    ? await fs.readJson(path.join(dir, '.meta.json')) : {};
  res.json({ id: req.params.id, ...meta });
});

app.put('/api/projects/:id', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'Not found' });
  const metaPath = path.join(dir, '.meta.json');
  const meta = await fs.pathExists(metaPath) ? await fs.readJson(metaPath) : {};
  Object.assign(meta, req.body);
  await fs.writeJson(metaPath, meta, { spaces: 2 });
  res.json({ ok: true });
});

app.delete('/api/projects/:id', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'Not found' });
  await fs.remove(dir);
  res.json({ ok: true });
});

// ─── Routes: Files ───────────────────────────────────────────────────────────

app.get('/api/projects/:id/files', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'Not found' });
  const tree = await buildFileTree(dir, dir);
  res.json(tree);
});

app.get('/api/projects/:id/file', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const file = sanitizePath(dir, req.query.path || 'main.tex');
  if (!await fs.pathExists(file)) return res.status(404).json({ error: 'File not found' });
  const stat = await fs.stat(file);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
  const content = await fs.readFile(file, 'utf8');
  res.json({ path: req.query.path, content });
});

app.post('/api/projects/:id/file', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const file = sanitizePath(dir, req.query.path || req.body.path || 'untitled.tex');
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, req.body.content || '', 'utf8');
  broadcast('file:changed', { projectId: req.params.id, path: req.query.path });
  res.json({ ok: true });
});

app.delete('/api/projects/:id/file', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const file = sanitizePath(dir, req.query.path);
  if (!await fs.pathExists(file)) return res.status(404).json({ error: 'Not found' });
  await fs.remove(file);
  res.json({ ok: true });
});

app.post('/api/projects/:id/mkdir', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const newDir = sanitizePath(dir, req.body.path);
  await fs.ensureDir(newDir);
  res.json({ ok: true });
});

app.post('/api/projects/:id/rename', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const from = sanitizePath(dir, req.body.from);
  const to   = sanitizePath(dir, req.body.to);
  await fs.move(from, to);
  res.json({ ok: true });
});

// Upload file into project
app.post('/api/projects/:id/upload', upload.array('files'), async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  const uploaded = [];
  for (const f of (req.files || [])) {
    const dest = sanitizePath(dir, f.originalname);
    await fs.move(f.path, dest, { overwrite: true });
    uploaded.push(f.originalname);
  }
  res.json({ ok: true, uploaded });
});

// Download project as ZIP
app.get('/api/projects/:id/download', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  if (!await fs.pathExists(dir)) return res.status(404).end();
  const meta = await fs.pathExists(path.join(dir, '.meta.json'))
    ? await fs.readJson(path.join(dir, '.meta.json')) : {};
  const name = (meta.name || req.params.id).replace(/[^a-z0-9_-]/gi, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  const archive = archiver('zip');
  archive.pipe(res);
  archive.glob('**/*', { cwd: dir, ignore: ['.output/**'] });
  archive.finalize();
});

// ─── Routes: Compilation ─────────────────────────────────────────────────────

const compilingProjects = new Set();

app.post('/api/projects/:id/compile', async (req, res) => {
  const { id } = req.params;
  if (compilingProjects.has(id)) {
    return res.status(409).json({ error: 'Already compiling' });
  }

  const dir      = await getProjectDir(id);
  if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'Not found' });

  const settings = await loadSettings();
  const meta     = await fs.pathExists(path.join(dir, '.meta.json'))
    ? await fs.readJson(path.join(dir, '.meta.json')) : {};

  const engineName  = req.body.engine || meta.engine || settings.defaultEngine || 'pdflatex';
  const engines     = settings.engines || await detectEngines();
  const enginePath  = engines[engineName] || engineName;
  const mainFile    = req.body.mainFile || 'main.tex';
  const outputDir   = path.join(dir, '.output');
  const runBibtex   = req.body.bibtex !== false;

  await fs.ensureDir(outputDir);

  compilingProjects.add(id);
  res.json({ ok: true, status: 'compiling' });

  broadcast('compile:start', { projectId: id, engine: engineName });

  const startTime = Date.now();
  let fullLog = '';
  let errors = 0;
  let warnings = 0;

  // Track error lines to avoid double-counting across passes
  const seenErrors = new Set();

  function logLine(line) {
    fullLog += line + '\n';
    broadcast('compile:log', { projectId: id, line });
    // Only count unique error lines (avoids inflating count across repeated passes)
    if (/^! /.test(line) && !seenErrors.has(line)) {
      seenErrors.add(line);
      errors++;
    }
    if (/^LaTeX Warning|^Package .* Warning/.test(line)) warnings++;
  }

  // Returns exit code
  async function runCompilerPass() {
    return new Promise((resolve) => {
      const proc = spawn(enginePath, [
        '-interaction=nonstopmode',   // show all errors, don't halt
        `-output-directory=.output`,
        mainFile
      ], {
        cwd: dir,
        env: {
          ...process.env,
          TEXMFOUTPUT: outputDir,
          // Tell TeX where to find inputs (needed when output-directory is set)
          TEXINPUTS: `.:${dir}:`,
        }
      });
      proc.stdout.on('data', d => d.toString().split('\n').forEach(logLine));
      proc.stderr.on('data', d => d.toString().split('\n').forEach(logLine));
      proc.on('close', resolve);
    });
  }

  try {
    // Pass 1
    logLine('[Dark Underleaf] Pass 1…');
    await runCompilerPass();

    // Stop here if fatal errors found — no point running more passes
    if (errors > 0) {
      logLine(`[Dark Underleaf] Stopping: ${errors} error(s) found. Fix them and recompile.`);
    } else {
      // BibTeX pass if .bib files present, requested, and first pass clean
      if (runBibtex) {
        const hasBib = (await fs.readdir(dir)).some(f => f.endsWith('.bib'));
        if (hasBib) {
          logLine('[Dark Underleaf] Running bibtex…');
          const mainBase = mainFile.replace('.tex', '');
          // BibTeX must run from inside .output/ and needs BIBINPUTS pointing
          // back to the project dir so it can find the .bib files there.
          await new Promise((resolve) => {
            const bibPath = settings.engines?.bibtex || 'bibtex';
            const bib = spawn(bibPath, [mainBase], {
              cwd: outputDir,
              env: {
                ...process.env,
                BIBINPUTS: `.:${dir}:`,
                BSTINPUTS: `.:${dir}:`,
                openout_any: 'a',
              }
            });
            bib.stdout.on('data', d => d.toString().split('\n').forEach(logLine));
            bib.stderr.on('data', d => d.toString().split('\n').forEach(logLine));
            bib.on('close', resolve);
          }).catch(e => logLine(`[Dark Underleaf] bibtex warning: ${e.message}`));

          // Two more passes to resolve cross-references
          logLine('[Dark Underleaf] Pass 2 (post-bibtex)…');
          await runCompilerPass();
          logLine('[Dark Underleaf] Pass 3 (cross-refs)…');
          await runCompilerPass();
        } else {
          // No .bib — still do a second pass for cross-refs/TOC
          logLine('[Dark Underleaf] Pass 2 (cross-refs)…');
          await runCompilerPass();
        }
      }
    }

    // Write log
    const logPath = path.join(outputDir, 'compilation.log');
    await fs.writeFile(logPath, fullLog, 'utf8');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const hasPdf   = await fs.pathExists(path.join(outputDir, mainFile.replace('.tex', '.pdf')));

    broadcast('compile:done', {
      projectId: id,
      success: hasPdf && errors === 0,
      errors,
      warnings,
      duration,
      pdfReady: hasPdf
    });

    logLine(`\n[Dark Underleaf] Compilation ${hasPdf ? 'succeeded' : 'failed'} in ${duration}s — ${errors} errors, ${warnings} warnings`);
  } catch (err) {
    broadcast('compile:done', { projectId: id, success: false, errors: 1, warnings, pdfReady: false, error: err.message });
    logLine(`[Dark Underleaf] Fatal error: ${err.message}`);
  } finally {
    compilingProjects.delete(id);
  }
});

app.get('/api/projects/:id/pdf', async (req, res) => {
  const dir     = await getProjectDir(req.params.id);
  const main    = req.query.file || 'main';
  const pdfPath = path.join(dir, '.output', `${main}.pdf`);
  if (!await fs.pathExists(pdfPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(pdfPath).pipe(res);
});

app.get('/api/projects/:id/log', async (req, res) => {
  const dir     = await getProjectDir(req.params.id);
  const logPath = path.join(dir, '.output', 'compilation.log');
  if (!await fs.pathExists(logPath)) return res.json({ log: '' });
  const log = await fs.readFile(logPath, 'utf8');
  res.json({ log });
});

// ─── Routes: AI ──────────────────────────────────────────────────────────────

// Detect Ollama and list models
app.get('/api/ai/ollama', async (req, res) => {
  const result = await detectOllama();
  res.json(result);
});

// Fix errors using configured AI provider
app.post('/api/ai/fix', async (req, res) => {
  const { projectId, errorLog, filename } = req.body;

  // Get AI settings from main settings
  const settings   = await loadSettings();
  const aiSettings = settings.ai || {};

  if (!aiSettings.provider) {
    return res.status(400).json({ error: 'No AI provider configured. Open Settings → AI Assistant.' });
  }

  // Get source context if project is specified
  let context = { filename, errorLines: [] };
  if (projectId) {
    try {
      const dir      = await getProjectDir(projectId);
      const srcFile  = path.join(dir, filename || 'main.tex');
      if (await fs.pathExists(srcFile)) {
        context.source = await fs.readFile(srcFile, 'utf8');
      }
      // Extract error line numbers from log
      const lineMatches = (errorLog || '').matchAll(/l\.(\d+)/g);
      context.errorLines = [...new Set([...lineMatches].map(m => parseInt(m[1])))];
    } catch {}
  }

  try {
    const result = await fixErrors(aiSettings, errorLog || '', context);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Routes: File Upload (drag-drop) ────────────────────────────────────────

app.post('/api/projects/:id/upload', async (req, res) => {
  const dir = await getProjectDir(req.params.id);
  const { filename, data, mime } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'No filename or data' });
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
  const buf  = Buffer.from(data, 'base64');
  await fs.writeFile(path.join(dir, safe), buf);
  res.json({ ok: true, filename: safe });
});

// ─── Routes: Annotations ────────────────────────────────────────────────────

app.get('/api/projects/:id/annotations/:filename', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const safe = req.params.filename.replace(/[/\\]/g,'');
  const fp   = path.join(dir, '.annotations', safe + '.json');
  if (!await fs.pathExists(fp)) return res.json({ notes:[], arrows:[] });
  res.json(await fs.readJson(fp));
});

app.post('/api/projects/:id/annotations/:filename', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const safe = req.params.filename.replace(/[/\\]/g,'');
  const aDir = path.join(dir, '.annotations');
  await fs.ensureDir(aDir);
  await fs.writeJson(path.join(aDir, safe + '.json'), req.body, { spaces: 2 });
  res.json({ ok: true });
});

// ─── Routes: Mind Map ────────────────────────────────────────────────────────

app.get('/api/projects/:id/mindmap', async (req, res) => {
  const dir    = await getProjectDir(req.params.id);
  const mmDir  = path.join(dir, '.mindmap');
  const mapFile= path.join(mmDir, 'map.json');
  if (!await fs.pathExists(mapFile)) {
    return res.json({ nodes: {}, rootId: null, viewport: { x: 200, y: 200, scale: 1 }, sketchLines: [] });
  }
  res.json(await fs.readJson(mapFile));
});

app.post('/api/projects/:id/mindmap', async (req, res) => {
  const dir   = await getProjectDir(req.params.id);
  const mmDir = path.join(dir, '.mindmap');
  await fs.ensureDir(mmDir);
  await fs.writeJson(path.join(mmDir, 'map.json'), req.body, { spaces: 2 });
  res.json({ ok: true });
});

app.post('/api/projects/:id/mindmap/audio', async (req, res) => {
  const dir   = await getProjectDir(req.params.id);
  const mmDir = path.join(dir, '.mindmap');
  await fs.ensureDir(mmDir);
  const { data, nodeId } = req.body;
  if (!data) return res.status(400).json({ error: 'No audio data' });
  const fname = `audio-${nodeId || uuidv4()}.webm`;
  const buf   = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  await fs.writeFile(path.join(mmDir, fname), buf);
  res.json({ ok: true, filename: fname });
});

app.get('/api/projects/:id/mindmap/audio/:fname', async (req, res) => {
  const dir  = await getProjectDir(req.params.id);
  const fp   = path.join(dir, '.mindmap', req.params.fname);
  if (!await fs.pathExists(fp)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/webm');
  fs.createReadStream(fp).pipe(res);
});

app.post('/api/projects/:id/mindmap/export', async (req, res) => {
  const dir    = await getProjectDir(req.params.id);
  const { filename, content } = req.body;
  const fname  = (filename || 'mindmap-outline.tex').replace(/[\/]/g,'');
  await fs.writeFile(path.join(dir, fname), content, 'utf8');
  res.json({ ok: true, filename: fname });
});

// ─── Routes: Templates ───────────────────────────────────────────────────────

app.get('/api/templates', (req, res) => {
  res.json(Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label })));
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  ☽  Dark Underleaf`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Server:   http://localhost:${PORT}`);
  console.log(`  Projects: ${PROJECTS_DIR}`);
  console.log(`  Data:     ${DATA_DIR}`);
  console.log(`  ─────────────────────────────────\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
