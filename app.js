const state = {
  models: [],
  openModelsNormalized: [],
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  contextMode: 'short',
  activeProviders: new Set(['anthropic', 'openai', 'google', 'xai']),
  activeFamilies: new Set(),
  showDeprecated: false,
};

const PROVIDER_COLORS = {
  google:    { bg: 'rgba(80,250,123,0.8)',  border: '#50fa7b' },
  openai:    { bg: 'rgba(139,233,253,0.8)', border: '#8be9fd' },
  anthropic: { bg: 'rgba(189,147,249,0.8)', border: '#bd93f9' },
  xai:       { bg: 'rgba(241,250,140,0.8)', border: '#f1fa8c' },
  aws:       { bg: 'rgba(255,153,0,0.8)',   border: '#ff9900' },
  gcp:       { bg: 'rgba(77,208,225,0.8)',  border: '#4dd0e1' },
  azure:     { bg: 'rgba(77,184,255,0.8)',  border: '#4db8ff' },
};

let chartInstance = null;
let scatterInstance = null;

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
    if (m.family && state.activeFamilies.size > 0 && !state.activeFamilies.has(m.family)) return false;
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
  const sorted = visibleModels()
    .map(m => ({ m, cost: calcCost(m) }))
    .filter(({ cost }) => cost !== null)
    .sort((a, b) => a.cost.totalCost - b.cost.totalCost);

  // 입력·출력 가격이 동일한 모델을 한 행으로 묶음
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const lc = last?.[0].cost;
    if (last && lc.inputCost === item.cost.inputCost && lc.outputCost === item.cost.outputCost) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }

  const tbody = document.getElementById('model-tbody');
  let rankOffset = 0;
  tbody.innerHTML = groups.map(group => {
    const rankIdx = rankOffset;
    rankOffset += group.length;
    const { cost } = group[0];
    const rankCell = rankIdx < 3
      ? `<span class="rank rank-${['gold','silver','bronze'][rankIdx]}">${RANK_MEDALS[rankIdx]}</span>`
      : `<span class="rank">${rankIdx + 1}</span>`;
    const cc = costClass(cost.totalCost);

    const modelContent = group.map(({ m, cost: c }) => {
      const badge = m.family
        ? `<span class="badge badge-family-${m.family}">${sanitize(OPEN_FAMILY_LABELS[m.family] ?? m.family)}</span>`
        : `<span class="badge badge-${m.provider}">${sanitize(PROVIDER_LABELS[m.provider] ?? m.provider)}</span>`;
      const longBadge = c.isLongContext ? ' <span class="badge" style="background:rgba(255,184,108,.2);color:#ffb86c">🔺 Long</span>' : '';
      const depBadge = m.deprecated ? ' <span class="badge" style="background:rgba(255,85,85,.15);color:#ff5555">deprecated</span>' : '';
      return `<span class="model-name">${sanitize(m.name)}</span>${badge}${longBadge}${depBadge}`;
    }).join('<br>');

    const chatBtns = group
      .map(({ m }) => m.openrouter_id
        ? `<a class="chat-btn" href="https://openrouter.ai/chat?models=${encodeURIComponent(m.openrouter_id)}" target="_blank" rel="noopener">Chat</a>`
        : '')
      .filter(Boolean).join(' ');

    const depClass = group.every(({ m }) => m.deprecated) ? ' style="opacity:0.55"' : '';
    return `<tr${depClass}>
      <td>${rankCell}</td>
      <td>${modelContent}</td>
      <td class="cost-neutral">${fmt(cost.inputCost)}</td>
      <td class="cost-neutral">${fmt(cost.outputCost)}</td>
      <td class="${cc}">${fmt(cost.totalCost)}</td>
      <td>${chatBtns}</td>
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
  if (tab === 'prices') { renderPriceScatter(); renderPriceTable(); }
  if (tab === 'open-models') renderOpenModelsTable();
}

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'xai'];
const PROVIDER_NAMES = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', xai: 'xAI' };

const OPEN_FAMILY_NAMES = { meta: 'Meta', mistral: 'Mistral', deepseek: 'DeepSeek', qwen: 'Qwen', gemma: 'Google', grok: 'xAI' };
const OPEN_FAMILY_ORDER = ['meta', 'mistral', 'deepseek', 'qwen', 'gemma', 'grok'];

let openModels = [];

function renderOpenModelsTable() {
  const container = document.getElementById('open-models-content');
  if (!openModels.length) {
    container.innerHTML = '<p style="color:var(--comment);padding:20px">데이터를 불러오는 중...</p>';
    return;
  }

  const fmtP = v => v != null ? `$${v.toFixed(2)}` : '<span style="color:var(--comment)">—</span>';
  const CSP_ORDER = [
    { key: 'aws',   label: 'AWS' },
    { key: 'gcp',   label: 'GCP' },
    { key: 'azure', label: 'Azure' },
  ];

  container.innerHTML = OPEN_FAMILY_ORDER.map(family => {
    const models = openModels.filter(m => m.family === family).sort(compareModelVersions);
    if (!models.length) return '';

    const rows = models.map((m, mi) => {
      const totals = CSP_ORDER
        .map(c => m[c.key] ? { key: c.key, val: m[c.key].input + m[c.key].output } : null)
        .filter(Boolean);
      const minVal = totals.length > 1 ? Math.min(...totals.map(t => t.val)) : null;
      const cheapest = minVal !== null && totals.filter(t => t.val === minVal).length === 1
        ? totals.find(t => t.val === minVal).key
        : null;

      return CSP_ORDER.map((csp, ci) => {
        const data   = m[csp.key];
        const hi     = csp.key === cheapest;
        const hiStyle = hi ? ';color:var(--green);font-weight:700' : '';
        const modelCell = ci === 0
          ? `<td class="model-name" rowspan="${CSP_ORDER.length}">${sanitize(m.name)}</td>`
          : '';
        const sepClass = mi > 0 && ci === 0 ? ' class="model-sep"' : '';
        return `<tr${sepClass}>
          ${modelCell}
          <td style="padding-left:10px${hiStyle}">
            <span class="badge badge-${csp.key}" style="font-size:10px">${csp.label}</span>
          </td>
          <td class="price-cell" style="${hiStyle.slice(1)}">${data ? fmtP(data.input) : fmtP(null)}</td>
          <td class="price-cell" style="${hiStyle.slice(1)}">${data ? fmtP(data.output) : fmtP(null)}</td>
        </tr>`;
      }).join('');
    }).join('');

    return `<div class="provider-group">
      <div class="provider-heading provider-heading-open-${family}">${sanitize(OPEN_FAMILY_NAMES[family])}</div>
      <table class="open-models-table">
        <colgroup>
          <col style="width:auto">
          <col style="width:80px">
          <col style="width:130px">
          <col style="width:130px">
        </colgroup>
        <thead><tr>
          <th>모델</th>
          <th>CSP</th>
          <th>입력 ($/MTok)</th>
          <th>출력 ($/MTok)</th>
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

function renderPriceScatter() {
  const canvas = document.getElementById('price-scatter-chart');
  if (!canvas) return;

  if (scatterInstance) { scatterInstance.destroy(); scatterInstance = null; }

  const datasets = PROVIDER_ORDER.map(provider => {
    const grouped = new Map();
    state.models
      .filter(m => m.provider === provider && !m.deprecated)
      .forEach(m => {
        const key = `${m.input_price_per_mtok}|${m.output_price_per_mtok}`;
        if (!grouped.has(key)) {
          grouped.set(key, { x: m.input_price_per_mtok, y: m.output_price_per_mtok, names: [] });
        }
        grouped.get(key).names.push(m.name);
      });
    const points = Array.from(grouped.values());
    if (!points.length) return null;
    const col = PROVIDER_COLORS[provider];
    return {
      label: PROVIDER_NAMES[provider],
      data: points,
      backgroundColor: col?.bg ?? 'rgba(98,114,164,0.8)',
      borderColor: col?.border ?? '#6272a4',
      borderWidth: 1.5,
      pointRadius: 7,
      pointHoverRadius: 10,
    };
  }).filter(Boolean);

  scatterInstance = new Chart(canvas.getContext('2d'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#6272a4', font: { size: 11 }, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              const price = `  입력 $${d.x.toFixed(3)} / 출력 $${d.y.toFixed(3)}`;
              if (d.names.length === 1) return `${d.names[0]}${price}`;
              return [`${d.names.length}개 모델${price}`, ...d.names.map(n => `  • ${n}`)];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: '입력 ($/MTok)', color: '#6272a4', font: { size: 11 } },
          grid: { color: 'rgba(98,114,164,0.15)' },
          ticks: { color: '#6272a4', font: { size: 10 },
            callback: v => `$${v}`,
          },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: '출력 ($/MTok)', color: '#6272a4', font: { size: 11 } },
          grid: { color: 'rgba(98,114,164,0.15)' },
          ticks: { color: '#6272a4', font: { size: 10 },
            callback: v => `$${v}`,
          },
        },
      },
    },
  });
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
      const lc = m.long_context;
      const thr = lc ? `>${Math.round(lc.threshold_tokens / 1000)}K` : null;
      const inputCell  = `$${m.input_price_per_mtok.toFixed(3)}`
        + (lc ? `<span class="long-ctx-note">$${lc.input_price_per_mtok.toFixed(3)}</span><span class="long-ctx-note">(${thr})</span>` : '');
      const outputCell = `$${m.output_price_per_mtok.toFixed(3)}`
        + (lc ? `<span class="long-ctx-note">$${lc.output_price_per_mtok.toFixed(3)}</span><span class="long-ctx-note">(${thr})</span>` : '');

      const today = new Date().toISOString().slice(0, 10);
      let shutdownCell = '<span style="color:var(--comment)">—</span>';
      if (m.shutdown_date) {
        const isPast = m.shutdown_date < today;
        const color = isPast ? 'var(--red)' : (m.shutdown_date < today.slice(0, 4) + '-12-31' ? 'var(--orange)' : 'var(--comment)');
        shutdownCell = `<span style="color:${color};font-weight:${isPast ? '700' : '400'}">${m.shutdown_date}</span>`;
      }
      return `<tr${m.deprecated ? ' style="opacity:.5"' : ''}>
        <td><span style="font-weight:500">${sanitize(m.name)}</span>${depBadge}</td>
        <td>${inputCell}</td>
        <td>${outputCell}</td>
        <td>${shutdownCell}</td>
      </tr>`;
    }).join('');

    return `<div class="provider-group">
      <div class="provider-heading provider-heading-${provider}">${sanitize(PROVIDER_NAMES[provider])}</div>
      <table class="price-ref-table">
        <colgroup>
          <col style="width:auto">
          <col style="width:130px">
          <col style="width:130px">
          <col style="width:100px">
        </colgroup>
        <thead><tr>
          <th>모델</th>
          <th>입력 / MTok</th>
          <th>출력 / MTok</th>
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

function toggleFamily(family) {
  if (state.activeFamilies.has(family)) {
    state.activeFamilies.delete(family);
  } else {
    state.activeFamilies.add(family);
  }

  // 패밀리 선택 여부에 따라 CSP 자동 on/off
  const cspProviders = ['aws', 'gcp', 'azure'];
  if (state.activeFamilies.size > 0) {
    cspProviders.forEach(p => state.activeProviders.add(p));
  } else {
    cspProviders.forEach(p => state.activeProviders.delete(p));
  }

  document.querySelectorAll('.chip[data-family]').forEach(chip => {
    chip.classList.toggle('chip-off', !state.activeFamilies.has(chip.dataset.family));
  });
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
    chip.classList.toggle('chip-off', !state.activeProviders.has(chip.dataset.provider));
    chip.addEventListener('click', () => toggleProvider(chip.dataset.provider));
  });

  // family chips - 초기에는 모두 비활성 상태로 표시
  document.querySelectorAll('.chip[data-family]').forEach(chip => {
    chip.classList.add('chip-off');
    chip.addEventListener('click', () => toggleFamily(chip.dataset.family));
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
