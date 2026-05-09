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
  const isLongContext = state.contextMode === 'long' && model.long_context != null;
  if (isLongContext) {
    inputPrice = model.long_context.input_price_per_mtok;
    outputPrice = model.long_context.output_price_per_mtok;
  }
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
