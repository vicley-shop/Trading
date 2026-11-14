/*
 * signals.js — medidor de señales estilo TradingView.
 * Cada indicador vota COMPRA / VENTA / NEUTRAL; el resultado se resume en
 * una puntuación entre -1 y +1 (medias móviles y osciladores pesan igual).
 * Las reglas de voto son propias, inspiradas en ese tipo de medidores.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./indicators.js'));
  else { root.AT = root.AT || {}; root.AT.signals = factory(root.AT.indicators); }
}(typeof self !== 'undefined' ? self : this, function (I) {
  'use strict';

  const BUY = 1, SELL = -1, NEUTRAL = 0;

  // bars: [{t,o,h,l,c,v}] de la más antigua a la más reciente.
  function cols(bars) {
    const n = bars.length;
    const k = { o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n), t: new Array(n), n: n };
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      k.o[i] = b.o; k.h[i] = b.h; k.l[i] = b.l; k.c[i] = b.c; k.v[i] = b.v || 0; k.t[i] = b.t;
    }
    return k;
  }

  // Calcula todos los indicadores una sola vez para poder evaluarlos en cualquier barra.
  function compute(bars) {
    const k = cols(bars), h = k.h, l = k.l, c = k.c;
    const ind = { k: k, maList: [], x: {} };
    [10, 20, 30, 50, 100, 200].forEach(function (p) {
      ind.maList.push({ name: 'EMA ' + p, arr: I.ema(c, p) });
      ind.maList.push({ name: 'SMA ' + p, arr: I.sma(c, p) });
    });
    ind.maList.push({ name: 'Ichimoku base (26)', arr: I.ichimoku(h, l).kijun });
    ind.maList.push({ name: 'VWMA (20)', arr: I.vwma(c, k.v, 20) });
    ind.maList.push({ name: 'Hull MA (9)', arr: I.hma(c, 9) });
    ind.rsi = I.rsi(c, 14);
    ind.stoch = I.stoch(h, l, c, 14, 3, 3);
    ind.cci = I.cci(h, l, c, 20);
    ind.adx = I.adx(h, l, c, 14);
    ind.ao = I.ao(h, l);
    ind.mom = I.momentum(c, 10);
    ind.macd = I.macd(c, 12, 26, 9);
    ind.srsi = I.stochRsi(c, 14, 14, 3, 3);
    ind.wr = I.williamsR(h, l, c, 14);
    ind.bb = I.bullBear(h, l, c, 13);
    ind.uo = I.uo(h, l, c);
    ind.atr = I.atr(h, l, c, 14);
    return ind;
  }

  function maVotes(ind, i) {
    const price = ind.k.c[i], out = [];
    ind.maList.forEach(function (m) {
      const v = m.arr[i];
      if (v == null) return;
      out.push({ name: m.name, value: v, action: price > v ? BUY : price < v ? SELL : NEUTRAL });
    });
    return out;
  }

  function ok() {
    for (let a = 0; a < arguments.length; a++) if (arguments[a] == null) return false;
    return true;
  }

  function oscVotes(ind, i) {
    const out = [], p = i - 1;
    function add(name, value, action) { out.push({ name: name, value: value, action: action }); }
    let a, b;

    a = ind.rsi[i]; b = ind.rsi[p];
    if (ok(a, b)) add('RSI (14)', a, (a < 30 && a > b) ? BUY : (a > 70 && a < b) ? SELL : NEUTRAL);

    const k = ind.stoch.k[i], d = ind.stoch.d[i];
    if (ok(k, d)) add('Estocástico %K (14,3,3)', k, (k < 20 && d < 20 && k > d) ? BUY : (k > 80 && d > 80 && k < d) ? SELL : NEUTRAL);

    a = ind.cci[i]; b = ind.cci[p];
    if (ok(a, b)) add('CCI (20)', a, (a < -100 && a > b) ? BUY : (a > 100 && a < b) ? SELL : NEUTRAL);

    const ax = ind.adx.adx[i], pd = ind.adx.pdi[i], md = ind.adx.mdi[i];
    if (ok(ax, pd, md)) add('ADX (14)', ax, ax > 20 ? (pd > md ? BUY : pd < md ? SELL : NEUTRAL) : NEUTRAL);

    a = ind.ao[i]; b = ind.ao[p];
    if (ok(a, b)) add('Awesome Oscillator', a, (a > 0 && a > b) ? BUY : (a < 0 && a < b) ? SELL : NEUTRAL);

    a = ind.mom[i]; b = ind.mom[p];
    if (ok(a, b)) add('Momentum (10)', a, a > b ? BUY : a < b ? SELL : NEUTRAL);

    a = ind.macd.macd[i]; b = ind.macd.signal[i];
    if (ok(a, b)) add('MACD (12,26,9)', a, a > b ? BUY : a < b ? SELL : NEUTRAL);

    const sk = ind.srsi.k[i], sd = ind.srsi.d[i];
    if (ok(sk, sd)) add('Stoch RSI (14,14,3,3)', sk, (sk < 20 && sd < 20 && sk > sd) ? BUY : (sk > 80 && sd > 80 && sk < sd) ? SELL : NEUTRAL);

    a = ind.wr[i]; b = ind.wr[p];
    if (ok(a, b)) add('Williams %R (14)', a, (a < -80 && a > b) ? BUY : (a > -20 && a < b) ? SELL : NEUTRAL);

    const bu = ind.bb.bull[i], be = ind.bb.bear[i], e0 = ind.bb.ema[i], e1 = ind.bb.ema[p];
    const bu1 = ind.bb.bull[p], be1 = ind.bb.bear[p];
    if (ok(bu, be, e0, e1, bu1, be1)) {
      add('Bull/Bear Power (13)', bu + be,
        (e0 > e1 && be < 0 && be > be1) ? BUY : (e0 < e1 && bu > 0 && bu < bu1) ? SELL : NEUTRAL);
    }

    a = ind.uo[i];
    if (ok(a)) add('Ultimate Oscillator', a, a > 70 ? BUY : a < 30 ? SELL : NEUTRAL);
    return out;
  }

  function tally(votes) {
    let b = 0, s = 0, z = 0;
    votes.forEach(function (v) { if (v.action === BUY) b++; else if (v.action === SELL) s++; else z++; });
    const total = b + s + z;
    return { buy: b, sell: s, neutral: z, total: total, score: total ? (b - s) / total : 0 };
  }

  function label(score) {
    if (score >= 0.5) return { key: 'strong_buy', text: 'Compra fuerte', dir: 1 };
    if (score >= 0.1) return { key: 'buy', text: 'Compra', dir: 1 };
    if (score > -0.1) return { key: 'neutral', text: 'Neutral', dir: 0 };
    if (score > -0.5) return { key: 'sell', text: 'Venta', dir: -1 };
    return { key: 'strong_sell', text: 'Venta fuerte', dir: -1 };
  }

  // Resumen del medidor en la barra i.
  function summaryAt(ind, i) {
    const m = maVotes(ind, i), o = oscVotes(ind, i);
    const tm = tally(m), to = tally(o), all = tally(m.concat(o));
    let score = 0;
    if (tm.total && to.total) score = (tm.score + to.score) / 2;
    else if (tm.total) score = tm.score;
    else if (to.total) score = to.score;
    return {
      score: score, label: label(score),
      ma: { votes: m, t: tm, label: label(tm.score) },
      osc: { votes: o, t: to, label: label(to.score) },
      counts: { buy: all.buy, sell: all.sell, neutral: all.neutral }
    };
  }

  function analyze(bars) {
    const ind = compute(bars), i = bars.length - 1;
    const s = summaryAt(ind, i);
    s.ind = ind;
    s.price = bars[i].c;
    s.atr = ind.atr[i];
    s.adx = ind.adx.adx[i];
    s.rsi = ind.rsi[i];
    return s;
  }

  // Puntuación del medidor en cada barra (null mientras falten datos).
  function ratingSeries(ind, warmup) {
    const n = ind.k.n, out = new Array(n).fill(null);
    for (let i = Math.max(1, warmup || 0); i < n; i++) out[i] = summaryAt(ind, i).score;
    return out;
  }

  return {
    BUY: BUY, SELL: SELL, NEUTRAL: NEUTRAL,
    compute: compute, summaryAt: summaryAt, analyze: analyze, ratingSeries: ratingSeries,
    label: label, tally: tally
  };
}));
