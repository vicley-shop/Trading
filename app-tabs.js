/*
 * app-tabs.js — navegación entre pestañas, diario de operaciones y ajustes.
 */
(function () {
  'use strict';
  const AT = window.AT, App = AT.app, B = AT.backtest, ST = AT.strategies, D = AT.data;
  const state = App.state;
  const $ = function (id) { return document.getElementById(id); };

  function pct(x) { return (x * 100).toFixed(0) + '%'; }
  function pf(x) { return !isFinite(x) ? '∞' : x.toFixed(2); }
  function cls(x) { return x > 0 ? 'buy' : x < 0 ? 'sell' : ''; }
  function stName(id) { return id === 'manual' ? 'Manual' : (ST.byId[id] ? ST.byId[id].name.split(' (')[0] : id); }
  function usd(x) { return (x < 0 ? '-$' : '+$') + Math.abs(x).toFixed(2); }

  /* ---------- pestañas ---------- */

  App.setTab = function (name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
    window.scrollTo(0, 0);
    if (name === 'signals') { App.renderLive(true); App.renderMTF(); }
    else if (name === 'backtest') App.runBacktest();
    else if (name === 'journal') App.renderJournal();
    else if (name === 'settings') App.renderSettings();
  };

  App.wireTabs = function () {
    $('tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-tab]');
      if (b) App.setTab(b.dataset.tab);
    });
  };

  /* ---------- diario ---------- */

  App.buildJournalControls = function () {
    $('jStrategy').innerHTML = ST.list.map(function (s) { return '<option value="' + s.id + '">' + App.esc(s.name) + '</option>'; }).join('');
    $('jTf').innerHTML = D.TF_LIST.map(function (tf) { return '<option value="' + tf + '">' + tf + '</option>'; }).join('');
  };

  function renderOpenList() {
    const open = state.journal.openTrades(), box = $('jOpen');
    if (!open.length) { box.innerHTML = '<div class="empty">No hay operaciones abiertas.</div>'; return; }
    box.innerHTML = open.map(function (tr) {
      return '<div class="item" data-id="' + tr.id + '"><div><b>' + tr.symbol + '</b> ' + (tr.dir === 1 ? 'Compra' : 'Venta') + ' @ ' + App.fmt(tr.symbol, tr.entry) +
        '<div class="muted small">SL ' + App.fmt(tr.symbol, tr.sl) + ' · TP ' + App.fmt(tr.symbol, tr.tp) + ' · ' + tr.tf + ' · ' + App.esc(stName(tr.strategy)) + ' · ' + App.fmtDate(tr.openedAt) +
        '</div></div><div style="text-align:right"><b class="fl">—</b><br><button class="btn" data-close="' + tr.id + '">Cerrar</button></div></div>';
    }).join('');
  }

  App.renderJournalLive = function () {
    const open = state.journal.openTrades();
    if ($('jOpen').querySelectorAll('.item').length !== open.length) renderOpenList();
    open.forEach(function (tr) {
      const row = $('jOpen').querySelector('.item[data-id="' + tr.id + '"] .fl');
      if (!row) return;
      const t = state.ticks[tr.symbol], px = t ? (tr.dir === 1 ? t.bid : t.ask) : null;
      const r = px != null && tr.risk > 0 ? tr.dir * (px - tr.entry) / tr.risk : null;
      row.textContent = r == null ? '—' : App.sgn(r, 2) + ' R';
      row.className = 'fl ' + (r == null ? '' : cls(r));
    });
  };

  App.renderJournal = function () {
    const j = state.journal, s = state.settings, st = j.stats();
    $('jAuto').checked = !!s.auto; $('jStrategy').value = s.journalStrategy; $('jTf').value = s.journalTf;
    const cell = function (k, v, c) { return '<div><span>' + k + '</span><b class="' + (c || '') + '">' + v + '</b></div>'; };
    $('jStats').innerHTML = cell('Cerradas', st.n) + cell('Acierto', st.n ? pct(st.winRate) : '—') + cell('Factor beneficio', st.n ? pf(st.pf) : '—') +
      cell('Esperanza', st.n ? App.sgn(st.expectancy, 2) + ' R' : '—', cls(st.expectancy)) + cell('Neto', App.sgn(st.netR, 1) + ' R', cls(st.netR)) +
      cell('Neto en USD', usd(st.usd), cls(st.usd));
    renderOpenList(); App.renderJournalLive();

    const closed = j.all().filter(function (t) { return t.status === 'closed'; }).slice(-40).reverse();
    $('jClosed').innerHTML = closed.length
      ? '<thead><tr><th>Cierre</th><th>Activo</th><th>Tipo</th><th>Estrategia</th><th class="r">Entrada</th><th class="r">Salida</th><th>Motivo</th><th class="r">R</th><th class="r">USD</th></tr></thead><tbody>' +
        closed.map(function (t) {
          return '<tr><td>' + App.fmtDate(t.closedAt) + '</td><td>' + t.symbol + '</td><td>' + (t.dir === 1 ? 'Compra' : 'Venta') + '</td><td>' + App.esc(stName(t.strategy)) +
            '</td><td class="r">' + App.fmt(t.symbol, t.entry) + '</td><td class="r">' + App.fmt(t.symbol, t.exit) + '</td><td>' + t.reason + '</td><td class="r ' + cls(t.r) + '">' + App.sgn(t.r, 2) +
            '</td><td class="r ' + cls(t.usd) + '">' + usd(t.usd) + '</td></tr>';
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">Todavía no hay operaciones cerradas.</td></tr></tbody>';

    const groups = {};
    j.all().forEach(function (t) {
      if (t.status !== 'closed') return;
      const k = t.strategy + '|' + t.symbol;
      (groups[k] = groups[k] || []).push(t);
    });
    const keys = Object.keys(groups);
    $('jBreakdown').innerHTML = keys.length
      ? '<thead><tr><th>Estrategia</th><th>Activo</th><th class="r">Ops</th><th class="r">Acierto</th><th class="r">F.B.</th><th class="r">Esperanza</th><th class="r">Neto R</th></tr></thead><tbody>' +
        keys.map(function (k) {
          const g = B.stats(groups[k]), p = k.split('|');
          return '<tr><td>' + App.esc(stName(p[0])) + '</td><td>' + p[1] + '</td><td class="r">' + g.n + '</td><td class="r">' + pct(g.winRate) + '</td><td class="r">' + pf(g.pf) +
            '</td><td class="r ' + cls(g.expectancy) + '">' + App.sgn(g.expectancy, 2) + '</td><td class="r ' + cls(g.netR) + '">' + App.sgn(g.netR, 1) + '</td></tr>';
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">Aquí aparecerá el desglose cuando haya operaciones cerradas.</td></tr></tbody>';
  };

  // Texto pensado para pegarlo en el chat y analizar el resultado.
  App.summaryText = function () {
    const s = state.settings, st = state.journal.stats(), L = [];
    L.push('RESUMEN DEL DIARIO (operaciones en papel) — ' + new Date().toLocaleString('es'));
    L.push('Cerradas: ' + st.n + ' · acierto ' + pct(st.winRate) + ' · factor de beneficio ' + pf(st.pf) + ' · esperanza ' + App.sgn(st.expectancy, 2) + ' R · neto ' +
      App.sgn(st.netR, 1) + ' R (' + usd(st.usd) + ') · caída máx. ' + st.maxDD.toFixed(1) + ' R · abiertas ' + st.open);
    L.push('Ajustes: saldo $' + s.balance + ' · riesgo ' + s.riskPct + '% · estrategia del diario ' + stName(s.journalStrategy) + ' ' + s.journalTf +
      ' · spread XAU ' + s.spread.XAUUSD + ' / XAG ' + s.spread.XAGUSD + ' / EUR ' + s.spread.EURUSD);
    const groups = {};
    state.journal.all().forEach(function (t) {
      if (t.status === 'closed') (groups[t.strategy + ' ' + t.symbol + ' ' + t.tf] = groups[t.strategy + ' ' + t.symbol + ' ' + t.tf] || []).push(t);
    });
    Object.keys(groups).forEach(function (k) {
      const g = B.stats(groups[k]), p = k.split(' ');
      L.push('- ' + stName(p[0]) + ' · ' + p[1] + ' · ' + p[2] + ': ' + g.n + ' ops, acierto ' + pct(g.winRate) + ', F.B. ' + pf(g.pf) + ', ' + App.sgn(g.netR, 1) + ' R');
    });
    return L.join('\n');
  };

  App.wireJournal = function () {
    const J = state.journal;
    $('jAuto').addEventListener('change', function () {
      state.settings.auto = $('jAuto').checked; App.saveSettings();
      if (state.settings.auto) App.SYMS.forEach(function (s) { App.primeSeen(s, true); });
    });
    function changed() {
      state.settings.journalStrategy = $('jStrategy').value; state.settings.journalTf = $('jTf').value; App.saveSettings();
      const tf = state.settings.journalTf;
      App.SYMS.forEach(function (s) {
        if (state.bars[s][tf]) App.primeSeen(s, false);
        else App.load(s, tf, 500).catch(function () { /* el estado ya avisa */ });
      });
    }
    $('jStrategy').addEventListener('change', changed);
    $('jTf').addEventListener('change', changed);
    $('jOpen').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-close]');
      if (!b) return;
      const tr = J.openTrades().filter(function (t) { return t.id === +b.dataset.close; })[0], t = tr && state.ticks[tr.symbol];
      if (!tr || !t) { App.toast('Sin precio para cerrar todavía'); return; }
      J.closeManual(tr.id, tr.dir === 1 ? t.bid : t.ask); App.renderJournal();
    });
    $('jCopy').addEventListener('click', function () { App.copy(App.summaryText()); });
    $('jCsv').addEventListener('click', function () {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([J.toCSV()], { type: 'text/csv' }));
      a.download = 'diario-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    $('jClear').addEventListener('click', function () {
      if (!confirm('¿Borrar todo el diario? No se puede deshacer.')) return;
      J.clear(); App.SYMS.forEach(function (s) { App.primeSeen(s, true); }); App.renderJournal();
    });
  };

  /* ---------- ajustes ---------- */

  // Estado de cada activo en biquote.io: con qué nombre se pide y si llegan datos.
  App.renderSymbolStatus = function () {
    const tbl = $('sSymbols');
    if (!tbl) return;
    tbl.innerHTML = '<thead><tr><th>Activo</th><th>Nombre en biquote</th><th>Estado</th></tr></thead><tbody>' + App.SYMS.map(function (sym) {
      const t = state.ticks[sym], loaded = Object.keys(state.bars[sym]).length;
      const st = App.isMissing(sym) ? '<span class="sell">sin datos</span>'
        : t ? '<span class="buy">con datos · ' + App.fmt(sym, t.mid) + '</span>'
        : loaded ? 'velas cargadas, esperando precio' : 'cargando…';
      return '<tr><td>' + sym + '</td><td>' + App.esc(D.feedName(sym)) + '</td><td>' + st + '</td></tr>';
    }).join('') + '</tbody>';
  };

  App.renderSettings = function () {
    const s = state.settings;
    $('sBalance').value = s.balance; $('sRisk').value = s.riskPct;
    $('sSl').value = s.sl == null ? '' : s.sl; $('sTp').value = s.tp == null ? '' : s.tp;
    App.SYMS.forEach(function (sym) { $('sSpread' + sym).value = s.spread[sym]; });
    App.renderStatus(); App.renderSymbolStatus();
  };

  /* ---------- diagnóstico de la conexión ---------- */

  // Resumen legible de la forma de una respuesta JSON (lista u objeto) y su primer elemento.
  function shape(v) {
    if (Array.isArray(v)) return 'lista de ' + v.length + (v[0] && typeof v[0] === 'object' ? ' · campos: ' + Object.keys(v[0]).join(',') : '');
    if (v && typeof v === 'object') {
      const k = Object.keys(v), inner = k.filter(function (x) { return Array.isArray(v[x]); })[0];
      return 'objeto · claves: ' + k.slice(0, 12).join(',') + (inner ? ' · «' + inner + '» = ' + shape(v[inner]) : '');
    }
    return typeof v;
  }
  function firstItem(v) {
    if (Array.isArray(v)) return v[0];
    if (v && typeof v === 'object') { const k = Object.keys(v).filter(function (x) { return Array.isArray(v[x]); })[0]; return k ? v[k][0] : v; }
    return v;
  }
  function probe(path) {
    const t0 = Date.now();
    return window.fetch(D.base() + path, { cache: 'no-store' }).then(function (r) {
      return r.text().then(function (txt) {
        let j = null; try { j = JSON.parse(txt); } catch (e) { /* no era JSON */ }
        return { status: r.status, ms: Date.now() - t0, json: j, text: txt };
      });
    }, function (e) { return { error: (e && e.message) || 'error de red', ms: Date.now() - t0 }; });
  }

  // Pide a biquote.io lo mismo que usa la página y muestra qué contestó, para poder pegarlo en el chat si algo no funciona.
  App.diagnose = function (log) {
    const names = App.SYMS.map(D.feedName);
    log('DIAGNÓSTICO — ' + new Date().toLocaleString('es') + ' · ' + location.origin);
    log('SignalR cargado: ' + (window.signalR ? 'sí' : 'no') + ' · estado del feed: ' + state.feedMode + ' · nombres usados: ' +
      App.SYMS.map(function (s) { return s + '→' + D.feedName(s); }).join(', '));
    const jobs = ['/api/latest?' + names.map(function (n) { return 'symbols=' + encodeURIComponent(n); }).join('&')];
    names.forEach(function (n) { jobs.push('/api/' + encodeURIComponent(n) + '/ohlc?interval=15m&limit=3'); });
    jobs.push('/api/symbols/search?q=silver&limit=5');
    let p = Promise.resolve();
    jobs.forEach(function (path) {
      p = p.then(function () { return probe(path); }).then(function (r) {
        let s = 'GET ' + path + '\n   → ';
        if (r.error) s += 'ERROR: ' + r.error + ' (' + r.ms + ' ms)';
        else if (r.json === null) s += r.status + ' (' + r.ms + ' ms) · no es JSON: ' + r.text.slice(0, 100).replace(/\s+/g, ' ');
        else {
          const f = firstItem(r.json);
          s += r.status + ' (' + r.ms + ' ms) · ' + shape(r.json) + '\n   primer elemento: ' + (f === undefined ? '(vacío)' : JSON.stringify(f).slice(0, 280));
        }
        log(s);
      }).catch(function (e) { log('GET ' + path + '\n   → no se pudo mostrar: ' + ((e && e.message) || e)); });
    });
    return p;
  };

  App.wireSettings = function () {
    $('sDiagBtn').addEventListener('click', function () {
      const btn = $('sDiagBtn'), pre = $('sDiag'), cp = $('sDiagCopy'), lines = [];
      btn.disabled = true; cp.hidden = true; pre.hidden = false; pre.textContent = 'Probando…';
      function done() { btn.disabled = false; cp.hidden = false; }
      App.diagnose(function (s) { lines.push(s); pre.textContent = lines.join('\n'); }).then(done, done);
    });
    $('sDiagCopy').addEventListener('click', function () { App.copy($('sDiag').textContent); });
    function num(id, min, max) { const v = parseFloat($(id).value); return isFinite(v) && v >= min && v <= max ? v : null; }
    function on(id, fn) { $(id).addEventListener('change', function () { fn(); App.saveSettings(); App.renderSettings(); }); }
    on('sBalance', function () { const v = num('sBalance', 100, 1e9); if (v) state.settings.balance = v; });
    on('sRisk', function () { const v = num('sRisk', 0.1, 10); if (v) state.settings.riskPct = v; });
    on('sSl', function () { state.settings.sl = num('sSl', 0.5, 10); });
    on('sTp', function () { state.settings.tp = num('sTp', 0.5, 20); });
    App.SYMS.forEach(function (sym) {
      on('sSpread' + sym, function () { const v = num('sSpread' + sym, 0, 1e6); if (v !== null) state.settings.spread[sym] = v; });
    });
    $('sReset').addEventListener('click', function () {
      if (!confirm('¿Restablecer los ajustes a los valores iniciales?')) return;
      Object.assign(state.settings, App.defaults()); App.saveSettings(); App.renderSettings();
    });
  };
})();
