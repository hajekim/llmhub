const state = {
  models: [],
  openModelsNormalized: [],
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  contextMode: 'short',
  activeProviders: new Set(['anthropic', 'openai', 'google', 'xai', 'aws', 'gcp', 'azure']),
  showDeprecated: false,
};

const PROVIDER_COLORS = {
  google:    { bg: 'rgba(80,250,123,0.8)',  border: '#50fa7b' },
  openai:    { bg: 'rgba(139,233,253,0.8)', border: '#8be9fd' },
  anthropic: { bg: 'rgba(189,147,249,0.8)', border: '#bd93f9' },
  xai:       { bg: 'rgba(241,250,140,0.8)', border: '#f1fa8c' },
  aws:       { bg: 'rgba(255,153,0,0.8)',   border: '#ff9900' },
  gcp:       { bg: 'rgba(110,166,255,0.8)', border: '#6ea6ff' },
  azure:     { bg: 'rgba(77,184,255,0.8)',  border: '#4db8ff' },
};

let chartInstance = null;

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
  return [...state.models, ...state.openModelsNormalized].filter(m => {
    if (!state.showDeprecated && m.deprecated) return false;
    if (!state.activeProviders.has(m.provider)) return false;
    return true;
  });
}

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function sanitize(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', xai: 'xAI', aws: 'AWS', gcp: 'GCP', azure: 'Azure' };
const OPEN_FAMILY_LABELS = { meta: 'Meta', mistral: 'Mistral', deepseek: 'DeepSeek', qwen: 'Qwen', gemma: 'Gemma', grok: 'Grok' };

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
    const badge = m.family
      ? `<span class="badge badge-family-${m.family}">${sanitize(OPEN_FAMILY_LABELS[m.family] ?? m.family)}</span>`
      : `<span class="badge badge-${m.provider}">${sanitize(PROVIDER_LABELS[m.provider] ?? m.provider)}</span>`;
    const longBadge = cost.isLongContext ? ' <span class="badge" style="background:rgba(255,184,108,.2);color:#ffb86c">🔺 Long</span>' : '';
    const depBadge = m.deprecated ? ' <span class="badge" style="background:rgba(255,85,85,.15);color:#ff5555">deprecated</span>' : '';
    const depClass = m.deprecated ? ' style="opacity:0.55"' : '';
    const cc = costClass(cost.totalCost);
    const chatBtn = m.openrouter_id
      ? `<a class="chat-btn" href="https://openrouter.ai/chat?models=${encodeURIComponent(m.openrouter_id)}" target="_blank" rel="noopener">Chat</a>`
      : '';
    return `<tr${depClass}>
      <td>${rankCell}</td>
      <td><span class="model-name">${sanitize(m.name)}</span>${badge}${longBadge}${depBadge}</td>
      <td class="cost-neutral">${fmt(cost.inputCost)}</td>
      <td class="cost-neutral">${fmt(cost.outputCost)}</td>
      <td class="${cc}">${fmt(cost.totalCost)}</td>
      <td>${chatBtn}</td>
    </tr>`;
  }).join('');
}

function initChart() {
  const ctx = document.getElementById('price-chart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: [], borderWidth: 2, borderRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => fmt(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6272a4', font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(98,114,164,0.2)' },
          ticks: { color: '#6272a4', font: { size: 10 }, callback: v => fmt(v) },
          beginAtZero: true,
        },
      },
    },
  });
}

function updateChart() {
  if (!chartInstance) return;
  const top5 = visibleModels()
    .map(m => ({ m, cost: calcCost(m) }))
    .filter(({ cost }) => cost !== null)
    .sort((a, b) => a.cost.totalCost - b.cost.totalCost)
    .slice(0, 5);

  chartInstance.data.labels = top5.map(({ m }) => m.name);
  chartInstance.data.datasets[0].data = top5.map(({ cost }) => cost.totalCost);
  chartInstance.data.datasets[0].backgroundColor = top5.map(({ m }) => PROVIDER_COLORS[m.provider]?.bg ?? 'rgba(98,114,164,0.8)');
  chartInstance.data.datasets[0].borderColor = top5.map(({ m }) => PROVIDER_COLORS[m.provider]?.border ?? '#6272a4');
  chartInstance.update();
}

function switchTab(tab) {
  ['calculator', 'prices', 'open-models'].forEach(t => {
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`tab-btn-${t}`)?.classList.toggle('active', t === tab);
  });
  document.getElementById('source-links-direct').style.display = tab === 'prices'      ? '' : 'none';
  document.getElementById('source-links-open').style.display   = tab === 'open-models' ? '' : 'none';
  if (tab === 'prices') renderPriceTable();
  if (tab === 'open-models') renderOpenModelsTable();
}

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'xai'];
const PROVIDER_NAMES = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)', xai: 'xAI (Grok)' };

const OPEN_FAMILY_NAMES = { meta: 'Meta (Llama)', mistral: 'Mistral AI', deepseek: 'DeepSeek', qwen: 'Qwen (Alibaba)', gemma: 'Google (Gemma)', grok: 'xAI (Grok)' };
const OPEN_FAMILY_ORDER = ['meta', 'mistral', 'deepseek', 'qwen', 'gemma', 'grok'];

let openModels = [];

function renderOpenModelsTable() {
  const container = document.getElementById('open-models-content');
  if (!openModels.length) {
    container.innerHTML = '<p style="color:var(--comment);padding:20px">데이터를 불러오는 중...</p>';
    return;
  }

  const fmtP = v => v != null ? `$${v.toFixed(2)}` : '<span style="color:var(--comment)">—</span>';

  container.innerHTML = OPEN_FAMILY_ORDER.map(family => {
    const models = openModels.filter(m => m.family === family);
    if (!models.length) return '';

    const rows = models.map(m => {
      const awsIn    = fmtP(m.aws?.input);
      const awsOut   = fmtP(m.aws?.output);
      const gcpIn    = fmtP(m.gcp?.input);
      const gcpOut   = fmtP(m.gcp?.output);
      const azureIn  = fmtP(m.azure?.input);
      const azureOut = fmtP(m.azure?.output);

      const totals = [
        m.aws   ? { key: 'aws',   val: m.aws.input   + m.aws.output }   : null,
        m.gcp   ? { key: 'gcp',   val: m.gcp.input   + m.gcp.output }   : null,
        m.azure ? { key: 'azure', val: m.azure.input + m.azure.output } : null,
      ].filter(Boolean);

      let cheapest = null;
      if (totals.length > 1) {
        cheapest = totals.reduce((a, b) => a.val < b.val ? a : b).key;
      }

      const hi = (key) => key === cheapest ? ' style="color:var(--green);font-weight:700"' : '';

      return `<tr>
        <td style="font-weight:500">${sanitize(m.name)}</td>
        <td${hi('aws')}>${awsIn}</td>
        <td${hi('aws')}>${awsOut}</td>
        <td${hi('gcp')}>${gcpIn}</td>
        <td${hi('gcp')}>${gcpOut}</td>
        <td${hi('azure')}>${azureIn}</td>
        <td${hi('azure')}>${azureOut}</td>
      </tr>`;
    }).join('');

    return `<div class="provider-group">
      <div class="provider-heading provider-heading-open-${family}">${sanitize(OPEN_FAMILY_NAMES[family])}</div>
      <table class="price-ref-table">
        <thead><tr>
          <th>모델</th>
          <th>AWS 입력</th>
          <th>AWS 출력</th>
          <th>GCP 입력</th>
          <th>GCP 출력</th>
          <th>Azure 입력</th>
          <th>Azure 출력</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
}

function modelVersionKey(name) {
  const nums = name.match(/\d+(?:\.\d+)*/g);
  if (!nums) return [0];
  return nums[0].split('.').map(Number);
}

function compareModelVersions(a, b) {
  const va = modelVersionKey(a.name);
  const vb = modelVersionKey(b.name);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] || 0) - (va[i] || 0);
    if (diff !== 0) return diff;
  }
  return a.name.localeCompare(b.name);
}

function renderPriceTable() {
  const container = document.getElementById('price-ref-content');
  if (!state.models.length) {
    container.innerHTML = '<p style="color:var(--comment);padding:20px">가격 데이터를 불러오는 중...</p>';
    return;
  }

  container.innerHTML = PROVIDER_ORDER.map(provider => {
    const models = state.models
      .filter(m => m.provider === provider)
      .sort((a, b) => a.deprecated !== b.deprecated ? (a.deprecated ? 1 : -1) : compareModelVersions(a, b));

    const rows = models.map(m => {
      const depBadge = m.deprecated ? ' <span class="badge badge-dep">deprecated</span>' : '';
      let longCtxCell = '<span style="color:var(--comment)">—</span>';
      if (m.long_context) {
        const thr = `>${Math.round(m.long_context.threshold_tokens / 1000)}K`;
        longCtxCell = `<span style="color:var(--orange);font-weight:700">${thr}</span>`
          + `<span class="long-ctx-note">입력 $${m.long_context.input_price_per_mtok.toFixed(2)}</span>`
          + `<span class="long-ctx-note">출력 $${m.long_context.output_price_per_mtok.toFixed(2)}</span>`;
      }
      const today = new Date().toISOString().slice(0, 10);
      let shutdownCell = '<span style="color:var(--comment)">—</span>';
      if (m.shutdown_date) {
        const isPast = m.shutdown_date < today;
        const color = isPast ? 'var(--red)' : (m.shutdown_date < today.slice(0, 4) + '-12-31' ? 'var(--orange)' : 'var(--comment)');
        shutdownCell = `<span style="color:${color};font-weight:${isPast ? '700' : '400'}">${m.shutdown_date}</span>`;
      }
      return `<tr${m.deprecated ? ' style="opacity:.5"' : ''}>
        <td><span style="font-weight:500">${sanitize(m.name)}</span>${depBadge}</td>
        <td>$${m.input_price_per_mtok.toFixed(3)}</td>
        <td>$${m.output_price_per_mtok.toFixed(3)}</td>
        <td>${longCtxCell}</td>
        <td>${shutdownCell}</td>
      </tr>`;
    }).join('');

    return `<div class="provider-group">
      <div class="provider-heading provider-heading-${provider}">${sanitize(PROVIDER_NAMES[provider])}</div>
      <table class="price-ref-table">
        <thead><tr>
          <th>모델</th>
          <th>입력 / MTok</th>
          <th>출력 / MTok</th>
          <th>Long Context</th>
          <th>Shutdown</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
}

function renderAll() {
  if (!state.models.length) return;
  renderTable();
  updateChart();
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

  // tab buttons
  document.getElementById('tab-btn-calculator').addEventListener('click', () => switchTab('calculator'));
  document.getElementById('tab-btn-prices').addEventListener('click', () => switchTab('prices'));
  document.getElementById('tab-btn-open-models').addEventListener('click', () => switchTab('open-models'));

  // init chart
  initChart();

  // load data
  try {
    const [pricesRes, openRes] = await Promise.all([
      fetch('prices.json'),
      fetch('open-models.json'),
    ]);
    if (!pricesRes.ok) throw new Error(`HTTP ${pricesRes.status}`);
    const [data, openData] = await Promise.all([
      pricesRes.json(),
      openRes.ok ? openRes.json() : Promise.resolve(null),
    ]);
    state.models = data.models;
    document.getElementById('last-updated').textContent = '가격 기준일: ' + data.last_updated.slice(0, 10);
    document.getElementById('input-display').textContent = fmtNum(state.inputTokens);
    document.getElementById('output-display').textContent = fmtNum(state.outputTokens);

    if (openData) {
      openModels = openData.models;
      state.openModelsNormalized = [];
      for (const m of openData.models) {
        if (m.aws) state.openModelsNormalized.push({
          id: m.id + '-aws', name: m.name + ' (AWS)', provider: 'aws', family: m.family,
          input_price_per_mtok: m.aws.input, output_price_per_mtok: m.aws.output, deprecated: false,
        });
        if (m.gcp) state.openModelsNormalized.push({
          id: m.id + '-gcp', name: m.name + ' (GCP)', provider: 'gcp', family: m.family,
          input_price_per_mtok: m.gcp.input, output_price_per_mtok: m.gcp.output, deprecated: false,
        });
        if (m.azure) state.openModelsNormalized.push({
          id: m.id + '-azure', name: m.name + ' (Azure)', provider: 'azure', family: m.family,
          input_price_per_mtok: m.azure.input, output_price_per_mtok: m.azure.output, deprecated: false,
        });
      }
    }
    renderAll();
  } catch (e) {
    const tbody = document.getElementById('model-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#ff5555">가격 데이터를 불러오지 못했습니다. (${sanitize(e.message)})</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
