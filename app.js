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
    const badge = `<span class="badge badge-${m.provider}">${m.provider === 'anthropic' ? 'Anthropic' : m.provider === 'openai' ? 'OpenAI' : 'Google'}</span>`;
    const longBadge = cost.isLongContext ? ' <span class="badge" style="background:rgba(255,184,108,.2);color:#ffb86c">🔺 Long</span>' : '';
    const depBadge = m.deprecated ? ' <span class="badge" style="background:rgba(255,85,85,.15);color:#ff5555">deprecated</span>' : '';
    const depClass = m.deprecated ? ' style="opacity:0.55"' : '';
    const cc = costClass(cost.totalCost);
    return `<tr${depClass}>
      <td>${rankCell}</td>
      <td><span class="model-name">${m.name}</span>${badge}${longBadge}${depBadge}</td>
      <td class="cost-neutral">${fmt(cost.inputCost)}</td>
      <td class="cost-neutral">${fmt(cost.outputCost)}</td>
      <td class="${cc}">${fmt(cost.totalCost)}</td>
    </tr>`;
  }).join('');
}

async function init() {
  const res = await fetch('prices.json');
  const data = await res.json();
  state.models = data.models;
  document.getElementById('last-updated').textContent = data.last_updated.slice(0, 10);
  document.getElementById('output-display').textContent = fmtNum(state.outputTokens);
  renderTable();
}

init();
