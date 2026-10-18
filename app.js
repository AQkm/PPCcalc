const fields = ['buyIn', 'prizePool', 'players', 'minCash', 'averageStack', 'bonus', 'chance'];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const chips = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const svg = document.querySelector('#chart');
const probabilitySvg = document.querySelector('#probabilityChart');

function buildStackDistribution(averageStack) {
  const sigma = 0.9;
  const minimumStack = 1;
  const maximumStack = 2_000_000;
  const bins = 600;
  const logMin = Math.log(minimumStack);
  const logStep = (Math.log(maximumStack) - logMin) / bins;
  const stacks = Array.from({ length: bins }, (_, index) => Math.exp(logMin + (index + 0.5) * logStep));

  function weightsFor(mu) {
    const weights = stacks.map((stack) => {
      const z = (Math.log(stack) - mu) / sigma;
      return Math.exp(-0.5 * z ** 2) / (sigma * Math.sqrt(2 * Math.PI)) * logStep;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => weight / total);
  }

  let low = -10;
  let high = 30;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mu = (low + high) / 2;
    const weights = weightsFor(mu);
    const mean = weights.reduce((sum, weight, index) => sum + weight * stacks[index], 0);
    if (mean < averageStack) low = mu;
    else high = mu;
  }

  return weightsFor((low + high) / 2).map((weight, index) => ({ stack: stacks[index], weight }));
}

function renderProbabilityChart(distribution, chance) {
  const width = 760;
  const height = 300;
  const plot = { left: 72, right: 18, top: 20, bottom: 48 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const minX = 1;
  const maxX = 2_000_000;
  const rangeCount = 20;
  const rangeSize = (maxX - minX) / rangeCount;
  const ranges = Array.from({ length: rangeCount }, (_, index) => {
    const start = minX + index * rangeSize;
    const end = index === rangeCount - 1 ? maxX : start + rangeSize;
    const probability = distribution.reduce((sum, item) => sum + (item.stack >= start && item.stack < end ? item.weight : 0), 0) * chance;
    return { start, end, probability };
  });
  const maxY = Math.max(...ranges.map((range) => range.probability), 0.1) * 1.15;
  const xScale = (x) => plot.left + (x - minX) / (maxX - minX) * plotWidth;
  const yScale = (y) => plot.top + (maxY - y) / maxY * plotHeight;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = maxY * index / 4;
    const y = yScale(value);
    return `<line x1="${plot.left}" y1="${y}" x2="${width - plot.right}" y2="${y}" stroke="#383838"/><text x="${plot.left - 12}" y="${y + 4}" fill="#909090" font-size="11" text-anchor="end">${value.toFixed(1)}%</text>`;
  }).join('');
  const bars = ranges.map((range) => {
    const x = xScale(range.start) + 1;
    const barWidth = xScale(range.end) - xScale(range.start) - 2;
    const y = yScale(range.probability);
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${plot.top + plotHeight - y}" rx="2" fill="#3b82f6"/>`;
  }).join('');
  const labels = [minX, 500_000, 1_000_000, 1_500_000, maxX].map((x) => `<text x="${xScale(x)}" y="${height - 17}" fill="#909090" font-size="11" text-anchor="middle">${chips.format(x)}</text>`).join('');
  probabilitySvg.innerHTML = `${grid}${bars}<text x="${plot.left + plotWidth / 2}" y="${height - 1}" fill="#a0a0a0" font-size="11" text-anchor="middle">Day 1 ending stack (chips)</text><text x="17" y="${plot.top + plotHeight / 2}" fill="#a0a0a0" font-size="11" text-anchor="middle" transform="rotate(-90 17 ${plot.top + plotHeight / 2})">Chance of qualifying in this stack range</text>${labels}`;
}

function readValues() {
  return Object.fromEntries(fields.map((id) => [id, Number(document.getElementById(id).value)]));
}

function makePayouts(prizePool, minCash, places) {
  const firstPrize = prizePool * 0.10;
  function buildCurve(power) {
    return Array.from({ length: places }, (_, index) => {
      const rank = index + 1;
      const progress = 1 - Math.log(rank) / Math.log(places);
      return minCash + (firstPrize - minCash) * progress ** power;
    });
  }

  let low = 0;
  let high = 1;
  while (buildCurve(high).reduce((sum, value) => sum + value, 0) > prizePool && high < 1_000_000) high *= 2;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    const total = buildCurve(middle).reduce((sum, value) => sum + value, 0);
    if (total > prizePool) low = middle;
    else high = middle;
  }
  const payouts = buildCurve((low + high) / 2).map((payout, index) => {
    if (index === 0 || index === places - 1) return payout;
    const step = payout < 1_000 ? 25 : payout < 5_000 ? 50 : payout < 10_000 ? 100 : payout < 25_000 ? 250 : 500;
    return Math.round(payout / step) * step;
  });

  let difference = prizePool - payouts.reduce((sum, payout) => sum + payout, 0);
  for (let index = 1; index < places - 1 && Math.abs(difference) > 0.001; index += 1) {
    const available = difference > 0 ? payouts[index - 1] - payouts[index] : payouts[index] - payouts[index + 1];
    const adjustment = Math.sign(difference) * Math.min(Math.abs(difference), available);
    payouts[index] += adjustment;
    difference -= adjustment;
  }
  return payouts;
}

function renderPayouts(payouts, rankProbabilities) {
  document.querySelector('#payoutSummary').textContent = `${payouts.length.toLocaleString('en-US')} paid · 1st ${money.format(payouts[0])} · last ${money.format(payouts[payouts.length - 1])}`;
  const ranges = [];
  let start = 1;
  let previousAmount = Math.round(payouts[0]);
  for (let index = 1; index <= payouts.length; index += 1) {
    const amount = index < payouts.length ? Math.round(payouts[index]) : null;
    if (amount !== previousAmount) {
      const end = index;
      const places = start === end ? start.toLocaleString('en-US') : `${start.toLocaleString('en-US')}-${end.toLocaleString('en-US')}`;
      const chance = rankProbabilities.slice(start - 1, end).reduce((sum, probability) => sum + probability, 0);
      ranges.push(`<tr><td>${places}</td><td>${money.format(previousAmount)}</td><td>${(chance * 100).toFixed(2)}%</td></tr>`);
      start = index + 1;
      previousAmount = amount;
    }
  }
  const splitIndex = Math.ceil(ranges.length / 2);
  document.querySelector('#payoutRowsLeft').innerHTML = ranges.slice(0, splitIndex).join('');
  document.querySelector('#payoutRowsRight').innerHTML = ranges.slice(splitIndex).join('');
}

// Calculate exact ICM rank probabilities when all opponents have equal stacks.
function rankProbabilities(heroStack, opponentStack, opponents) {
  if (heroStack <= 0) return Array.from({ length: opponents + 1 }, (_, index) => Number(index === opponents));
  const ratio = heroStack / opponentStack;
  let rankProbability = ratio / (ratio + opponents);
  const probabilities = [];
  for (let ahead = 0; ahead <= opponents; ahead += 1) {
    probabilities.push(rankProbability);
    if (ahead < opponents) rankProbability *= (opponents - ahead) / (ratio + opponents - ahead - 1);
  }
  return probabilities;
}

function icmValue(heroStack, opponentStack, payouts) {
  const probabilities = rankProbabilities(heroStack, opponentStack, payouts.length - 1);
  return payouts.reduce((value, payout, index) => value + payout * probabilities[index], 0);
}

function renderChart({ buyIn, places, bonus, chance, totalChips, payouts, secondMinCashValue, stackDistribution }) {
  const width = 860;
  const height = 500;
  const plot = { left: 96, right: 20, top: 12, bottom: 70 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const maxX = 1_000_000;
  const points = Array.from({ length: 41 }, (_, index) => {
    const x = maxX * index / 40;
    const opponentStack = (totalChips - x) / (places - 1);
    const beforeIcm = icmValue(x, opponentStack, payouts);
    let qualifyingIcm = 0;
    for (const outcome of stackDistribution) {
      const finalStack = Math.max(x, outcome.stack);
      const finalOpponentStack = (totalChips - finalStack) / (places - 1);
      qualifyingIcm += outcome.weight * icmValue(finalStack, finalOpponentStack, payouts);
    }
    return { x, y: (chance / 100) * (qualifyingIcm - beforeIcm + bonus + secondMinCashValue) - buyIn };
  });
  const minY = Math.min(0, ...points.map((point) => point.y));
  const maxY = Math.max(0, ...points.map((point) => point.y));
  const rawStep = Math.max((maxY - minY) / 5, 0.01);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
  const low = Math.floor(minY / step) * step;
  const high = Math.ceil(maxY / step) * step || step;
  const xScale = (x) => plot.left + x / maxX * plotWidth;
  const yScale = (y) => plot.top + (high - y) / (high - low) * plotHeight;
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${xScale(point.x)} ${yScale(point.y)}`).join(' ');
  const yTicks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => low + index * step);
  const grid = yTicks.map((value) => {
    const y = yScale(value);
    const isZero = Math.abs(value) < 0.001;
    const label = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: step < 1 ? 2 : 0 }).format(value);
    return `<line x1="${plot.left}" y1="${y}" x2="${width - plot.right}" y2="${y}" stroke="${isZero ? '#dddddd' : '#424242'}" stroke-width="${isZero ? 2 : 1}"/><text x="${plot.left - 14}" y="${y + 6}" fill="${isZero ? '#ffffff' : '#b7b7b7'}" font-size="15" font-weight="${isZero ? 700 : 500}" text-anchor="end">${label}</text>`;
  }).join('');
  const xTicks = [0, 200_000, 400_000, 600_000, 800_000, maxX];
  const verticalGrid = xTicks.map((x) => `<line x1="${xScale(x)}" y1="${plot.top}" x2="${xScale(x)}" y2="${plot.top + plotHeight}" stroke="#424242"/>`).join('');
  const labels = xTicks.map((x) => `<text x="${xScale(x)}" y="${height - 29}" fill="#b7b7b7" font-size="15" text-anchor="middle">${chips.format(x)}</text>`).join('');
  svg.innerHTML = `${verticalGrid}${grid}<path d="${line}" fill="none" stroke="#3b82f6" stroke-width="3.5" stroke-linecap="round"/><text x="${plot.left + plotWidth / 2}" y="${height - 3}" fill="#e0e0e0" font-size="15" font-weight="600" text-anchor="middle">Already secured Day 2 stack (chips)</text><text x="19" y="${plot.top + plotHeight / 2}" fill="#e0e0e0" font-size="15" font-weight="600" text-anchor="middle" transform="rotate(-90 19 ${plot.top + plotHeight / 2})">Expected value</text>${labels}`;
  return points;
}

function update() {
  const { buyIn, prizePool, players, minCash, averageStack, bonus, chance } = readValues();
  const valid = [buyIn, prizePool, players, minCash, averageStack, bonus, chance].every(Number.isFinite)
    && buyIn >= 0 && prizePool > 0 && Number.isInteger(players) && players >= 2
    && minCash >= 0 && minCash < prizePool * 0.10 && averageStack > 0 && bonus >= 0 && chance >= 0 && chance <= 100;
  const firstPrize = prizePool * 0.10;
  const minimumPool = minCash * players + firstPrize - minCash;
  const maximumPool = firstPrize * (players - 1) + minCash;
  if (!valid || prizePool < minimumPool || prizePool > maximumPool) {
    document.querySelector('#breakEven').textContent = !valid ? 'Check inputs' : 'Prize pool does not fit payouts';
    document.querySelector('#payoutSummary').textContent = 'Update the inputs to show payouts';
    document.querySelector('#payoutRowsLeft').innerHTML = '';
    document.querySelector('#payoutRowsRight').innerHTML = '';
    return;
  }

  const payouts = makePayouts(prizePool, minCash, players);
  const totalChips = players * averageStack;
  const stackDistribution = buildStackDistribution(averageStack);
  renderProbabilityChart(stackDistribution, chance);
  const averageStackRanks = rankProbabilities(averageStack, averageStack, players - 1);
  renderPayouts(payouts, averageStackRanks);
  const secondMinCashValue = document.querySelector('#secondMinCash').checked ? minCash : 0;
  const points = renderChart({ buyIn, places: players, bonus, chance, averageStack, totalChips, payouts, secondMinCashValue, stackDistribution });
  const firstProfitable = points.findIndex((point) => point.y >= 0);
  const crossing = firstProfitable < 0 ? null : points.find((point, index) => index > firstProfitable && point.y < 0 && points[index - 1].y >= 0);
  const result = firstProfitable < 0
    ? 'Re-entry is not profitable'
    : crossing
      ? `${chips.format(crossing.x)} chips`
      : `Above ${chips.format(points[points.length - 1].x)} chips`;
  document.querySelector('#breakEven').textContent = result;
}

document.querySelectorAll('input').forEach((input) => input.addEventListener('input', update));
document.querySelector('#secondMinCash').addEventListener('change', update);
update();
