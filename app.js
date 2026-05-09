const state = {
  models: [],
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  contextMode: 'short',
  activeProviders: new Set(['anthropic', 'openai', 'google']),
  showDeprecated: false,
};

function calcCost(model) {
  let inputPrice = model.input_price_per_mtok;
  let outputPrice = model.output_price_per_mtok;
  const isLongContext = state.contextMode === 'long' && model.long_context != null
    && model.long_context.input_price_per_mtok != null;
  if (isLongContext) {
    inputPrice = model.long_context.input_price_per_mtok;
    outputPrice = model.long_context.output_price_per_mtok;
  }
  if (inputPrice == null || outputPrice == null) return null;
  const inputCost = state.inputTokens * (inputPrice / 1_000_000);
  const outputCost = state.outputTokens * (outputPrice / 1_000_000);
  return { inputCost, outputCost, totalCost: inputCost + outputCost, isLongContext };
}

function fmt(n) {
  if (n === 0) return '$0.000';
  if (n < 0.001) return '$' + n.toExponential(2);
  return '$' + n.toFixed(3);
}

function fmtNum(n) {
  return n.toLocaleString();
}

function costClass(total) {
  if (total < 1) return 'c-low';
  if (total < 10) return 'c-mid';
  return 'c-high';
}

function visibleModels() {
  return state.models.filter(m => {
    if (!state.showDeprecated && m.deprecated) return false;
    if (!state.activeProviders.has(m.provider)) return false;
    return true;
  });
}

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function sanitize(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' };

function renderTable() {
  const models = visibleModels()
    .map(m => ({ m, cost: calcCost(m) }))
    .filter(({ cost }) => cost !== null)
    .sort((a, b) => a.cost.totalCost - b.cost.totalCost);

  const tbody = document.getElementById('model-tbody');
  tbody.innerHTML = models.map(({ m, cost }, i) => {
    const rankCell = i < 3
      ? `<span class="rank rank-${['gold','silver','bronze'][i]}">${RANK_MEDALS[i]}</span>`
      : `<span class="rank">${i + 1}</span>`;
    const badge = `<span class="badge badge-${m.provider}">${sanitize(PROVIDER_LABELS[m.provider] ?? m.provider)}</span>`;
    const longBadge = cost.isLongContext ? ' <span class="badge" style="background:rgba(255,184,108,.2);color:#ffb86c">🔺 Long</span>' : '';
    const depBadge = m.deprecated ? ' <span class="badge" style="background:rgba(255,85,85,.15);color:#ff5555">deprecated</span>' : '';
    const depClass = m.deprecated ? ' style="opacity:0.55"' : '';
    const cc = costClass(cost.totalCost);
    return `<tr${depClass}>
      <td>${rankCell}</td>
      <td><span class="model-name">${sanitize(m.name)}</span>${badge}${longBadge}${depBadge}</td>
      <td class="cost-neutral">${fmt(cost.inputCost)}</td>
      <td class="cost-neutral">${fmt(cost.outputCost)}</td>
      <td class="${cc}">${fmt(cost.totalCost)}</td>
    </tr>`;
  }).join('');
}

function renderAll() {
  if (!state.models.length) return;
  renderTable();
}

function onTokenChange() {
  const rawInput = document.getElementById('input-tokens').value.replace(/,/g, '');
  const rawOutput = document.getElementById('output-tokens').value.replace(/,/g, '');
  const inp = parseInt(rawInput, 10);
  const out = parseInt(rawOutput, 10);
  if (!isNaN(inp) && inp >= 0) state.inputTokens = inp;
  if (!isNaN(out) && out >= 0) state.outputTokens = out;
  document.getElementById('input-display').textContent = fmtNum(state.inputTokens);
  document.getElementById('output-display').textContent = fmtNum(state.outputTokens);
  renderAll();
}

function setContext(mode) {
  state.contextMode = mode;
  document.getElementById('ctx-short').classList.toggle('active', mode === 'short');
  document.getElementById('ctx-long').classList.toggle('active', mode === 'long');
  renderAll();
}

function toggleProvider(provider) {
  if (state.activeProviders.has(provider)) {
    if (state.activeProviders.size > 1) state.activeProviders.delete(provider);
  } else {
    state.activeProviders.add(provider);
  }
  document.querySelectorAll('.chip[data-provider]').forEach(chip => {
    chip.classList.toggle('chip-off', !state.activeProviders.has(chip.dataset.provider));
  });
  renderAll();
}

function toggleDeprecated() {
  state.showDeprecated = !state.showDeprecated;
  const chip = document.getElementById('dep-chip');
  chip.classList.toggle('chip-off', !state.showDeprecated);
  renderAll();
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('llmhub-theme', next);
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
}

async function init() {
  // theme
  const savedTheme = localStorage.getItem('llmhub-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme ?? (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';

  // theme toggle
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);

  // token inputs
  document.getElementById('input-tokens').addEventListener('input', onTokenChange);
  document.getElementById('output-tokens').addEventListener('input', onTokenChange);

  // context toggle
  document.getElementById('ctx-short').addEventListener('click', () => setContext('short'));
  document.getElementById('ctx-long').addEventListener('click', () => setContext('long'));

  // provider chips
  document.querySelectorAll('.chip[data-provider]').forEach(chip => {
    chip.addEventListener('click', () => toggleProvider(chip.dataset.provider));
  });

  // deprecated chip
  document.getElementById('dep-chip').addEventListener('click', toggleDeprecated);

  // load data
  try {
    const res = await fetch('prices.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.models = data.models;
    document.getElementById('last-updated').textContent = data.last_updated.slice(0, 10);
    document.getElementById('input-display').textContent = fmtNum(state.inputTokens);
    document.getElementById('output-display').textContent = fmtNum(state.outputTokens);
    renderAll();
  } catch (e) {
    const tbody = document.getElementById('model-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#ff5555">가격 데이터를 불러오지 못했습니다. (${sanitize(e.message)})</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
