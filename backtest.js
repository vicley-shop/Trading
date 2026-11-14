/*
 * backtest.js — simulador de operaciones, estadísticas y plan de operación.
 * Reglas del simulador (conservadoras):
 *  - la señal se calcula al cierre de la barra i y se entra en la apertura de i+1;
 *  - el stop y el objetivo son múltiplos del ATR(14) de la barra de la señal;
 *  - si en una misma barra se tocan stop y objetivo, se asume que saltó el stop;
 *  - cada operación paga el spread completo;
 *  - también se sale por señal contraria (al cierre) o por tiempo máximo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategies.js'));
  else { root.AT = root.AT || {}; root.AT.backtest = factory(root.AT.strategies); }
}(typeof self !== 'undefined' ? self : this, function (ST) {
  'use strict';

  // Datos de contrato típicos de MT5; confírmalos con tu bróker.
  const SYMBOLS = {
    XAUUSD: { name: 'Oro', digits: 2, contract: 100, spread: 0.30 },
    XAGUSD: { name: 'Plata', digits: 3, contract: 5000, spread: 0.03 },
    EURUSD: { name: 'Euro / Dólar', digits: 5, contract: 100000, spread: 0.00010 }
  };

  const DEFAULTS = { maxBars: 100, exitOnOpposite: true, oosFrac: 0.3, spread: 0 };

  function simulate(ind, sig, o) {
    const k = ind.k, n = k.n, atr = ind.atr, trades = [];
    let pos = null;

    function close(i, price, reason) {
      const pnl = pos.dir * (price - pos.entry) - o.spread;
      trades.push({
        dir: pos.dir, entryIdx: pos.entryIdx, exitIdx: i, t: pos.t, tExit: k.t[i],
        entry: pos.entry, exit: price, sl: pos.sl, tp: pos.tp,
        pnl: pnl, r: pnl / pos.risk, reason: reason
      });
      pos = null;
    }

    for (let i = 1; i < n; i++) {
      if (!pos && sig[i - 1] !== 0 && atr[i - 1] != null && atr[i - 1] > 0) {
        const dir = sig[i - 1], risk = o.slMult * atr[i - 1], entry = k.o[i];
        pos = { dir: dir, entryIdx: i, t: k.t[i], entry: entry, risk: risk,
                sl: entry - dir * risk, tp: entry + dir * o.tpMult * atr[i - 1] };
      }
      if (!pos) continue;

      const gap = i > pos.entryIdx;
      if (pos.dir === 1) {
        if (gap && k.o[i] <= pos.sl) { close(i, k.o[i], 'sl'); continue; }
        if (gap && k.o[i] >= pos.tp) { close(i, k.o[i], 'tp'); continue; }
        if (k.l[i] <= pos.sl) { close(i, pos.sl, 'sl'); continue; }
        if (k.h[i] >= pos.tp) { close(i, pos.tp, 'tp'); continue; }
      } else {
        if (gap && k.o[i] >= pos.sl) { close(i, k.o[i], 'sl'); continue; }
        if (gap && k.o[i] <= pos.tp) { close(i, k.o[i], 'tp'); continue; }
        if (k.h[i] >= pos.sl) { close(i, pos.sl, 'sl'); continue; }
        if (k.l[i] <= pos.tp) { close(i, pos.tp, 'tp'); continue; }
      }
      if (o.exitOnOpposite && sig[i] === -pos.dir) close(i, k.c[i], 'opuesta');
      else if (i - pos.entryIdx + 1 >= o.maxBars) close(i, k.c[i], 'tiempo');
    }
    return trades; // una operación aún abierta al final no se cuenta
  }

  function stats(trades) {
    const n = trades.length;
    let wins = 0, gw = 0, gl = 0, sumR = 0, eq = 0, peak = 0, maxDD = 0, pnl = 0;
    const equity = [0];
    trades.forEach(function (t) {
      if (t.r > 0) { wins++; gw += t.r; } else gl += -t.r;
      sumR += t.r; pnl += t.pnl; eq += t.r; equity.push(eq);
      if (eq > peak) peak = eq;
      if (peak - eq > maxDD) maxDD = peak - eq;
    });
    return {
      n: n, wins: wins, winRate: n ? wins / n : 0,
      pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
      expectancy: n ? sumR / n : 0, netR: sumR, maxDD: maxDD, netPnl: pnl, equity: equity,
      avgWin: wins ? gw / wins : 0, avgLoss: (n - wins) ? gl / (n - wins) : 0
    };
  }

  function verdict(full, oos) {
    if (full.n < 30) return { key: 'small', text: 'Muestra pequeña: no concluyente' };
    if (full.pf >= 1.3 && full.expectancy >= 0.15 && oos.n >= 10 && oos.pf >= 1.1) {
      return { key: 'edge', text: 'Ventaja posible: vale la pena probarla en demo' };
    }
    if (full.pf >= 1.1 && full.expectancy > 0) {
      return { key: 'marginal', text: 'Marginal: ventaja débil o que no se repite en el último 30%' };
    }
    return { key: 'none', text: 'Sin ventaja en este historial' };
  }

  function run(bars, id, opts) {
    opts = opts || {};
    const st = ST.byId[id], ind = opts.ind || ST.prepare(bars);
    const o = Object.assign({}, DEFAULTS, opts);
    o.slMult = opts.slMult || st.sl;
    o.tpMult = opts.tpMult || st.tp;
    const sig = st.run(ind);
    const trades = simulate(ind, sig, o);
    const split = Math.floor(ind.k.n * (1 - o.oosFrac));
    const full = stats(trades), oos = stats(trades.filter(function (t) { return t.entryIdx >= split; }));
    return { id: id, name: st.name, trades: trades, full: full, oos: oos, verdict: verdict(full, oos),
             opts: { slMult: o.slMult, tpMult: o.tpMult, spread: o.spread, maxBars: o.maxBars }, splitIdx: split, sig: sig };
  }

  function runAll(bars, opts) {
    const ind = ST.prepare(bars);
    return ST.list.map(function (s) { return run(bars, s.id, Object.assign({}, opts, { ind: ind })); });
  }

  // Plan de operación para una dirección (1 compra, -1 venta) al precio actual.
  function plan(dir, price, atr, o) {
    const risk = o.slMult * atr, reward = o.tpMult * atr;
    const riskUsd = o.balance * o.riskPct / 100;
    const lots = o.contract && risk > 0 ? Math.floor(riskUsd / (risk * o.contract) * 100) / 100 : 0;
    return { dir: dir, entry: price, sl: price - dir * risk, tp: price + dir * reward,
             risk: risk, reward: reward, rr: reward / risk, lots: lots, riskUsd: riskUsd, atr: atr };
  }

  return { SYMBOLS: SYMBOLS, simulate: simulate, stats: stats, verdict: verdict, run: run, runAll: runAll, plan: plan };
}));
