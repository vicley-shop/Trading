/*
 * app-backtest.js — pestaña «Backtest»: estrategias sobre el historial del
 * activo y la temporalidad elegidos, y mapa de esperanza por temporalidad.
 */
(function () {
  'use strict';
  const AT = window.AT, App = AT.app, B = AT.backtest, ST = AT.strategies, D = AT.data;
  const state = App.state;
  const $ = function (id) { return document.getElementById(id); };
  let seq = 0;

  function pct(x) { return (x * 100).toFixed(0) + '%'; }
  function pf(x) { return !isFinite(x) ? '∞' : x.toFixed(2); }
  const BADGE = { edge: 'Ventaja posible', marginal: 'Marginal', none: 'Sin ventaja', small: 'Muestra pequeña' };

  function equitySvg(eq) {
    const n = eq.length - 1;
    if (n < 1) return '';
    let lo = Math.min.apply(null, eq), hi = Math.max.apply(null, eq);
    if (hi === lo) { hi += 1; lo -= 1; }
    const X = function (i) { return (i / n * 100).toFixed(2); };
    const Y = function (v) { return (38 - (v - lo) / (hi - lo) * 36).toFixed(2); };
    const pts = eq.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ');
    return '<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Curva de resultado en R"><line class="eq0" x1="0" x2="100" y1="' + Y(0) + '" y2="' + Y(0) +
      '"/><polyline class="eq" points="' + pts + '"/></svg>';
  }

  function card(sym, r) {
    const f = r.full, o = r.oos, st = ST.byId[r.id];
    const m = function (k, v) { return '<div><span>' + k + '</span><b>' + v + '</b></div>'; };
    const last = r.trades.slice(-8).reverse().map(function (t) {
      return '<tr><td>' + App.fmtDate(t.t) + '</td><td>' + (t.dir === 1 ? 'Compra' : 'Venta') + '</td><td class="r">' + App.fmt(sym, t.entry) +
        '</td><td class="r">' + App.fmt(sym, t.exit) + '</td><td>' + t.reason + '</td><td class="r ' + (t.r > 0 ? 'buy' : 'sell') + '">' + App.sgn(t.r, 2) + '</td></tr>';
    }).join('');
    return '<div class="bt-card"><div class="bt-head"><div><div class="bt-name">' + App.esc(r.name) + '</div><div class="muted small">' + App.esc(st.desc) +
      '</div></div><span class="badge ' + r.verdict.key + '">' + BADGE[r.verdict.key] + '</span></div>' +
      '<div class="metrics">' + m('Operaciones', f.n) + m('Acierto', f.n ? pct(f.winRate) : '—') + m('Factor beneficio', f.n ? pf(f.pf) : '—') +
      m('Esperanza', f.n ? App.sgn(f.expectancy, 2) + ' R' : '—') + m('Neto', App.sgn(f.netR, 1) + ' R') + m('Caída máx.', f.maxDD.toFixed(1) + ' R') +
      m('Últ. 30% · ops', o.n) + m('Últ. 30% · F.B.', o.n ? pf(o.pf) : '—') + '</div>' +
      '<div class="muted small" style="margin-top:6px">' + App.esc(r.verdict.text) + '</div>' +
      '<details><summary>Curva y últimas operaciones</summary>' + equitySvg(f.equity) +
      '<div class="muted small">Stop ' + r.opts.slMult + '×ATR · objetivo ' + r.opts.tpMult + '×ATR · máximo ' + r.opts.maxBars + ' velas por operación</div>' +
      '<div class="scroll-x"><table class="tbl"><thead><tr><th>Entrada</th><th>Tipo</th><th class="r">Precio</th><th class="r">Salida</th><th>Motivo</th><th class="r">R</th></tr></thead><tbody>' +
      last + '</tbody></table></div></details></div>';
  }

  App.runBacktest = function () {
    const sym = state.symbol, tf = state.tf, my = ++seq, info = $('btInfo');
    info.textContent = 'Cargando ' + sym + ' ' + tf + '…';
    $('btCards').innerHTML = '';
    return App.hist(sym, tf).then(function (bars) {
      if (my !== seq) return;
      if (bars.length < 260) { info.textContent = 'Hay solo ' + bars.length + ' velas; hacen falta al menos 260 para probar las estrategias con filtro de 200 periodos.'; return; }
      const spread = state.settings.spread[sym];
      const res = B.runAll(bars, { spread: spread, slMult: state.settings.sl, tpMult: state.settings.tp });
      const rank = function (r) { return (r.verdict.key === 'small' ? -1000 : 0) + r.full.expectancy; };
      res.sort(function (a, b) { return rank(b) - rank(a); });
      const d = function (t) { return new Date(t).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
      info.textContent = sym + ' · ' + tf + ' · ' + bars.length + ' velas cerradas (' + d(bars[0].t) + ' → ' + d(bars[bars.length - 1].t) + ') · spread descontado ' + App.fmt(sym, spread) + ' por operación.';
      $('btCards').innerHTML = res.map(function (r) { return card(sym, r); }).join('');
    }, function (e) {
      if (my !== seq) return;
      if (D.isMissing(e)) { App.markMissing(sym); info.textContent = sym + ' no tiene datos en biquote.io con el nombre «' + D.feedName(sym) + '» (mira Ajustes → Datos).'; }
      else info.textContent = 'No se pudo cargar el historial (' + ((e && e.message) || 'error') + ').';
    });
  };

  App.runSweep = function () {
    const sym = state.symbol, btn = $('btSweepBtn');
    btn.disabled = true; btn.textContent = 'Calculando…';
    const tasks = D.TF_LIST.map(function (tf) { return function () { return App.hist(sym, tf); }; });
    return D.pool(tasks, 3).then(function (results) {
      const cells = {};
      ST.list.forEach(function (s) { cells[s.id] = {}; });
      results.forEach(function (r, i) {
        if (!r.ok || r.v.length < 260) return;
        B.runAll(r.v, { spread: state.settings.spread[sym], slMult: state.settings.sl, tpMult: state.settings.tp }).forEach(function (x) {
          cells[x.id][D.TF_LIST[i]] = { e: x.full.expectancy, n: x.full.n, oe: x.oos.expectancy, on: x.oos.n };
        });
      });
      let html = '<thead><tr><th>' + sym + '</th>' + D.TF_LIST.map(function (tf) { return '<th>' + tf + '</th>'; }).join('') + '</tr></thead><tbody>';
      ST.list.forEach(function (s) {
        html += '<tr><td style="text-align:left">' + App.esc(s.name.split(' (')[0]) + '</td>';
        D.TF_LIST.forEach(function (tf) {
          const c = cells[s.id][tf];
          if (!c) { html += '<td>—</td>'; return; }
          const cls = c.n < 10 ? 'zero' : (c.e >= 0.15 && c.n >= 30 ? 'pos2' : c.e > 0 ? 'pos' : c.e < 0 ? 'neg' : 'zero');
          html += '<td class="' + cls + '"' + (c.n < 30 ? ' style="opacity:.6"' : '') + '>' + App.sgn(c.e, 2) +
            '<small>n' + c.n + (c.on >= 5 ? ' · 30% ' + App.sgn(c.oe, 2) : '') + '</small></td>';
        });
        html += '</tr>';
      });
      $('btSweep').innerHTML = html + '</tbody>';
    }).then(function () { btn.disabled = false; btn.textContent = 'Calcular las 7 temporalidades'; },
            function () { btn.disabled = false; btn.textContent = 'Reintentar'; });
  };

  App.wireBacktest = function () {
    $('btRun').addEventListener('click', function () {
      delete state.hist[state.symbol + '|' + state.tf];
      App.runBacktest();
    });
    $('btSweepBtn').addEventListener('click', App.runSweep);
  };
})();
