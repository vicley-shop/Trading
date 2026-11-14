/*
 * indicators.js — indicadores técnicos como funciones puras.
 * Cada función recibe arrays y devuelve arrays de la misma longitud,
 * con null donde todavía no hay datos suficientes.
 * Funciona en el navegador (window.AT.indicators) y en Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AT = root.AT || {}; root.AT.indicators = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nulls(n) { return new Array(n).fill(null); }

  function firstValid(v) {
    for (let i = 0; i < v.length; i++) if (v[i] != null && !isNaN(v[i])) return i;
    return -1;
  }

  function last(a, k) { return a[a.length - 1 - (k || 0)]; }

  /* ---------- medias móviles ---------- */

  function sma(v, p) {
    const n = v.length, out = nulls(n), s = firstValid(v);
    if (s < 0 || n - s < p) return out;
    let sum = 0;
    for (let i = s; i < n; i++) {
      sum += v[i];
      if (i - s >= p) sum -= v[i - p];
      if (i - s >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  // Suavizado exponencial con semilla = SMA de los primeros p valores.
  function smooth(v, p, alpha) {
    const n = v.length, out = nulls(n), s = firstValid(v);
    if (s < 0 || n - s < p) return out;
    let prev = 0;
    for (let i = s; i < s + p; i++) prev += v[i];
    prev /= p;
    out[s + p - 1] = prev;
    for (let i = s + p; i < n; i++) {
      prev = alpha * v[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  function ema(v, p) { return smooth(v, p, 2 / (p + 1)); }
  function rma(v, p) { return smooth(v, p, 1 / p); } // suavizado de Wilder

  function wma(v, p) {
    const n = v.length, out = nulls(n), s = firstValid(v);
    if (s < 0 || n - s < p) return out;
    const den = p * (p + 1) / 2;
    for (let i = s + p - 1; i < n; i++) {
      let num = 0;
      for (let j = 0; j < p; j++) num += v[i - p + 1 + j] * (j + 1);
      out[i] = num / den;
    }
    return out;
  }

  function hma(v, p) {
    const half = Math.max(1, Math.round(p / 2));
    const sq = Math.max(1, Math.round(Math.sqrt(p)));
    const a = wma(v, half), b = wma(v, p);
    const diff = v.map(function (_, i) { return (a[i] == null || b[i] == null) ? null : 2 * a[i] - b[i]; });
    return wma(diff, sq);
  }

  // Media ponderada por volumen. En forex/CFD se usa tickVolume como volumen.
  function vwma(c, vol, p) {
    p = p || 20;
    const n = c.length, out = nulls(n), plain = sma(c, p);
    for (let i = p - 1; i < n; i++) {
      let sv = 0, sp = 0;
      for (let j = i - p + 1; j <= i; j++) { sv += vol[j]; sp += c[j] * vol[j]; }
      out[i] = sv > 0 ? sp / sv : plain[i];
    }
    return out;
  }

  function highest(v, p) {
    const n = v.length, out = nulls(n);
    for (let i = p - 1; i < n; i++) {
      let m = -Infinity;
      for (let j = i - p + 1; j <= i; j++) if (v[j] > m) m = v[j];
      out[i] = m;
    }
    return out;
  }

  function lowest(v, p) {
    const n = v.length, out = nulls(n);
    for (let i = p - 1; i < n; i++) {
      let m = Infinity;
      for (let j = i - p + 1; j <= i; j++) if (v[j] < m) m = v[j];
      out[i] = m;
    }
    return out;
  }

  /* ---------- osciladores ---------- */

  function rsi(c, p) {
    p = p || 14;
    const n = c.length, out = nulls(n);
    if (n <= p) return out;
    const val = function (g, l) { return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); };
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= p; l /= p;
    out[p] = val(g, l);
    for (let i = p + 1; i < n; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
      l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
      out[i] = val(g, l);
    }
    return out;
  }

  function macd(c, f, s, g) {
    f = f || 12; s = s || 26; g = g || 9;
    const ef = ema(c, f), es = ema(c, s);
    const line = c.map(function (_, i) { return (ef[i] == null || es[i] == null) ? null : ef[i] - es[i]; });
    const sig = ema(line, g);
    const hist = line.map(function (x, i) { return (x == null || sig[i] == null) ? null : x - sig[i]; });
    return { macd: line, signal: sig, hist: hist };
  }

  function stoch(h, l, c, kp, ks, dp) {
    kp = kp || 14; ks = ks || 3; dp = dp || 3;
    const n = c.length, hh = highest(h, kp), ll = lowest(l, kp), raw = nulls(n);
    for (let i = kp - 1; i < n; i++) raw[i] = hh[i] === ll[i] ? 50 : 100 * (c[i] - ll[i]) / (hh[i] - ll[i]);
    const k = sma(raw, ks);
    return { k: k, d: sma(k, dp) };
  }

  function stochRsi(c, rp, sp, kp, dp) {
    rp = rp || 14; sp = sp || 14; kp = kp || 3; dp = dp || 3;
    const r = rsi(c, rp), n = c.length, raw = nulls(n);
    for (let i = 0; i < n; i++) {
      if (r[i] == null || i - sp + 1 < 0 || r[i - sp + 1] == null) continue;
      let mn = Infinity, mx = -Infinity;
      for (let j = i - sp + 1; j <= i; j++) { if (r[j] < mn) mn = r[j]; if (r[j] > mx) mx = r[j]; }
      raw[i] = mx === mn ? 50 : 100 * (r[i] - mn) / (mx - mn);
    }
    const k = sma(raw, kp);
    return { k: k, d: sma(k, dp) };
  }

  function cci(h, l, c, p) {
    p = p || 20;
    const n = c.length, tp = new Array(n), out = nulls(n);
    for (let i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
    const m = sma(tp, p);
    for (let i = p - 1; i < n; i++) {
      let d = 0;
      for (let j = i - p + 1; j <= i; j++) d += Math.abs(tp[j] - m[i]);
      d /= p;
      out[i] = d === 0 ? 0 : (tp[i] - m[i]) / (0.015 * d);
    }
    return out;
  }

  function williamsR(h, l, c, p) {
    p = p || 14;
    const n = c.length, hh = highest(h, p), ll = lowest(l, p), out = nulls(n);
    for (let i = p - 1; i < n; i++) out[i] = hh[i] === ll[i] ? -50 : -100 * (hh[i] - c[i]) / (hh[i] - ll[i]);
    return out;
  }

  function momentum(c, p) {
    p = p || 10;
    const out = nulls(c.length);
    for (let i = p; i < c.length; i++) out[i] = c[i] - c[i - p];
    return out;
  }

  function ao(h, l) {
    const mid = h.map(function (x, i) { return (x + l[i]) / 2; });
    const a = sma(mid, 5), b = sma(mid, 34);
    return a.map(function (x, i) { return (x == null || b[i] == null) ? null : x - b[i]; });
  }

  function uo(h, l, c) {
    const n = c.length, bp = nulls(n), rng = nulls(n), out = nulls(n);
    for (let i = 1; i < n; i++) {
      const lo = Math.min(l[i], c[i - 1]), hi = Math.max(h[i], c[i - 1]);
      bp[i] = c[i] - lo; rng[i] = hi - lo;
    }
    function avg(i, p) {
      let sb = 0, sr = 0;
      for (let j = i - p + 1; j <= i; j++) { sb += bp[j]; sr += rng[j]; }
      return sr === 0 ? 0 : sb / sr;
    }
    for (let i = 28; i < n; i++) out[i] = 100 * (4 * avg(i, 7) + 2 * avg(i, 14) + avg(i, 28)) / 7;
    return out;
  }

  function bullBear(h, l, c, p) {
    const e = ema(c, p || 13);
    return {
      ema: e,
      bull: h.map(function (x, i) { return e[i] == null ? null : x - e[i]; }),
      bear: l.map(function (x, i) { return e[i] == null ? null : x - e[i]; })
    };
  }

  /* ---------- volatilidad y tendencia ---------- */

  function tr(h, l, c) {
    const out = new Array(c.length);
    out[0] = h[0] - l[0];
    for (let i = 1; i < c.length; i++) {
      out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    return out;
  }

  function atr(h, l, c, p) { return rma(tr(h, l, c), p || 14); }

  function adx(h, l, c, p) {
    p = p || 14;
    const n = c.length, pdm = nulls(n), mdm = nulls(n), t = nulls(n);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      pdm[i] = (up > dn && up > 0) ? up : 0;
      mdm[i] = (dn > up && dn > 0) ? dn : 0;
      t[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    const sp = rma(pdm, p), sm = rma(mdm, p), st = rma(t, p);
    const pdi = nulls(n), mdi = nulls(n), dx = nulls(n);
    for (let i = 0; i < n; i++) {
      if (st[i] == null) continue;
      pdi[i] = st[i] === 0 ? 0 : 100 * sp[i] / st[i];
      mdi[i] = st[i] === 0 ? 0 : 100 * sm[i] / st[i];
      const s = pdi[i] + mdi[i];
      dx[i] = s === 0 ? 0 : 100 * Math.abs(pdi[i] - mdi[i]) / s;
    }
    return { adx: rma(dx, p), pdi: pdi, mdi: mdi };
  }

  function bollinger(c, p, m) {
    p = p || 20; m = m || 2;
    const n = c.length, mid = sma(c, p), up = nulls(n), lo = nulls(n);
    for (let i = p - 1; i < n; i++) {
      let s = 0;
      for (let j = i - p + 1; j <= i; j++) s += (c[j] - mid[i]) * (c[j] - mid[i]);
      const sd = Math.sqrt(s / p);
      up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd;
    }
    return { mid: mid, upper: up, lower: lo };
  }

  function ichimoku(h, l) {
    function line(p) {
      const hh = highest(h, p), ll = lowest(l, p);
      return hh.map(function (x, i) { return x == null ? null : (x + ll[i]) / 2; });
    }
    return { tenkan: line(9), kijun: line(26) };
  }

  // dir: 1 = tendencia alcista (línea bajo el precio), -1 = bajista.
  function supertrend(h, l, c, p, mult) {
    p = p || 10; mult = mult || 3;
    const a = atr(h, l, c, p), n = c.length, line = nulls(n), dir = nulls(n);
    let fu = null, fl = null, d = 1;
    for (let i = 0; i < n; i++) {
      if (a[i] == null) continue;
      const mid = (h[i] + l[i]) / 2;
      const bu = mid + mult * a[i], bl = mid - mult * a[i];
      if (fu === null) {
        fu = bu; fl = bl; d = c[i] >= mid ? 1 : -1;
      } else {
        const pfu = fu, pfl = fl;
        fu = (bu < pfu || c[i - 1] > pfu) ? bu : pfu;
        fl = (bl > pfl || c[i - 1] < pfl) ? bl : pfl;
        if (d === -1 && c[i] > fu) d = 1;
        else if (d === 1 && c[i] < fl) d = -1;
      }
      line[i] = d === 1 ? fl : fu;
      dir[i] = d;
    }
    return { line: line, dir: dir };
  }

  return {
    nulls: nulls, last: last,
    sma: sma, ema: ema, rma: rma, wma: wma, hma: hma, vwma: vwma,
    highest: highest, lowest: lowest,
    rsi: rsi, macd: macd, stoch: stoch, stochRsi: stochRsi, cci: cci,
    williamsR: williamsR, momentum: momentum, ao: ao, uo: uo, bullBear: bullBear,
    tr: tr, atr: atr, adx: adx, bollinger: bollinger, ichimoku: ichimoku, supertrend: supertrend
  };
}));
