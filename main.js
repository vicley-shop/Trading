/*
 * main.js — arranque: construye la interfaz, conecta los datos en vivo y
 * programa las actualizaciones periódicas.
 */
(function () {
  'use strict';
  const AT = window.AT, App = AT.app, D = AT.data, state = App.state;

  // El cliente de SignalR se descarga aparte: si el CDN falla o tarda, la página no se queda esperando
  // y usa la consulta periódica, que da los mismos precios con algo más de retardo.
  function loadSignalR() {
    return new Promise(function (resolve) {
      if (window.signalR) { resolve(true); return; }
      const url = window.AT_CONFIG && window.AT_CONFIG.signalrUrl;
      if (!url) { resolve(false); return; }
      let done = false;
      function finish(ok) { if (!done) { done = true; resolve(ok); } }
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { finish(!!window.signalR); };
      s.onerror = function () { finish(false); };
      setTimeout(function () { finish(false); }, 6000);
      document.head.appendChild(s);
    });
  }

  function init() {
    App.buildSymbolBar(); App.buildTfBar(); App.initChart(); App.buildJournalControls();
    App.wireSignals(); App.wireBacktest(); App.wireTabs(); App.wireJournal(); App.wireSettings();
    App.renderTop(); App.renderStatus(); App.renderGauge(null); App.renderMTF(); App.renderSettings();

    App.feed = D.createFeed(App.SYMS, {
      tick: App.onTick,
      status: function (mode, err) { state.feedMode = mode; if (err) state.lastError = err; App.renderStatus(); },
      missing: function (sym) { App.markMissing(sym); },
      found: function (sym) { App.markFound(sym); },
      loadClient: loadSignalR
    });
    App.feed.start().catch(function () { state.feedMode = 'error'; App.renderStatus(); });

    App.loadSymbol(state.symbol).then(function () { App.renderLive(true); App.renderMTF(); });
    App.SYMS.forEach(function (s) {
      if (s !== state.symbol) App.load(s, state.settings.journalTf, 500).catch(function () { /* el estado ya avisa */ });
    });

    setInterval(function () { if (state.tab === 'signals') App.renderMTF(); }, 5000);
    setInterval(function () { App.refresh(false); }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { App.refresh(false); App.scheduleRender(); }
    });
    window.addEventListener('resize', function () { App.scheduleRender(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
