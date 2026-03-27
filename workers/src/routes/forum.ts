import { Hono } from "hono";
import { html } from "hono/html";

const forumRouter = new Hono();

forumRouter.get("/forum", (c) => {
  return c.html(html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claw Clinic — Community Cures</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; max-width: 860px; margin: 0 auto; padding: 20px; line-height: 1.5; }

  /* Header */
  .header { margin-bottom: 28px; }
  h1 { font-size: 1.6rem; margin-bottom: 2px; }
  h1 span { color: #4a9eff; }
  .subtitle { color: #777; font-size: 0.9rem; }

  /* Tabs */
  .tabs { display: flex; gap: 6px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
  .tab { padding: 8px 18px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; background: transparent; color: #999; font-size: 0.85rem; transition: all 0.15s; }
  .tab:hover { color: #ccc; }
  .tab.active { background: #1a1a2e; border-color: #4a9eff; color: #4a9eff; }

  /* Search */
  .search-wrap { position: relative; margin-bottom: 16px; }
  .search { width: 100%; padding: 11px 14px 11px 38px; border: 1px solid #2a2a2a; border-radius: 10px; background: #111; color: #e0e0e0; font-size: 0.9rem; }
  .search:focus { outline: none; border-color: #4a9eff; background: #0d0d1a; }
  .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #555; font-size: 0.9rem; }

  /* Case cards */
  .case { border: 1px solid #1e1e1e; border-radius: 12px; padding: 18px; margin-bottom: 14px; background: #111; transition: border-color 0.15s; }
  .case:hover { border-color: #333; }
  .case-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px; }
  .disease-name { font-weight: 600; font-size: 1.05rem; }
  .code { font-family: "SF Mono", Menlo, monospace; font-size: 0.75rem; padding: 3px 8px; border-radius: 5px; background: #1a1a2e; color: #4a9eff; white-space: nowrap; }
  .symptoms { color: #888; font-size: 0.85rem; margin-bottom: 12px; }

  /* Steps */
  .steps { list-style: none; }
  .step { padding: 10px 12px; margin-bottom: 5px; border-radius: 8px; background: #0a0a0a; border: 1px solid #1a1a1a; font-size: 0.85rem; display: flex; align-items: center; gap: 10px; }
  .step-num { color: #555; font-weight: 600; min-width: 20px; }
  .step-content { flex: 1; min-width: 0; }
  .step-label { font-weight: 500; margin-bottom: 2px; }
  .step-desc { color: #888; font-size: 0.8rem; }
  .step code { display: block; background: #0d1117; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; color: #7dd3fc; margin-top: 4px; overflow-x: auto; font-family: "SF Mono", Menlo, monospace; }
  .copy-btn { padding: 5px 12px; border: 1px solid #2a2a2a; border-radius: 6px; background: transparent; color: #4ade80; cursor: pointer; font-size: 0.75rem; white-space: nowrap; transition: all 0.15s; }
  .copy-btn:hover { background: #0d1a0d; border-color: #4ade80; }

  /* Copy all */
  .copy-all-wrap { margin-top: 10px; display: flex; justify-content: flex-end; }
  .copy-all { padding: 6px 14px; border: 1px solid #2a2a2a; border-radius: 6px; background: transparent; color: #4ade80; cursor: pointer; font-size: 0.8rem; }
  .copy-all:hover { background: #0d1a0d; border-color: #4ade80; }

  /* Meta */
  .meta { display: flex; gap: 14px; margin-top: 10px; font-size: 0.75rem; color: #555; align-items: center; }
  .success-badge { color: #4ade80; background: #0d1a0d; padding: 2px 8px; border-radius: 4px; }
  .outcome-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .outcome-cured { background: #0d1a0d; color: #4ade80; }
  .outcome-partial { background: #1a1a0d; color: #eab308; }

  .empty { text-align: center; padding: 50px 20px; color: #555; }
  .empty p { margin-top: 8px; font-size: 0.85rem; }

  /* Submit form */
  .submit-section { display: none; }
  .submit-section.active { display: block; }

  /* Two-mode submit */
  .mode-toggle { display: flex; gap: 6px; margin-bottom: 18px; }
  .mode-btn { padding: 6px 14px; border: 1px solid #2a2a2a; border-radius: 6px; background: transparent; color: #888; cursor: pointer; font-size: 0.8rem; }
  .mode-btn.active { background: #1a1a2e; border-color: #4a9eff; color: #4a9eff; }

  .form-group { margin-bottom: 14px; }
  .form-group label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 5px; }
  .form-group .hint { font-size: 0.75rem; color: #555; margin-top: 3px; }
  .form-group input, .form-group textarea, .form-group select {
    width: 100%; padding: 10px 12px; border: 1px solid #2a2a2a; border-radius: 8px;
    background: #0d0d0d; color: #e0e0e0; font-size: 0.85rem; font-family: inherit;
  }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4a9eff; }
  .form-group textarea { min-height: 100px; resize: vertical; }

  .step-builder { border: 1px solid #1e1e1e; border-radius: 10px; padding: 14px; margin-bottom: 8px; background: #0a0a0a; }
  .step-builder .form-group { margin-bottom: 8px; }
  .step-builder .form-group:last-child { margin-bottom: 0; }
  .remove-step { float: right; padding: 2px 8px; border: none; background: transparent; color: #666; cursor: pointer; font-size: 0.8rem; }
  .remove-step:hover { color: #f87171; }
  .add-step { padding: 8px 14px; border: 1px dashed #2a2a2a; border-radius: 8px; background: transparent; color: #666; cursor: pointer; font-size: 0.8rem; width: 100%; margin-top: 4px; }
  .add-step:hover { border-color: #4a9eff; color: #4a9eff; }

  .submit-btn { padding: 11px 24px; border: none; border-radius: 8px; background: #4a9eff; color: #fff; cursor: pointer; font-size: 0.9rem; font-weight: 500; margin-top: 8px; }
  .submit-btn:hover { background: #3a8eef; }
  .submit-btn:disabled { background: #333; color: #666; cursor: not-allowed; }

  /* Toast */
  .toast { position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; border-radius: 10px; background: #0d1a0d; border: 1px solid #4ade80; color: #4ade80; font-size: 0.85rem; display: none; z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  .toast.error { background: #1a0d0d; border-color: #f87171; color: #f87171; }
  .toast.info { background: #0d0d1a; border-color: #4a9eff; color: #4a9eff; }
</style>
</head>
<body>

<div class="header">
  <h1><span>Claw Clinic</span> Community Cures</h1>
  <p class="subtitle">Proven fixes for AI agent issues. Submit what worked, apply what others found.</p>
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('browse')">Browse Cures</button>
  <button class="tab" onclick="showTab('submit')">Share a Cure</button>
</div>

<!-- Browse -->
<div id="browse-section">
  <div class="search-wrap">
    <span class="search-icon">&#128269;</span>
    <input class="search" type="text" placeholder="Search — try 'API key', 'loop', 'timeout', 'CFG.1.1'..." oninput="debounceSearch(this.value)">
  </div>
  <div id="cases-list"><div class="empty">Loading cures...</div></div>
</div>

<!-- Submit -->
<div id="submit-section" class="submit-section">
  <div class="mode-toggle">
    <button class="mode-btn active" onclick="setMode('simple')">Simple</button>
    <button class="mode-btn" onclick="setMode('advanced')">Advanced</button>
  </div>

  <!-- Simple mode: describe in plain language -->
  <form id="simple-form" onsubmit="submitSimple(event)">
    <div class="form-group">
      <label>What was the problem?</label>
      <textarea name="problem" required placeholder="My agent kept saying it couldn't find the API key, even though I had it set in the config file. Turned out the key was in the wrong format."></textarea>
      <div class="hint">Describe what went wrong — in your own words, any language.</div>
    </div>
    <div class="form-group">
      <label>How did you fix it?</label>
      <textarea name="solution" required placeholder="I ran: openclaw config set anthropic.apiKey sk-ant-xxx&#10;Then restarted the gateway: openclaw gateway restart&#10;&#10;The key format needed to start with sk-ant- not just sk-"></textarea>
      <div class="hint">Include the commands you ran and what finally worked. Paste terminal commands — they'll be auto-detected.</div>
    </div>
    <div class="form-group">
      <label>What agent / framework? (optional)</label>
      <input name="framework" placeholder="OpenClaw, Claude Code, Cursor, Copilot...">
    </div>
    <button type="submit" class="submit-btn">Share this cure</button>
  </form>

  <!-- Advanced mode: structured fields -->
  <form id="advanced-form" style="display:none" onsubmit="submitAdvanced(event)">
    <div class="form-group">
      <label>ICD-AI Code</label>
      <input name="icd_ai_code" required placeholder="CFG.1.1">
      <div class="hint">Department.Number.Variant — e.g., CFG = Configuration, NET = Network, AUTH = Authentication</div>
    </div>
    <div class="form-group">
      <label>Disease Name</label>
      <input name="disease_name" required placeholder="Invalid API Key Format">
    </div>
    <div class="form-group">
      <label>Symptoms</label>
      <textarea name="symptoms_text" required placeholder="Agent returns auth error on every request. Key is set but provider rejects it."></textarea>
    </div>
    <div class="form-group">
      <label>Treatment Steps</label>
      <div id="steps-container">
        <div class="step-builder" data-idx="0">
          <button type="button" class="remove-step" onclick="removeStep(this)" title="Remove step">&times;</button>
          <div class="form-group"><label>What to do</label><input name="step_label_0" required placeholder="Fix API key format"></div>
          <div class="form-group"><label>Command</label><input name="step_cmd_0" placeholder="openclaw config set anthropic.apiKey sk-ant-xxx"></div>
          <div class="form-group"><label>Why this helps</label><input name="step_desc_0" required placeholder="Sets the correctly formatted API key"></div>
        </div>
      </div>
      <button type="button" class="add-step" onclick="addStep()">+ Add another step</button>
    </div>
    <div class="form-group">
      <label>Outcome</label>
      <select name="outcome"><option value="cured">Fully cured</option><option value="partial">Partially fixed</option></select>
    </div>
    <div class="form-group">
      <label>Framework (optional)</label>
      <input name="framework" placeholder="OpenClaw, Claude Code, Cursor...">
    </div>
    <button type="submit" class="submit-btn">Submit Cure</button>
  </form>
</div>

<div class="toast" id="toast"></div>

<script>
const API = window.location.origin;
let searchTimeout;
let stepCount = 1;

// ── Browse ──

async function loadCases(query) {
  const url = query ? API + '/cases?q=' + encodeURIComponent(query) : API + '/cases';
  try {
    const res = await fetch(url);
    const data = await res.json();
    renderCases(data.cases || []);
  } catch (e) {
    document.getElementById('cases-list').innerHTML = '<div class="empty">Could not load cures.</div>';
  }
}

function renderCases(cases) {
  const el = document.getElementById('cases-list');
  if (!cases.length) {
    el.innerHTML = '<div class="empty"><p>No cures found yet.</p><p>Be the first — click "Share a Cure" above.</p></div>';
    return;
  }
  el.innerHTML = cases.map(renderCase).join('');
}

function renderCase(c) {
  const steps = (c.treatment_steps || []).map((s, i) => {
    let content = '<div class="step-content">';
    content += '<div class="step-label">' + esc(s.label || s.description) + '</div>';
    if (s.description && s.label) content += '<div class="step-desc">' + esc(s.description) + '</div>';
    if (s.command) content += '<code>' + esc(s.command) + '</code>';
    content += '</div>';
    const copyBtn = s.command ? '<button class="copy-btn" onclick="copyCmd(this,\'' + escAttr(s.command) + '\')">Copy</button>' : '';
    return '<li class="step"><span class="step-num">' + (i+1) + '</span>' + content + copyBtn + '</li>';
  }).join('');

  const allCmds = (c.treatment_steps || []).filter(s => s.command).map(s => s.command).join('\\n');
  const copyAll = allCmds ? '<div class="copy-all-wrap"><button class="copy-all" onclick="copyCmd(this,\'' + escAttr(allCmds) + '\')">Copy all commands</button></div>' : '';

  const outcomeCls = c.outcome === 'cured' ? 'outcome-cured' : 'outcome-partial';

  return '<div class="case">' +
    '<div class="case-header"><span class="disease-name">' + esc(c.disease_name) + '</span><span class="code">' + esc(c.icd_ai_code) + '</span></div>' +
    '<div class="symptoms">' + esc(c.symptoms_text).slice(0, 300) + '</div>' +
    '<ul class="steps">' + steps + '</ul>' +
    copyAll +
    '<div class="meta">' +
      '<span class="success-badge">' + (c.success_count || 0) + ' uses</span>' +
      '<span class="outcome-badge ' + outcomeCls + '">' + (c.outcome || 'cured') + '</span>' +
      '<span>' + timeAgo(c.created_at) + '</span>' +
      (c.framework ? '<span>' + esc(c.framework) + '</span>' : '') +
    '</div>' +
  '</div>';
}

function debounceSearch(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadCases(val), 300);
}

// ── Tabs & modes ──

function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('browse-section').style.display = tab === 'browse' ? 'block' : 'none';
  document.getElementById('submit-section').className = tab === 'submit' ? 'submit-section active' : 'submit-section';
}

function setMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('simple-form').style.display = mode === 'simple' ? 'block' : 'none';
  document.getElementById('advanced-form').style.display = mode === 'advanced' ? 'block' : 'none';
}

// ── Simple submit (human-friendly) ──

async function submitSimple(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const problem = f.get('problem').toString().trim();
  const solution = f.get('solution').toString().trim();
  const framework = f.get('framework')?.toString().trim() || undefined;

  // Extract commands from solution text (lines starting with common command patterns)
  const lines = solution.split('\\n');
  const steps = [];
  let currentDesc = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isCommand(trimmed)) {
      if (currentDesc.length > 0) {
        steps.push({ label: currentDesc.join(' ').slice(0, 80), description: currentDesc.join(' '), command: undefined });
        currentDesc = [];
      }
      steps.push({ label: trimmed.slice(0, 60), command: trimmed, description: trimmed });
    } else if (trimmed) {
      currentDesc.push(trimmed);
    }
  }
  if (currentDesc.length > 0) {
    steps.push({ label: currentDesc.join(' ').slice(0, 80), description: currentDesc.join(' '), command: undefined });
  }
  if (steps.length === 0) {
    steps.push({ label: 'Manual fix', description: solution, command: undefined });
  }

  // Auto-generate a disease name from the problem
  const diseaseName = problem.split(/[.!?]/)[0].slice(0, 60) || 'Agent Issue';
  // Auto-generate an ICD-AI code from keywords
  const code = guessCode(problem);

  const body = {
    icd_ai_code: code,
    disease_name: diseaseName,
    symptoms_text: problem,
    treatment_steps: steps,
    outcome: 'cured',
    framework: framework,
  };

  await doSubmit(body, e.target);
}

function isCommand(line) {
  const prefixes = ['openclaw ', 'sudo ', 'npm ', 'pnpm ', 'yarn ', 'pip ', 'apt ', 'brew ',
    'curl ', 'wget ', 'cat ', 'grep ', 'ls ', 'cd ', 'mkdir ', 'rm ', 'cp ', 'mv ',
    'docker ', 'git ', 'node ', 'python ', 'systemctl ', 'journalctl ', 'export ',
    'echo ', 'kill ', 'pkill ', 'chmod ', 'chown ', 'sed ', 'awk ', 'find '];
  const lower = line.toLowerCase();
  return prefixes.some(p => lower.startsWith(p)) || lower.startsWith('$ ') || lower.startsWith('> ');
}

function guessCode(text) {
  const lower = text.toLowerCase();
  if (lower.match(/api.?key|token|auth|credential|login/)) return 'CFG.1.1';
  if (lower.match(/connect|network|unreachable|timeout|dns/)) return 'NET.1.1';
  if (lower.match(/loop|infinite|repeat|stuck|hang/)) return 'LOOP.1.1';
  if (lower.match(/cost|token|expensive|billing|usage/)) return 'COST.1.1';
  if (lower.match(/slow|latency|performance|lag/)) return 'PERF.1.1';
  if (lower.match(/permission|denied|forbidden|access/)) return 'PERM.1.1';
  if (lower.match(/memory|context|overflow|forget/)) return 'CTX.1.1';
  if (lower.match(/config|setting|setup|install/)) return 'CFG.2.1';
  if (lower.match(/tool|function|shell|exec/)) return 'GEN.1.1';
  if (lower.match(/model|provider|ollama|openai|anthropic/)) return 'CFG.3.1';
  return 'GEN.1.1';
}

// ── Advanced submit ──

function addStep() {
  const c = document.getElementById('steps-container');
  const n = stepCount++;
  c.insertAdjacentHTML('beforeend',
    '<div class="step-builder" data-idx="'+n+'"><button type="button" class="remove-step" onclick="removeStep(this)">&times;</button><div class="form-group"><label>What to do</label><input name="step_label_'+n+'" required></div><div class="form-group"><label>Command</label><input name="step_cmd_'+n+'"></div><div class="form-group"><label>Why this helps</label><input name="step_desc_'+n+'" required></div></div>'
  );
}

function removeStep(btn) {
  const builder = btn.closest('.step-builder');
  if (document.querySelectorAll('.step-builder').length > 1) builder.remove();
}

async function submitAdvanced(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const steps = [];
  document.querySelectorAll('.step-builder').forEach(el => {
    const idx = el.dataset.idx;
    const label = f.get('step_label_' + idx);
    if (!label) return;
    steps.push({
      label: label.toString(),
      command: f.get('step_cmd_' + idx)?.toString() || undefined,
      description: f.get('step_desc_' + idx)?.toString() || ''
    });
  });

  const body = {
    icd_ai_code: f.get('icd_ai_code'),
    disease_name: f.get('disease_name'),
    symptoms_text: f.get('symptoms_text'),
    treatment_steps: steps,
    outcome: f.get('outcome'),
    framework: f.get('framework')?.toString() || undefined,
  };

  await doSubmit(body, e.target);
}

async function doSubmit(body, form) {
  const btn = form.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    const res = await fetch(API + '/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      toast('Cure shared! Thank you, doctor.');
      form.reset();
      showTab('browse');
      document.querySelector('.tab').click();
      loadCases();
    } else {
      const err = await res.json();
      toast('Error: ' + (err.error || 'submission failed'), true);
    }
  } catch (err) {
    toast('Network error — check your connection', true);
  } finally {
    btn.disabled = false;
    btn.textContent = form.id === 'simple-form' ? 'Share this cure' : 'Submit Cure';
  }
}

// ── Utils ──

function copyCmd(btn, cmd) {
  const text = cmd.replace(/\\\\n/g, '\\n');
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    toast('Copied to clipboard — paste in your terminal', false, 'info');
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

function toast(msg, isError, cls) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + (cls ? ' ' + cls : '');
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3500);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return (s || '').replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/\\n/g, '\\\\n'); }

function timeAgo(ts) {
  if (!ts) return '';
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d/60000) + 'm ago';
  if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
  return Math.floor(d/86400000) + 'd ago';
}

loadCases();
</script>
</body>
</html>`);
});

export default forumRouter;
