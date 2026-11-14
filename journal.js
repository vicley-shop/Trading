/*
 * journal.js — diario de operaciones en papel (demo). Se guarda en el navegador
 * (localStorage). Las operaciones se cierran solas al tocar stop u objetivo
 * con los ticks en vivo, y solo mientras la página está abierta.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategies.js'), require('./backtest.js'));
  else { root.AT = root.AT || {}; root.AT.journal = factory(root.AT.strategies, root.AT.backtest); }
}(typeof self !== 'undefined' ? self : this, function (ST, B) {
  'use strict';

  const KEY = 'at.journal.v1';

  function memoryStorage() {
    const m = {};
    return {
      getItem: function (k) { return k in m ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function contractOf(symbol) { return B.SYMBOLS[symbol] ? B.SYMBOLS[symbol].contract : 1; }

  // Señal de una estrategia en la última vela CERRADA (la última del array es la vela abierta).
  // Devuelve null si no hay señal nueva respecto a lastSeenT (marca de tiempo de la vela ya revisada).
  function checkSignal(bars, strategyId, lastSeenT) {
    const closed = bars.slice(0, -1);
    if (closed.length < 60) return null;
    const i = closed.length - 1, last = closed[i];
    if (lastSeenT != null && last.t <= lastSeenT) return null;
    const ind = ST.prepare(closed), sig = ST.byId[strategyId].run(ind);
    if (sig[i] === 0 || ind.atr[i] == null) return { dir: 0, barT: last.t };
    return { dir: sig[i], barT: last.t, atr: ind.atr[i], price: last.c };
  }

  function create(storage) {
    storage = storage || memoryStorage();

    function load() {
      try {
        const raw = storage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && Array.isArray(s.trades)) return { trades: s.trades, nextId: s.nextId || s.trades.length + 1, seen: s.seen || {} };
        }
      } catch (e) { /* datos corruptos: se empieza de cero */ }
      return { trades: [], nextId: 1, seen: {} };
    }
    let state = load();
    function save() { try { storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ } }

    function finish(tr, exit, reason, ts) {
      tr.status = 'closed'; tr.exit = exit; tr.reason = reason; tr.closedAt = ts || Date.now();
      tr.pnl = tr.dir * (exit - tr.entry);
      tr.r = tr.risk > 0 ? tr.pnl / tr.risk : 0;
      tr.usd = tr.pnl * contractOf(tr.symbol) * (tr.lots || 0);
    }

    return {
      all: function () { return state.trades; },
      openTrades: function (symbol) {
        return state.trades.filter(function (t) { return t.status === 'open' && (!symbol || t.symbol === symbol); });
      },
      open: function (o) {
        const tr = {
          id: state.nextId++, symbol: o.symbol, tf: o.tf, strategy: o.strategy || 'manual', dir: o.dir,
          openedAt: o.openedAt || Date.now(), entry: o.entry, sl: o.sl, tp: o.tp, lots: o.lots || 0,
          risk: Math.abs(o.entry - o.sl), status: 'open', source: o.source || 'auto', note: o.note || ''
        };
        state.trades.push(tr); save();
        return tr;
      },
      // Cierra por stop/objetivo con un tick nuevo. Devuelve las operaciones cerradas.
      onTick: function (t) {
        const closed = [];
        state.trades.forEach(function (tr) {
          if (tr.status !== 'open' || tr.symbol !== t.symbol) return;
          const px = tr.dir === 1 ? t.bid : t.ask;
          if (!isFinite(px)) return;
          if (tr.dir === 1) {
            if (px <= tr.sl) finish(tr, px, 'sl', t.ts);
            else if (px >= tr.tp) finish(tr, tr.tp, 'tp', t.ts);
          } else {
            if (px >= tr.sl) finish(tr, px, 'sl', t.ts);
            else if (px <= tr.tp) finish(tr, tr.tp, 'tp', t.ts);
          }
          if (tr.status === 'closed') closed.push(tr);
        });
        if (closed.length) save();
        return closed;
      },
      closeManual: function (id, price) {
        const tr = state.trades.filter(function (t) { return t.id === id && t.status === 'open'; })[0];
        if (!tr) return null;
        finish(tr, price, 'manual'); save();
        return tr;
      },
      seen: function (key) { return state.seen[key]; },
      markSeen: function (key, t) { state.seen[key] = t; save(); },
      stats: function (filter) {
        const closed = state.trades.filter(function (t) { return t.status === 'closed' && (!filter || filter(t)); });
        const s = B.stats(closed);
        s.usd = closed.reduce(function (a, t) { return a + (t.usd || 0); }, 0);
        s.open = state.trades.filter(function (t) { return t.status === 'open' && (!filter || filter(t)); }).length;
        return s;
      },
      clear: function () { state = { trades: [], nextId: 1, seen: {} }; save(); },
      toCSV: function () {
        const head = 'id,apertura,cierre,simbolo,tf,estrategia,direccion,entrada,sl,tp,lotes,salida,motivo,pnl_precio,R,usd,origen,nota';
        const q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
        const iso = function (ms) { return ms ? new Date(ms).toISOString() : ''; };
        const rows = state.trades.map(function (t) {
          return [t.id, iso(t.openedAt), iso(t.closedAt), t.symbol, t.tf, t.strategy, t.dir === 1 ? 'compra' : 'venta',
                  t.entry, t.sl, t.tp, t.lots, t.exit == null ? '' : t.exit, t.reason || '',
                  t.pnl == null ? '' : t.pnl, t.r == null ? '' : t.r.toFixed(3), t.usd == null ? '' : t.usd.toFixed(2),
                  t.source, q(t.note)].join(',');
        });
        return [head].concat(rows).join('\n');
      }
    };
  }

  return { create: create, checkSignal: checkSignal, memoryStorage: memoryStorage };
}));
