/*
 * data.js — datos de biquote.io: velas por REST y ticks en vivo (SignalR),
 * con consulta periódica como respaldo si SignalR no está disponible.
 * No necesita API key. Se configura con window.AT_CONFIG (ver js/config.js):
 *   base  — URL de la API
 *   alias — nombre propio -> nombre del símbolo en biquote (p. ej. { XAGUSD: 'XAGUSD' })
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.AT = root.AT || {}; root.AT.data = factory(root); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const G = typeof globalThis !== 'undefined' ? globalThis : root;
  const TF = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const TF_LIST = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  function base() { return (G.AT_CONFIG && G.AT_CONFIG.base) || 'https://biquote.io'; }

  // Nombre propio -> nombre en biquote (por si el feed llama distinto a un instrumento).
  function aliasMap() { return (G.AT_CONFIG && G.AT_CONFIG.alias) || {}; }
  function feedName(sym) { return aliasMap()[sym] || sym; }
  function internalName(name) {
    const up = String(name).toUpperCase(), a = aliasMap();
    for (const k in a) if (String(a[k]).toUpperCase() === up) return k;
    return up;
  }

  function getJSON(path, timeoutMs) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 15000) : null;
    const opts = ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' };
    return G.fetch(base() + path, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) {
        const e = new Error('HTTP ' + r.status);
        e.status = r.status;
        e.retryAfter = +(r.headers && r.headers.get && r.headers.get('Retry-After')) || 0;
        throw e;
      }
      return r.json();
    }, function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  // «Este símbolo no existe o no tiene datos» (distinto de una caída de red o de un límite de uso).
  function isMissing(e) { return !!e && (e.status === 404 || e.status === 400 || e.status === 410 || e.status === 422); }

  function normBar(b) {
    const t = Date.parse(b.openTime), o = +b.open, h = +b.high, l = +b.low, c = +b.close;
    if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) return null;
    return { t: t, o: o, h: h, l: l, c: c, v: +b.tickVolume || 0, live: !!b.isOpen };
  }

  // Velas de la más antigua a la más reciente (la API las manda al revés). `name` es el nombre en biquote.
  // Sin velas = el símbolo no existe o no tiene datos: error con status 404.
  function fetchRaw(name, tf, limit) {
    const path = '/api/' + encodeURIComponent(name) + '/ohlc?interval=' + tf + '&limit=' + (limit || 500);
    return getJSON(path).then(function (d) {
      const arr = Array.isArray(d) ? d : (d && d.bars) || [];
      const bars = [];
      arr.forEach(function (b) { const x = normBar(b); if (x) bars.push(x); });
      if (!bars.length) { const e = new Error('sin datos para ' + name); e.status = 404; throw e; }
      bars.sort(function (a, b) { return a.t - b.t; });
      return bars.filter(function (b, i) { return i === 0 || b.t !== bars[i - 1].t; });
    });
  }
  function fetchBars(symbol, tf, limit) { return fetchRaw(feedName(symbol), tf, limit); }

  function normTick(t) {
    if (!t || typeof t !== 'object') return null;
    const bid = +t.bid, ask = +t.ask;
    let mid = +t.mid;
    if (!isFinite(mid)) mid = (bid + ask) / 2;
    if (!isFinite(mid) || !t.symbol) return null;
    const ts = Date.parse(t.timestamp);
    return {
      symbol: internalName(t.symbol),
      bid: isFinite(bid) ? bid : mid, ask: isFinite(ask) ? ask : mid, mid: mid,
      spread: isFinite(+t.spread) ? +t.spread : (isFinite(ask - bid) ? ask - bid : 0),
      ts: isFinite(ts) ? ts : Date.now(),
      dayPct: isFinite(+t.dayDiffPercent) ? +t.dayDiffPercent : null,
      high: isFinite(+t.high) ? +t.high : null, low: isFinite(+t.low) ? +t.low : null,
      state: t.marketState || 'open', stale: !!t.stale
    };
  }

  function fetchLatest(symbols) {
    const q = symbols.map(function (s) { return 'symbols=' + encodeURIComponent(feedName(s)); }).join('&');
    return getJSON('/api/latest?' + q).then(function (d) {
      let arr;
      if (Array.isArray(d)) arr = d;
      else if (d && Array.isArray(d.ticks)) arr = d.ticks;
      else if (d && typeof d === 'object') {
        arr = Object.keys(d).map(function (k) { return d[k] && typeof d[k] === 'object' ? Object.assign({ symbol: k }, d[k]) : null; });
      } else arr = [];
      return arr.map(normTick).filter(Boolean);
    });
  }

  /* ---------- búsqueda del nombre real de un símbolo ---------- */

  // Cómo suele rotular biquote cada instrumento en la descripción («Silver vs US Dollar»).
  const HINT = {
    XAUUSD: /gold\b.{0,12}\b(us\s+)?dollar/i,
    XAGUSD: /silver\b.{0,12}\b(us\s+)?dollar/i,
    EURUSD: /euro\b.{0,12}\b(us\s+)?dollar/i
  };
  const WORD = { XAUUSD: 'gold', XAGUSD: 'silver', EURUSD: 'euro' };

  function searchCatalog(q) {
    return getJSON('/api/symbols/search?q=' + encodeURIComponent(q) + '&limit=50').then(function (d) {
      return Array.isArray(d) ? d : (d && (d.items || d.symbols || d.results)) || [];
    });
  }

  // Ordena de mejor a peor los nombres del catálogo que podrían ser `sym`.
  function rankNames(sym, items) {
    const out = [], seen = {};
    items.forEach(function (it) {
      const name = String((it && (it.name || it.symbol)) || '').trim(), up = name.toUpperCase();
      if (!name || seen[up]) return;
      seen[up] = true;
      let score = 0;
      if (up === sym) score = 100;
      else if (up.indexOf(sym) === 0 && up.length - sym.length <= 4) score = 90 - (up.length - sym.length); // XAGUSD.m, XAGUSDm, XAGUSD#
      else if (up.indexOf(sym) >= 0) score = 60;
      else if (HINT[sym] && HINT[sym].test(String(it.description || ''))) score = 50;
      if (score) out.push({ name: name, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score || a.name.length - b.name.length; });
    return out.map(function (x) { return x.name; });
  }

  // Si `sym` no responde con ese nombre, busca en el catálogo de biquote uno parecido y comprueba
  // que tenga velas. Devuelve el nombre que funciona o null; nunca lanza error.
  function discover(sym) {
    const cur = feedName(sym).toUpperCase(), qs = [sym];
    if (WORD[sym]) qs.push(WORD[sym]);
    return Promise.all(qs.map(function (q) { return searchCatalog(q).catch(function () { return []; }); })).then(function (lists) {
      const names = rankNames(sym, [].concat.apply([], lists)).filter(function (n) { return n.toUpperCase() !== cur; }).slice(0, 4);
      return names.reduce(function (p, name) {
        return p.then(function (found) {
          return found || fetchRaw(name, '1h', 5).then(function () { return name; }, function () { return null; });
        });
      }, Promise.resolve(null));
    }).catch(function () { return null; });
  }

  /* ---------- utilidades ---------- */

  // Ejecuta tareas (funciones que devuelven promesas) con un máximo de concurrencia.
  function pool(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    function worker() {
      if (next >= tasks.length) return Promise.resolve();
      const idx = next++;
      return tasks[idx]().then(function (v) { results[idx] = { ok: true, v: v }; },
                               function (e) { results[idx] = { ok: false, e: e }; }).then(worker);
    }
    const ws = [];
    for (let i = 0; i < Math.min(limit || 4, tasks.length); i++) ws.push(worker());
    return Promise.all(ws).then(function () { return results; });
  }

  // Actualiza la última vela con un precio nuevo. Devuelve 'new' si abrió una vela, 'upd' si solo la actualizó.
  function applyTick(bars, tfMs, price, ts) {
    if (!bars.length) return null;
    const last = bars[bars.length - 1];
    if (ts >= last.t + tfMs) {
      const steps = Math.floor((ts - last.t) / tfMs);
      last.live = false;
      bars.push({ t: last.t + steps * tfMs, o: price, h: price, l: price, c: price, v: 1, live: true });
      return 'new';
    }
    last.live = true;
    if (price > last.h) last.h = price;
    if (price < last.l) last.l = price;
    last.c = price;
    last.v++;
    return 'upd';
  }

  /* ---------- precios en vivo ---------- */

  // handlers: { tick(t), status(modo, error), missing(simbolo), found(simbolo), loadClient() -> Promise<boolean> }
  // modos: live | polling | reconnecting | error
  const RETRY_MS = 60000; // un símbolo que «no existe» se deja en pausa este tiempo y se vuelve a probar
  function createFeed(symbols, handlers) {
    let conn = null, pollTimer = null, mode = 'off', backoffUntil = 0, stopped = false;
    const paused = {}, reported = {};

    function active() { const now = Date.now(); return symbols.filter(function (s) { return !(paused[s] > now); }); }
    function feedList() { return active().map(feedName); }
    function setMode(m, err) { if (m !== mode || err) { mode = m; if (handlers.status) handlers.status(m, err); } }
    function give(arr) {
      arr.forEach(function (t) {
        if (reported[t.symbol]) { // volvió a responder un símbolo que se había dado por ausente
          delete reported[t.symbol]; delete paused[t.symbol];
          if (handlers.found) handlers.found(t.symbol);
        }
        if (handlers.tick) handlers.tick(t);
      });
    }
    function emit(raw) { const t = normTick(raw); if (t) give([t]); }
    function startPolling(ms) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, ms);
    }

    // Un símbolo que no existe se pausa un minuto y se avisa una sola vez; si vuelve a responder, se avisa también.
    function drop(sym) {
      const first = !reported[sym];
      paused[sym] = Date.now() + RETRY_MS; reported[sym] = true;
      if (first && handlers.missing) handlers.missing(sym);
    }

    // Si un símbolo no existe, la consulta en lote puede fallar entera: se pide uno por uno y solo se
    // pausan los que devuelvan «no existe», para que no arrastren a los demás.
    function isolate() {
      return Promise.all(active().map(function (s) {
        return fetchLatest([s]).then(function (arr) { give(arr); return { s: s, ok: true }; },
                                     function (e) { return { s: s, ok: false, miss: isMissing(e), e: e }; });
      })).then(function (r) {
        if (r.some(function (x) { return x.ok; })) {
          r.forEach(function (x) { if (x.miss) drop(x.s); });
          if (mode === 'off' || mode === 'error') setMode('polling');
        } else {
          // Ninguno responde: es más probable que falle la consulta y no cada símbolo; no se pausa nada.
          backoffUntil = Date.now() + 10000;
          if (mode !== 'live') setMode('error', (r[0] && r[0].e) || new Error('sin datos'));
        }
      });
    }

    function poll() {
      if (stopped || Date.now() < backoffUntil || !active().length) return Promise.resolve();
      return fetchLatest(active()).then(function (arr) {
        give(arr);
        if (mode === 'off' || mode === 'error') setMode('polling');
      }, function (e) {
        if (e && e.status === 429) backoffUntil = Date.now() + (e.retryAfter || 60) * 1000;
        else if (isMissing(e)) return isolate();
        if (mode !== 'live') setMode('error', e);
      });
    }

    function startSignalR() {
      if (!G.signalR || !active().length) return Promise.resolve(false);
      try {
        conn = new G.signalR.HubConnectionBuilder()
          .withUrl(base() + '/hubs/tick', { withCredentials: false })
          .withAutomaticReconnect().build();
        conn.on('ReceiveTick', emit);
        conn.onreconnecting(function () { setMode('reconnecting'); startPolling(2000); });
        conn.onreconnected(function () {
          conn.invoke('Subscribe', feedList()).then(function () { setMode('live'); startPolling(20000); });
        });
        conn.onclose(function () { if (!stopped) { setMode('polling'); startPolling(2000); } });
        return conn.start().then(function () { return conn.invoke('Subscribe', feedList()); })
          .then(function () { setMode('live'); return true; },
                function () { try { conn.stop(); } catch (e) { /* ya cerrada */ } conn = null; return false; });
      } catch (e) { conn = null; return Promise.resolve(false); }
    }

    return {
      start: function () {
        stopped = false;
        const client = handlers.loadClient ? handlers.loadClient().catch(function () { return false; }) : Promise.resolve(true);
        // Los precios llegan por consulta desde el primer momento (cada 2 s); si SignalR conecta, se baja a un respaldo cada 20 s.
        const first = poll().then(function () { if (!pollTimer) startPolling(2000); });
        return Promise.all([first, client]).then(function () { return startSignalR(); })
          .then(function (ok) { if (ok) startPolling(20000); });
      },
      stop: function () {
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        if (conn) conn.stop();
      },
      mode: function () { return mode; },
      missing: function () { return Object.keys(reported); },
      // Tras encontrar el nombre correcto de un símbolo: lo reactiva y vuelve a suscribir la lista en el hub.
      resubscribe: function (sym) {
        delete paused[sym]; delete reported[sym];
        if (conn && mode === 'live') conn.invoke('Subscribe', feedList()).catch(function () { /* lo cubre la consulta periódica */ });
      }
    };
  }

  return {
    TF: TF, TF_LIST: TF_LIST, base: base, feedName: feedName, internalName: internalName, isMissing: isMissing,
    fetchBars: fetchBars, fetchLatest: fetchLatest, normTick: normTick, normBar: normBar,
    rankNames: rankNames, discover: discover, pool: pool, applyTick: applyTick, createFeed: createFeed
  };
}));
