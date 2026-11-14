/*
 * strategies.js — estrategias de entrada. Cada una devuelve, para cada barra,
 * 1 (comprar), -1 (vender) o 0, usando solo datos hasta el cierre de esa barra.
 * sl / tp son los múltiplos de ATR(14) por defecto para el stop y el objetivo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./indicators.js'), require('./signals.js'));
  else { root.AT = root.AT || {}; root.AT.strategies = factory(root.AT.indicators, root.AT.signals); }
}(typeof self !== 'undefined' ? self : this, function (I, S) {
  'use strict';

  function memo(ind, key, fn) { return ind.x[key] || (ind.x[key] = fn()); }

  function crossUp(a, b, i) {
    return i > 0 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1] <= b[i - 1] && a[i] > b[i];
  }
  function crossDown(a, b, i) {
    return i > 0 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i - 1] >= b[i - 1] && a[i] < b[i];
  }

  const list = [
    {
      id: 'ema_cross', name: 'Cruce EMA 9/21 con filtro EMA 200', sl: 1.5, tp: 3,
      desc: 'Sigue tendencia: compra si la EMA 9 cruza sobre la 21 y el precio está sobre la EMA 200 (al revés para vender).',
      run: function (ind) {
        const k = ind.k, c = k.c, sig = new Array(k.n).fill(0);
        const f = memo(ind, 'ema9', function () { return I.ema(c, 9); });
        const s = memo(ind, 'ema21', function () { return I.ema(c, 21); });
        const t = memo(ind, 'ema200', function () { return I.ema(c, 200); });
        for (let i = 1; i < k.n; i++) {
          if (t[i] == null) continue;
          if (crossUp(f, s, i) && c[i] > t[i]) sig[i] = 1;
          else if (crossDown(f, s, i) && c[i] < t[i]) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'supertrend', name: 'Supertrend (10, 3)', sl: 1.5, tp: 3,
      desc: 'Sigue tendencia: opera cada cambio de dirección del Supertrend.',
      run: function (ind) {
        const k = ind.k, sig = new Array(k.n).fill(0);
        const st = memo(ind, 'st', function () { return I.supertrend(k.h, k.l, k.c, 10, 3); });
        for (let i = 1; i < k.n; i++) {
          if (st.dir[i] == null || st.dir[i - 1] == null) continue;
          if (st.dir[i] === 1 && st.dir[i - 1] === -1) sig[i] = 1;
          else if (st.dir[i] === -1 && st.dir[i - 1] === 1) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'macd_cross', name: 'Cruce MACD con filtro EMA 200', sl: 1.5, tp: 3,
      desc: 'Sigue tendencia: cruce de la línea MACD con su señal, solo a favor de la EMA 200.',
      run: function (ind) {
        const k = ind.k, c = k.c, sig = new Array(k.n).fill(0);
        const t = memo(ind, 'ema200', function () { return I.ema(c, 200); });
        for (let i = 1; i < k.n; i++) {
          if (t[i] == null) continue;
          if (crossUp(ind.macd.macd, ind.macd.signal, i) && c[i] > t[i]) sig[i] = 1;
          else if (crossDown(ind.macd.macd, ind.macd.signal, i) && c[i] < t[i]) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'rsi_rev', name: 'RSI de reversión en rango (ADX < 25)', sl: 1.5, tp: 1.5,
      desc: 'Reversión: compra cuando el RSI vuelve a subir de 30 y vende cuando baja de 70, solo si el mercado está lateral.',
      run: function (ind) {
        const k = ind.k, r = ind.rsi, sig = new Array(k.n).fill(0);
        for (let i = 1; i < k.n; i++) {
          const a = ind.adx.adx[i];
          if (r[i] == null || r[i - 1] == null || a == null || a >= 25) continue;
          if (r[i - 1] < 30 && r[i] >= 30) sig[i] = 1;
          else if (r[i - 1] > 70 && r[i] <= 70) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'bb_rev', name: 'Rebote en Bollinger (20, 2) en rango', sl: 1.5, tp: 1.5,
      desc: 'Reversión: compra si el precio cierra de nuevo dentro de la banda inferior, vende en la superior; solo con ADX < 25.',
      run: function (ind) {
        const k = ind.k, c = k.c, sig = new Array(k.n).fill(0);
        const bb = memo(ind, 'bb', function () { return I.bollinger(c, 20, 2); });
        for (let i = 1; i < k.n; i++) {
          const a = ind.adx.adx[i];
          if (bb.lower[i] == null || bb.lower[i - 1] == null || a == null || a >= 25) continue;
          if (c[i - 1] < bb.lower[i - 1] && c[i] > bb.lower[i]) sig[i] = 1;
          else if (c[i - 1] > bb.upper[i - 1] && c[i] < bb.upper[i]) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'donchian', name: 'Ruptura de canal Donchian (20)', sl: 2, tp: 4,
      desc: 'Ruptura: compra si el cierre supera el máximo de las 20 barras anteriores, vende si pierde el mínimo.',
      run: function (ind) {
        const k = ind.k, c = k.c, sig = new Array(k.n).fill(0);
        const hi = memo(ind, 'dh', function () { return I.highest(k.h, 20); });
        const lo = memo(ind, 'dl', function () { return I.lowest(k.l, 20); });
        for (let i = 21; i < k.n; i++) {
          if (hi[i - 1] == null) continue;
          if (c[i] > hi[i - 1]) sig[i] = 1;
          else if (c[i] < lo[i - 1]) sig[i] = -1;
        }
        return sig;
      }
    },
    {
      id: 'consenso', name: 'Consenso del medidor (±0,5)', sl: 1.5, tp: 2.5,
      desc: 'Opera cuando el medidor pasa a Compra fuerte o a Venta fuerte (votan 26 indicadores).',
      run: function (ind) {
        const k = ind.k, sig = new Array(k.n).fill(0);
        const r = memo(ind, 'rating', function () { return S.ratingSeries(ind, 200); });
        for (let i = 1; i < k.n; i++) {
          if (r[i] == null || r[i - 1] == null) continue;
          if (r[i] >= 0.5 && r[i - 1] < 0.5) sig[i] = 1;
          else if (r[i] <= -0.5 && r[i - 1] > -0.5) sig[i] = -1;
        }
        return sig;
      }
    }
  ];

  const byId = {};
  list.forEach(function (s) { byId[s.id] = s; });

  return { list: list, byId: byId, prepare: S.compute, crossUp: crossUp, crossDown: crossDown };
}));
