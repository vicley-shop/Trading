/*
 * app-core.js — estado de la aplicación, carga de datos, ticks, análisis,
 * plan de operación y registro automático de señales en el diario.
 */
(function () {
  'use strict';
  const AT = window.AT, S = AT.signals, ST = AT.strategies, B = AT.backtest, D = AT.data, J = AT.journal;
  const App = AT.app = {};
  const SYMS = Object.keys(B.SYMBOLS);
  const SETTINGS_KEY = 'at.settings.v1';

  const DEFAULTS = { balance: 10000, riskPct: 1, sl: null, tp: null, spread: {}, auto: true, journalTf: '15m', journalStrategy: 'consenso' };
  SYMS.forEach(function (s) { DEFAULTS.spread[s] = B.SYMBOLS[s].spread; });

  function pickStorage() {
    try { const s = window.localStorage; s.setItem('__at', '1'); s.removeItem('__at'); return s; }
    catch (e) { return J.memoryStorage(); }
  }
  const store = pickStorage();

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(store.getItem(SETTINGS_KEY)) || {}; } catch (e) { s = {}; }
    const out = Object.assign({}, DEFAULTS, s);
    out.spread = Object.assign({}, DEFAULTS.spread, s.spread || {});
    if (!ST.byId[out.journalStrategy]) out.journalStrategy = DEFAULTS.journalStrategy;
    if (!D.TF[out.journalTf]) out.journalTf = DEFAULTS.journalTf;
    return out;
  }

  // Nombres que la búsqueda automática encontró en biquote, guardados para la próxima visita.
  // Lo que se ponga a mano en js/config.js manda sobre lo guardado.
  const ALIAS_KEY = 'at.alias.v1';
  const cfg = window.AT_CONFIG = window.AT_CONFIG || {};
  cfg.alias = cfg.alias || {};
  let savedAlias = {};
  try { savedAlias = JSON.parse(store.getItem(ALIAS_KEY)) || {}; } catch (e) { savedAlias = {}; }
  SYMS.forEach(function (s) {
    if ((!cfg.alias[s] || cfg.alias[s] === s) && typeof savedAlias[s] === 'string' && savedAlias[s]) cfg.alias[s] = savedAlias[s];
  });

  const state = App.state = {
    symbol: 'XAUUSD', tf: '15m', tab: 'signals', planDir: 0,
    bars: {}, ticks: {}, loading: {}, fetchedAt: {}, aCache: {}, hist: {}, feedMode: 'off', lastError: null,
    unavailable: {}, discoverTried: {}, discoverFailed: {}, missingAt: {},
    settings: loadSettings(), journal: J.create(store)
  };
  SYMS.forEach(function (s) { state.bars[s] = {}; });

  App.SYMS = SYMS;
  App.defaults = function () { return JSON.parse(JSON.stringify(DEFAULTS)); };
  App.saveSettings = function () { try { store.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* sin almacenamiento */ } };
  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  App.fmt = function (sym, p) { return p == null || !isFinite(p) ? '—' : p.toFixed(B.SYMBOLS[sym].digits); };
  App.sgn = function (x, d) { return (x >= 0 ? '+' : '') + x.toFixed(d); };
  App.fmtDate = function (ms) {
    return new Date(ms).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  };
  App.toast = function (msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show';
    clearTimeout(App._tt); App._tt = setTimeout(function () { el.className = ''; }, 4500);
  };

  /* ---------- datos ---------- */

  App.load = function (sym, tf, limit) {
    const key = sym + '|' + tf;
    if (state.loading[key]) return state.loading[key];
    const p = D.fetchBars(sym, tf, limit || 500).then(function (bars) {
      state.bars[sym][tf] = bars; state.fetchedAt[key] = Date.now(); state.loading[key] = null;
      delete state.unavailable[sym];
      App.onBarsLoaded(sym, tf);
      return bars;
    }, function (e) {
      state.loading[key] = null;
      if (D.isMissing(e)) { state.missingAt[sym] = Date.now(); App.markMissing(sym); } else state.lastError = e;
      if (App.renderStatus) App.renderStatus();
      throw e;
    });
    state.loading[key] = p;
    return p;
  };

  App.loadSymbol = function (sym) {
    // Si biquote dice que el símbolo no existe no tiene sentido pedir además las otras 6 temporalidades.
    return App.load(sym, state.tf, 500).then(function () { return true; }, function (e) { return !D.isMissing(e); }).then(function (go) {
      if (!go) return null;
      const rest = D.TF_LIST.filter(function (tf) { return tf !== state.tf && !state.bars[sym][tf]; })
        .map(function (tf) { return function () { return App.load(sym, tf, 500); }; });
      return D.pool(rest, 2);
    });
  };

  /* ---------- símbolos que biquote no devuelve ---------- */

  App.isMissing = function (sym) { return !!state.unavailable[sym]; };

  // biquote no tiene datos con ese nombre: se deja de pedir, se busca el nombre correcto
  // (una sola vez por visita) y se avisa. Si lo encuentra, lo recuerda para la próxima vez.
  App.markMissing = function (sym) {
    if (state.unavailable[sym]) return;
    state.unavailable[sym] = true;
    if (App.renderStatus) App.renderStatus();
    if (App.renderSymbolStatus) App.renderSymbolStatus();
    App.scheduleRender();
    if (state.discoverTried[sym]) return;
    state.discoverTried[sym] = true;
    D.discover(sym).then(function (name) {
      if (!name) {
        state.discoverFailed[sym] = true;
        App.toast(sym + ': biquote.io no devuelve datos con ese nombre. Mira Ajustes → Datos.');
        App.scheduleRender();
        return;
      }
      cfg.alias[sym] = name; savedAlias[sym] = name;
      try { store.setItem(ALIAS_KEY, JSON.stringify(savedAlias)); } catch (e) { /* sin almacenamiento */ }
      delete state.unavailable[sym];
      if (App.feed) App.feed.resubscribe(sym);
      App.toast(sym + ' en biquote.io se llama «' + name + '». Cargando…');
      const again = sym === state.symbol ? App.loadSymbol(sym) : App.load(sym, state.settings.journalTf, 500);
      again.then(function () { App.renderLive(true); App.renderMTF(); }, function () { /* ya se informa */ });
    });
  };

  // Volvieron a llegar precios de un activo que se daba por ausente: se recuperan sus velas si faltan.
  App.markFound = function (sym) {
    if (!state.unavailable[sym]) return;
    delete state.unavailable[sym];
    if (App.renderStatus) App.renderStatus();
    if (App.renderSymbolStatus) App.renderSymbolStatus();
    if (!state.bars[sym][state.tf] && !state.loading[sym + '|' + state.tf]) {
      (sym === state.symbol ? App.loadSymbol(sym) : App.load(sym, state.settings.journalTf, 500))
        .then(function () { App.renderLive(true); App.renderMTF(); }, function () { /* ya se informa */ });
    }
    App.scheduleRender();
  };

  // Velas sin la abierta, para el backtest. Se guardan 5 minutos.
  App.hist = function (sym, tf) {
    const key = sym + '|' + tf, c = state.hist[key];
    if (c && Date.now() - c.at < 300000) return Promise.resolve(c.bars);
    return D.fetchBars(sym, tf, 1000).then(function (bars) {
      if (bars.length && bars[bars.length - 1].live) bars = bars.slice(0, -1);
      state.hist[key] = { at: Date.now(), bars: bars };
      return bars;
    });
  };

  App.refresh = function (all) {
    const tasks = [];
    D.TF_LIST.forEach(function (tf) {
      const key = state.symbol + '|' + tf;
      if (state.bars[state.symbol][tf] && (all || tf === state.tf || Date.now() - (state.fetchedAt[key] || 0) > 300000)) {
        tasks.push(function () { return App.load(state.symbol, tf, 500); });
      }
    });
    SYMS.forEach(function (s) {
      if (s === state.symbol) return;
      // Un activo sin datos se vuelve a probar cada 5 minutos, no cada minuto.
      if (App.isMissing(s) && Date.now() - (state.missingAt[s] || 0) < 300000) return;
      tasks.push(function () { return App.load(s, state.settings.journalTf, 500); });
    });
    return D.pool(tasks, 3).then(function () { SYMS.forEach(App.checkAuto); });
  };

  App.analysis = function (sym, tf) {
    const key = sym + '|' + tf, c = state.aCache[key], now = Date.now();
    if (c && now - c.at < 700) return c.v;
    const bars = state.bars[sym][tf];
    const v = bars && bars.length >= 60 ? S.analyze(bars) : null;
    state.aCache[key] = { at: now, v: v };
    return v;
  };

  App.onBarsLoaded = function (sym, tf) {
    if (tf === state.settings.journalTf) App.primeSeen(sym, false);
    if (sym === state.symbol && App.scheduleRender) App.scheduleRender();
  };

  /* ---------- ticks ---------- */

  App.onTick = function (t) {
    const per = state.bars[t.symbol];
    if (!per) return;
    state.ticks[t.symbol] = t;
    if (t.state === 'closed' || t.stale) { App.scheduleRender(); return; } // mercado cerrado: no mover velas ni operaciones
    let newJournalBar = false;
    Object.keys(per).forEach(function (tf) {
      const bars = per[tf];
      if (!bars || !bars.length) return;
      const r = D.applyTick(bars, D.TF[tf], t.mid, t.ts);
      if (r === 'new' && tf === state.settings.journalTf) newJournalBar = true;
    });
    const closed = state.journal.onTick(t);
    if (closed.length) App.onJournalClosed(closed);
    if (newJournalBar) App.checkAuto(t.symbol);
    App.scheduleRender();
  };

  App.onJournalClosed = function (trades) {
    trades.forEach(function (tr) {
      App.toast(tr.symbol + ' ' + (tr.reason === 'tp' ? 'objetivo' : tr.reason === 'sl' ? 'stop' : 'cierre') + ': ' + App.sgn(tr.r, 2) + ' R');
    });
    if (state.tab === 'journal' && App.renderJournal) App.renderJournal();
  };

  let renderTimer = 0, lastRender = 0;
  App.scheduleRender = function () {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = 0; lastRender = Date.now();
      if (App.renderLive) App.renderLive();
    }, Math.max(0, 400 - (Date.now() - lastRender)));
  };

  /* ---------- plan de operación ---------- */

  App.planFor = function (sym, tf, dirOverride) {
    const a = App.analysis(sym, tf), s = state.settings;
    if (!a || a.atr == null) return null;
    const dir = dirOverride || a.label.dir;
    if (!dir) return { neutral: true, a: a };
    const tick = state.ticks[sym];
    const entry = tick ? (dir === 1 ? tick.ask : tick.bid) : a.price;
    const p = B.plan(dir, entry, a.atr, {
      slMult: s.sl || 1.5, tpMult: s.tp || 2.5, balance: s.balance, riskPct: s.riskPct, contract: B.SYMBOLS[sym].contract
    });
    p.symbol = sym; p.tf = tf; p.a = a;
    return p;
  };

  /* ---------- registro automático ---------- */

  function seenKey(sym) { return sym + '|' + state.settings.journalTf + '|' + state.settings.journalStrategy; }

  // Marca la última vela cerrada como ya revisada para no operar señales viejas.
  App.primeSeen = function (sym, force) {
    const bars = state.bars[sym][state.settings.journalTf];
    if (!bars || bars.length < 2) return;
    if (!force && state.journal.seen(seenKey(sym)) !== undefined) return;
    state.journal.markSeen(seenKey(sym), bars[bars.length - 2].t);
  };

  App.checkAuto = function (sym) {
    const s = state.settings;
    if (!s.auto) return;
    const bars = state.bars[sym][s.journalTf];
    if (!bars) return;
    const sig = J.checkSignal(bars, s.journalStrategy, state.journal.seen(seenKey(sym)));
    if (!sig) return;
    state.journal.markSeen(seenKey(sym), sig.barT);
    if (sig.dir === 0 || state.journal.openTrades(sym).length) return;
    const tfMs = D.TF[s.journalTf];
    if (Date.now() - (sig.barT + tfMs) > 2 * tfMs + 30000) return; // señal vieja (página reabierta tarde)
    const st = ST.byId[s.journalStrategy], tick = state.ticks[sym];
    const entry = tick ? (sig.dir === 1 ? tick.ask : tick.bid) : sig.price;
    const p = B.plan(sig.dir, entry, sig.atr, {
      slMult: s.sl || st.sl, tpMult: s.tp || st.tp, balance: s.balance, riskPct: s.riskPct, contract: B.SYMBOLS[sym].contract
    });
    state.journal.open({ symbol: sym, tf: s.journalTf, strategy: s.journalStrategy, dir: sig.dir, entry: p.entry, sl: p.sl, tp: p.tp, lots: p.lots, source: 'auto', note: st.name });
    App.toast('Nueva señal: ' + (sig.dir === 1 ? 'COMPRA ' : 'VENTA ') + sym + ' @ ' + App.fmt(sym, p.entry));
    if (state.tab === 'journal' && App.renderJournal) App.renderJournal();
  };
})();
