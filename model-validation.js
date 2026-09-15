/**
 * model-validation.js
 * ────────────────────
 * Adds two things the original forecasting.js didn't have:
 *
 *  1. Damped-trend Holt-Winters — fixes trend over-extrapolation on long
 *     horizons (the standard model's linear trend term compounds error
 *     across 30-90 day forecasts; damping caps that).
 *
 *  2. Automatic backtesting + model selection — for a given business's
 *     historical series, holds out the last 30 real days, tests every
 *     candidate model against them, and picks the one that actually
 *     performed best for THAT business. Also returns the metrics so the
 *     UI can show "why" — this is the validation story for judges/lenders.
 *
 * Drop this file next to forecasting.js and import from app.js.
 */

'use strict';

// ─── DAMPED-TREND HOLT-WINTERS ───────────────────────────────────────────────

function initSeasonals(y, m) {
  const nSeasons = Math.floor(y.length / m);
  if (nSeasons < 1) return new Array(m).fill(0);
  const seasonAvgs = [];
  for (let i = 0; i < nSeasons; i++) {
    let sum = 0;
    for (let j = 0; j < m; j++) sum += y[i * m + j];
    seasonAvgs.push(sum / m);
  }
  const seasonals = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sumDev = 0;
    for (let i = 0; i < nSeasons; i++) sumDev += y[i * m + j] - seasonAvgs[i];
    seasonals[j] = sumDev / nSeasons;
  }
  const mean = seasonals.reduce((a, b) => a + b, 0) / m;
  return seasonals.map(s => s - mean);
}

/**
 * Damped-trend variant of Holt-Winters additive triple exponential smoothing.
 * phi < 1 shrinks the trend's contribution at each future step, preventing
 * a noisy trend estimate from compounding into a wildly wrong long forecast.
 * phi = 1 is mathematically identical to the original undamped model.
 */
export function holtWintersDamped(y, alpha = 0.3, beta = 0.1, gamma = 0.2, horizon = 90, m = 7, confPct = 0.15, phi = 0.9) {
  const n = y.length;
  if (n < 2 * m) {
    const last = y[n - 1] ?? 0;
    const forecast = new Array(horizon).fill(last);
    return {
      forecast,
      upper: forecast.map(v => v * (1 + confPct)),
      lower: forecast.map(v => v * (1 - confPct)),
    };
  }

  let seasonals = initSeasonals(y, m);
  let l = y.slice(0, m).reduce((a, b) => a + b, 0) / m;
  let b = (y.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m - l) / m;

  for (let t = 0; t < n; t++) {
    const s_prev = seasonals[((t - m) % m + m) % m];
    const l_prev = l, b_prev = b;
    const yt = y[t];
    l = alpha * (yt - s_prev) + (1 - alpha) * (l_prev + phi * b_prev);
    b = beta * (l - l_prev) + (1 - beta) * (phi * b_prev);
    seasonals[t % m] = gamma * (yt - l_prev - phi * b_prev) + (1 - gamma) * s_prev;
  }

  const forecast = [], upper = [], lower = [];
  let phiSum = 0;
  for (let k = 1; k <= horizon; k++) {
    phiSum += Math.pow(phi, k);
    const s_idx = ((n - m + ((k - 1) % m)) % m + m) % m;
    const fk = l + phiSum * b + seasonals[s_idx];
    forecast.push(fk);
    upper.push(fk * (1 + confPct));
    lower.push(fk * (1 - confPct));
  }
  return { forecast, upper, lower };
}

// ─── CANDIDATE BASELINE MODELS ────────────────────────────────────────────────

function naiveForecast(train, horizon) {
  return new Array(horizon).fill(train[train.length - 1]);
}

function seasonalNaiveForecast(train, horizon, m = 7) {
  const out = [];
  for (let k = 0; k < horizon; k++) out.push(train[train.length - m + (k % m)]);
  return out;
}

function movingAverageForecast(train, horizon, window = 7) {
  const last = train.slice(-window);
  const avg = last.reduce((a, b) => a + b, 0) / last.length;
  return new Array(horizon).fill(avg);
}

// ─── METRICS ──────────────────────────────────────────────────────────────────

function cumsum(arr) { let s = 0; return arr.map(v => (s += v)); }

function dayNError(actual, forecast, day) {
  const aCum = cumsum(actual)[day - 1];
  const fCum = cumsum(forecast)[day - 1];
  return Math.abs(aCum - fCum);
}

function rmse(actual, forecast) {
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += (actual[i] - forecast[i]) ** 2;
  return Math.sqrt(s / actual.length);
}

// ─── AUTO BACKTEST + MODEL SELECTION ─────────────────────────────────────────

/**
 * Backtests every candidate model against the last `holdout` real days of
 * this specific business's history, and picks the model that produced the
 * lowest error on the metric that matches the product's actual claim:
 * cumulative balance accuracy at the end of the horizon (default day 30).
 *
 * @param {number[]} netFlowSeries - full historical daily net cash flow
 * @param {object}   opts - { holdout=30, alphaGrid, betaGrid, gammaGrid, phiGrid, m=7 }
 * @returns {{
 *   bestModel: string,
 *   bestParams: object,
 *   leaderboard: Array<{ model: string, day30Error: number, rmse: number }>,
 *   forecastFn: (train:number[], horizon:number) => number[]  // ready to call on full history
 * }}
 */
export function backtestAndSelectModel(netFlowSeries, opts = {}) {
  const {
    holdout = 30,
    m = 7,
    phiGrid = [0.7, 0.8, 0.85, 0.9, 0.95, 1.0],
    alpha = 0.3, beta = 0.1, gamma = 0.2, // kept fixed; only phi is tuned to avoid overfitting on 30 pts
  } = opts;

  const n = netFlowSeries.length;
  if (n < holdout + 2 * m) {
    // not enough history to backtest meaningfully — fall back to moving average
    return {
      bestModel: 'moving_average',
      bestParams: {},
      leaderboard: [],
      forecastFn: (train, horizon) => movingAverageForecast(train, horizon),
      note: 'Insufficient history for backtesting; defaulted to 7-day moving average.',
    };
  }

  const train = netFlowSeries.slice(0, n - holdout);
  const test = netFlowSeries.slice(n - holdout);

  // find best phi for damped HW on this business's own holdout
  let bestPhi = 1.0, bestPhiErr = Infinity;
  for (const phi of phiGrid) {
    const f = holtWintersDamped(train, alpha, beta, gamma, holdout, m, 0.15, phi).forecast;
    const err = dayNError(test, f, holdout);
    if (err < bestPhiErr) { bestPhiErr = err; bestPhi = phi; }
  }

  const candidates = {
    naive: naiveForecast(train, holdout),
    seasonal_naive: seasonalNaiveForecast(train, holdout, m),
    moving_average: movingAverageForecast(train, holdout, 7),
    holt_winters_damped: holtWintersDamped(train, alpha, beta, gamma, holdout, m, 0.15, bestPhi).forecast,
  };

  const leaderboard = Object.entries(candidates).map(([model, forecast]) => ({
    model,
    day30Error: Math.round(dayNError(test, forecast, holdout)),
    rmse: Math.round(rmse(test, forecast)),
  })).sort((a, b) => a.day30Error - b.day30Error);

  const bestModel = leaderboard[0].model;

  const forecastFns = {
    naive: (tr, h) => naiveForecast(tr, h),
    seasonal_naive: (tr, h) => seasonalNaiveForecast(tr, h, m),
    moving_average: (tr, h) => movingAverageForecast(tr, h, 7),
    holt_winters_damped: (tr, h) => holtWintersDamped(tr, alpha, beta, gamma, h, m, 0.15, bestPhi).forecast,
  };

  return {
    bestModel,
    bestParams: bestModel === 'holt_winters_damped' ? { alpha, beta, gamma, phi: bestPhi } : {},
    leaderboard,
    forecastFn: forecastFns[bestModel],
  };
}

/**
 * Convenience wrapper: backtest, select, then forecast the real future
 * (using ALL available history, not just the holdout split).
 */
export function forecastWithValidation(netFlowSeries, horizon = 30, opts = {}) {
  const selection = backtestAndSelectModel(netFlowSeries, opts);
  const forecast = selection.forecastFn(netFlowSeries, horizon);
  return { ...selection, forecast };
}
