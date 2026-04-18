/**
 * Dark Underleaf — AI Module
 * Ollama detection, provider abstraction, LaTeX error fixing
 */

const http  = require('http');
const https = require('https');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function httpPost(url, body, headers = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const parsed  = new URL(url);
    const mod     = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      timeout:  timeoutMs,
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

async function detectOllama() {
  try {
    const data   = await httpGet(`${OLLAMA_HOST}/api/tags`, 2000);
    const models = (data.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
    return { available: true, host: OLLAMA_HOST, models };
  } catch {
    return { available: false, host: OLLAMA_HOST, models: [] };
  }
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function extractErrors(log) {
  const lines = (log || '').split('\n');
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^! /.test(l)) {
      const block = [l];
      for (let j = 1; j <= 5 && i + j < lines.length; j++) {
        const next = lines[i + j];
        if (next.trim()) block.push(next);
        if (/^l\.\d+/.test(next)) break;
      }
      errors.push(block.join('\n'));
    }
  }
  if (!errors.length) {
    lines.filter(l => /Undefined control|Missing \$|Extra \}|File .* not found/.test(l))
         .forEach(l => errors.push(l));
  }
  return errors.length ? errors : ['(no explicit errors detected — check warnings above)'];
}

function buildPrompt(errorLog, context) {
  const errors = extractErrors(errorLog);
  const { source, filename = 'main.tex', errorLines = [] } = context || {};

  let sourceSnippet = '';
  if (source && errorLines.length > 0) {
    const lines = source.split('\n');
    const snippets = errorLines.map(ln => {
      const start = Math.max(0, ln - 5);
      const end   = Math.min(lines.length, ln + 4);
      return lines.slice(start, end)
        .map((l, i) => `${(start + i + 1 === ln) ? '>>>' : '   '} ${start + i + 1}: ${l}`)
        .join('\n');
    });
    sourceSnippet = `\n\nRELEVANT SOURCE (${filename}):\n\`\`\`latex\n${snippets.join('\n---\n')}\n\`\`\``;
  } else if (source) {
    const preamble = source.split('\n').slice(0, 100).join('\n');
    sourceSnippet = `\n\nSOURCE PREAMBLE (first 100 lines of ${filename}):\n\`\`\`latex\n${preamble}\n\`\`\``;
  }

  return `You are a LaTeX expert. Analyze these compilation errors and provide precise, actionable fixes.

ERRORS:
${errors.join('\n\n')}
${sourceSnippet}

Respond in EXACTLY this format — do not deviate:

## Diagnosis
[Brief plain-English explanation of each error cause, one per bullet]

## Fixes

### Fix 1: [short title]
**Line:** [number or "preamble"]
**Problem:** [what is wrong]
**Replace with:**
\`\`\`latex
[corrected LaTeX code only]
\`\`\`
**Why:** [one sentence explanation]

[repeat Fix N blocks for each distinct error]

## Summary
[One sentence: the minimum change needed to compile successfully]`;
}

// ─── Providers ────────────────────────────────────────────────────────────────

async function callOllama(s, prompt) {
  const model = s.ollamaModel || 'llama3.2';
  const host  = s.ollamaHost  || OLLAMA_HOST;
  const { body } = await httpPost(`${host}/api/generate`, {
    model, prompt, stream: false,
    options: { temperature: 0.15, num_predict: 2048 },
  }, {}, 120000);
  if (!body.response) throw new Error('Ollama returned empty response');
  return body.response;
}

async function callClaude(s, prompt) {
  if (!s.claudeKey) throw new Error('Claude API key not configured');
  const model = s.claudeModel || 'claude-haiku-4-5-20251001';
  const { body } = await httpPost('https://api.anthropic.com/v1/messages', {
    model, max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }, { 'x-api-key': s.claudeKey, 'anthropic-version': '2023-06-01' });
  const text = body.content?.[0]?.text;
  if (!text) throw new Error(`Claude: ${JSON.stringify(body.error || body)}`);
  return text;
}

async function callOpenAI(s, prompt) {
  if (!s.openaiKey) throw new Error('OpenAI API key not configured');
  const base  = (s.openaiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = s.openaiModel || 'gpt-4o-mini';
  const { body } = await httpPost(`${base}/chat/completions`, {
    model, temperature: 0.15, max_tokens: 2048,
    messages: [
      { role: 'system', content: 'You are a LaTeX expert. Be precise and concise.' },
      { role: 'user',   content: prompt },
    ],
  }, { 'Authorization': `Bearer ${s.openaiKey}` });
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenAI: ${JSON.stringify(body.error || body)}`);
  return text;
}

async function callGemini(s, prompt) {
  if (!s.geminiKey) throw new Error('Gemini API key not configured');
  const model = s.geminiModel || 'gemini-1.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${s.geminiKey}`;
  const { body } = await httpPost(url, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 2048 },
  });
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini: ${JSON.stringify(body.error || body)}`);
  return text;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fixErrors(aiSettings, errorLog, context) {
  const prompt   = buildPrompt(errorLog, context);
  const provider = aiSettings.provider;
  let response;
  switch (provider) {
    case 'ollama': response = await callOllama(aiSettings, prompt); break;
    case 'claude': response = await callClaude(aiSettings, prompt); break;
    case 'openai': response = await callOpenAI(aiSettings, prompt); break;
    case 'gemini': response = await callGemini(aiSettings, prompt); break;
    default: throw new Error(`Unknown AI provider: "${provider}"`);
  }
  const modelName = { ollama: aiSettings.ollamaModel, claude: aiSettings.claudeModel, openai: aiSettings.openaiModel, gemini: aiSettings.geminiModel }[provider] || '?';
  return { provider, model: modelName, response };
}

module.exports = { detectOllama, fixErrors };
