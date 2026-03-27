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
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: #888; margin-bottom: 24px; font-size: 0.9rem; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .tab { padding: 8px 16px; border: 1px solid #333; border-radius: 6px; cursor: pointer; background: transparent; color: #ccc; font-size: 0.85rem; }
  .tab.active { background: #1a1a2e; border-color: #4a9eff; color: #4a9eff; }
  .search { width: 100%; padding: 10px 14px; border: 1px solid #333; border-radius: 8px; background: #111; color: #e0e0e0; font-size: 0.9rem; margin-bottom: 16px; }
  .search:focus { outline: none; border-color: #4a9eff; }
  .case { border: 1px solid #222; border-radius: 10px; padding: 16px; margin-bottom: 12px; background: #111; }
  .case:hover { border-color: #333; }
  .case-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .code { font-family: monospace; font-size: 0.8rem; padding: 2px 8px; border-radius: 4px; background: #1a1a2e; color: #4a9eff; }
  .disease-name { font-weight: 600; font-size: 1rem; }
  .symptoms { color: #999; font-size: 0.85rem; margin-bottom: 10px; }
  .steps { list-style: none; }
  .step { padding: 8px 12px; margin-bottom: 4px; border-radius: 6px; background: #0d0d0d; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; }
  .step code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: #7dd3fc; flex: 1; }
  .apply-btn { padding: 4px 10px; border: 1px solid #333; border-radius: 4px; background: transparent; color: #4ade80; cursor: pointer; font-size: 0.75rem; white-space: nowrap; }
  .apply-btn:hover { background: #1a2e1a; border-color: #4ade80; }
  .meta { display: flex; gap: 12px; margin-top: 8px; font-size: 0.75rem; color: #666; }
  .success-count { color: #4ade80; }
  .empty { text-align: center; padding: 40px; color: #666; }
  .submit-section { display: none; }
  .submit-section.active { display: block; }
  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 4px; }
  .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 8px 12px; border: 1px solid #333; border-radius: 6px; background: #111; color: #e0e0e0; font-size: 0.85rem; font-family: inherit; }
  .form-group textarea { min-height: 80px; resize: vertical; }
  .submit-btn { padding: 10px 20px; border: none; border-radius: 6px; background: #4a9eff; color: #fff; cursor: pointer; font-size: 0.9rem; }
  .submit-btn:hover { background: #3a8eef; }
  .step-builder { border: 1px solid #222; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
  .add-step { padding: 6px 12px; border: 1px dashed #333; border-radius: 6px; background: transparent; color: #888; cursor: pointer; font-size: 0.8rem; width: 100%; }
  .toast { position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; background: #1a2e1a; border: 1px solid #4ade80; color: #4ade80; font-size: 0.85rem; display: none; z-index: 100; }
  .copied { background: #1a1a2e; border-color: #4a9eff; color: #4a9eff; }
</style>
</head>
<body>

<h1>Claw Clinic Community Cures</h1>
<p class="subtitle">Community-proven fixes for AI agent issues. Apply with one click.</p>

<div class="tabs">
  <button class="tab active" onclick="showTab('browse')">Browse Cures</button>
  <button class="tab" onclick="showTab('submit')">Submit a Cure</button>
</div>

<div id="browse-section">
  <input class="search" type="text" placeholder="Search by disease name, code, or symptoms..." oninput="debounceSearch(this.value)">
  <div id="cases-list"><div class="empty">Loading...</div></div>
</div>

<div id="submit-section" class="submit-section">
  <form id="submit-form" onsubmit="submitCure(event)">
    <div class="form-group">
      <label>ICD-AI Code (e.g., CFG.1.1)</label>
      <input name="icd_ai_code" required placeholder="CFG.1.1">
    </div>
    <div class="form-group">
      <label>Disease Name</label>
      <input name="disease_name" required placeholder="Missing API Key">
    </div>
    <div class="form-group">
      <label>Symptoms / Problem Description</label>
      <textarea name="symptoms_text" required placeholder="Agent cannot connect to provider. Returns auth error on every request."></textarea>
    </div>
    <div class="form-group">
      <label>Treatment Steps</label>
      <div id="steps-container">
        <div class="step-builder">
          <div class="form-group"><label>Step label</label><input name="step_label_0" required placeholder="Set API key"></div>
          <div class="form-group"><label>Command (optional)</label><input name="step_cmd_0" placeholder="openclaw config set anthropic.apiKey YOUR_KEY"></div>
          <div class="form-group"><label>Description</label><input name="step_desc_0" required placeholder="Configure the API key in OpenClaw"></div>
        </div>
      </div>
      <button type="button" class="add-step" onclick="addStep()">+ Add step</button>
    </div>
    <div class="form-group">
      <label>Outcome</label>
      <select name="outcome"><option value="cured">Cured</option><option value="partial">Partial</option></select>
    </div>
    <button type="submit" class="submit-btn">Submit Cure</button>
  </form>
</div>

<div class="toast" id="toast"></div>

<script>
const API = window.location.origin;
let searchTimeout;
let stepCount = 1;

async function loadCases(query) {
  const url = query ? API + '/cases?q=' + encodeURIComponent(query) : API + '/cases';
  try {
    const res = await fetch(url);
    const data = await res.json();
    renderCases(data.cases || []);
  } catch (e) {
    document.getElementById('cases-list').innerHTML = '<div class="empty">Could not load cures. Backend may be offline.</div>';
  }
}

function renderCases(cases) {
  const el = document.getElementById('cases-list');
  if (!cases.length) {
    el.innerHTML = '<div class="empty">No cures found. Be the first to submit one!</div>';
    return;
  }
  el.innerHTML = cases.map(c => {
    const steps = (c.treatment_steps || []).map((s, i) =>
      '<li class="step">' +
        '<span>' + (i+1) + '.</span>' +
        (s.command ? '<code>' + esc(s.command) + '</code><button class="apply-btn" onclick="copyCmd(this, \\''+esc(s.command).replace(/'/g, "\\\\'")+'\\')">' + 'Copy' + '</button>' : '<span>' + esc(s.description || s.label) + '</span>') +
      '</li>'
    ).join('');
    const ago = timeAgo(c.created_at);
    return '<div class="case">' +
      '<div class="case-header"><span class="disease-name">' + esc(c.disease_name) + '</span><span class="code">' + esc(c.icd_ai_code) + '</span></div>' +
      '<div class="symptoms">' + esc(c.symptoms_text).slice(0, 200) + '</div>' +
      '<ul class="steps">' + steps + '</ul>' +
      '<div class="meta"><span class="success-count">' + (c.success_count || 0) + ' successful uses</span><span>' + ago + '</span><span>' + (c.source === 'system' ? 'Standard' : 'Community') + '</span></div>' +
    '</div>';
  }).join('');
}

function debounceSearch(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadCases(val), 300);
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('browse-section').style.display = tab === 'browse' ? 'block' : 'none';
  document.getElementById('submit-section').className = tab === 'submit' ? 'submit-section active' : 'submit-section';
}

function addStep() {
  const c = document.getElementById('steps-container');
  const n = stepCount++;
  c.insertAdjacentHTML('beforeend',
    '<div class="step-builder"><div class="form-group"><label>Step label</label><input name="step_label_'+n+'" required></div><div class="form-group"><label>Command</label><input name="step_cmd_'+n+'"></div><div class="form-group"><label>Description</label><input name="step_desc_'+n+'" required></div></div>'
  );
}

async function submitCure(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const steps = [];
  for (let i = 0; i < stepCount + 1; i++) {
    const label = f.get('step_label_' + i);
    if (!label) continue;
    steps.push({ label, command: f.get('step_cmd_' + i) || undefined, description: f.get('step_desc_' + i) || '' });
  }
  const body = {
    icd_ai_code: f.get('icd_ai_code'),
    disease_name: f.get('disease_name'),
    symptoms_text: f.get('symptoms_text'),
    treatment_steps: steps,
    outcome: f.get('outcome'),
  };
  try {
    const res = await fetch(API + '/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      toast('Cure submitted! Thank you, doctor.');
      e.target.reset();
      showTab('browse');
      document.querySelector('.tab').classList.add('active');
      loadCases();
    } else {
      const err = await res.json();
      toast('Error: ' + (err.error || 'submission failed'), true);
    }
  } catch (err) {
    toast('Network error', true);
  }
}

function copyCmd(btn, cmd) {
  navigator.clipboard.writeText(cmd).then(() => {
    btn.textContent = 'Copied!';
    toast('Command copied — paste in your terminal', false, 'copied');
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function toast(msg, isError, cls) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (cls ? ' ' + cls : '');
  t.style.display = 'block';
  if (isError) { t.style.borderColor = '#f87171'; t.style.color = '#f87171'; t.style.background = '#2e1a1a'; }
  setTimeout(() => t.style.display = 'none', 3000);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function timeAgo(ts) {
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
