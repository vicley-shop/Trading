/*
 * chart.js — gráfico de velas en <canvas> con EMA 20/50/200, líneas de precio
 * (entrada, stop, objetivo, precio actual), arrastre para desplazar, rueda o
 * botones para hacer zoom y cruz de lectura al pasar el puntero.
 * Los colores se leen de variables CSS (--up, --down, --grid, --muted, --ema1..3).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./indicators.js'));
  else { root.AT = root.AT || {}; root.AT.chart = factory(root.AT.indicators); }
}(typeof self !== 'undefined' ? self : this, function (I) {
  'use strict';

  const PAD = { l: 6, r: 62, t: 8, b: 20 };

  function create(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const st = { bars: [], count: 90, offset: 0, lines: [], ema: [], tf: '', digits: 2, px: null, py: null, drag: null, raf: 0 };

    function range() {
      const n = st.bars.length, count = Math.min(st.count, n), end = n - st.offset;
      return { start: Math.max(0, end - count), end: end, count: Math.max(1, Math.min(count, end)) };
    }
    function clampOffset() {
      const n = st.bars.length;
      st.offset = Math.max(0, Math.min(st.offset, Math.max(0, n - Math.min(st.count, n))));
    }
    function fmtTime(t) {
      const d = new Date(t);
      if (st.tf === '1d') return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' });
      if (st.tf === '4h') return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + String(d.getHours()).padStart(2, '0') + 'h';
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function schedule() {
      if (st.raf) return;
      const run = function () { st.raf = 0; draw(); };
      st.raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(run) : setTimeout(run, 0);
    }

    function setData(bars, o) {
      st.bars = bars;
      if (o && o.tf) st.tf = o.tf;
      if (o && o.digits != null) st.digits = o.digits;
      const c = bars.map(function (b) { return b.c; });
      st.ema = [
        { arr: I.ema(c, 20), css: '--ema1', def: '#f5a623' },
        { arr: I.ema(c, 50), css: '--ema2', def: '#4aa3ff' },
        { arr: I.ema(c, 200), css: '--ema3', def: '#b57bff' }
      ];
      clampOffset();
      schedule();
    }
    function setLines(lines) { st.lines = lines || []; schedule(); }
    function zoom(f) { st.count = Math.max(20, Math.min(400, Math.round(st.count * f))); clampOffset(); schedule(); }
    function reset() { st.count = 90; st.offset = 0; schedule(); }

    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!st.bars.length) return;

      const cs = getComputedStyle(canvas);
      const col = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
      const up = col('--up', '#26a69a'), dn = col('--down', '#ef5350');
      const grid = col('--grid', 'rgba(128,128,128,.18)'), muted = col('--muted', '#8b93a1');
      const r = range(), vis = st.bars.slice(r.start, r.end);
      const plotW = w - PAD.l - PAD.r, plotH = h - PAD.t - PAD.b, step = plotW / r.count;

      let lo = Infinity, hi = -Infinity;
      vis.forEach(function (b) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
      st.lines.forEach(function (L) { if (L.price != null && L.range) { lo = Math.min(lo, L.price); hi = Math.max(hi, L.price); } });
      const pad = (hi - lo) * 0.06 || 1;
      lo -= pad; hi += pad;
      const y = function (p) { return PAD.t + (hi - p) / (hi - lo) * plotH; };
      const x = function (i) { return PAD.l + (i - r.start + 0.5) * step; };
      const fmt = function (p) { return p.toFixed(st.digits); };

      ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      ctx.strokeStyle = grid; ctx.fillStyle = muted;
      for (let k = 0; k <= 4; k++) {
        const p = lo + (hi - lo) * k / 4, yy = Math.round(y(p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillText(fmt(p), PAD.l + plotW + 4, yy);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (let j = 0; j < 4; j++) {
        const i = r.start + Math.floor(j * (r.count - 1) / 3);
        if (st.bars[i]) ctx.fillText(fmtTime(st.bars[i].t), Math.min(Math.max(x(i), 24), PAD.l + plotW - 24), h - 5);
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW, plotH); ctx.clip();
      const bodyW = Math.max(1, step * 0.68);
      for (let i = r.start; i < r.end; i++) {
        const b = st.bars[i], color = b.c >= b.o ? up : dn, xx = x(i);
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(xx, y(b.h)); ctx.lineTo(xx, y(b.l)); ctx.stroke();
        const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
        ctx.fillRect(xx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
      }
      st.ema.forEach(function (e) {
        ctx.strokeStyle = col(e.css, e.def); ctx.lineWidth = 1.3; ctx.beginPath();
        let started = false;
        for (let i = r.start; i < r.end; i++) {
          if (e.arr[i] == null) continue;
          if (!started) { ctx.moveTo(x(i), y(e.arr[i])); started = true; } else ctx.lineTo(x(i), y(e.arr[i]));
        }
        ctx.stroke();
      });
      ctx.restore();

      ctx.lineWidth = 1;
      st.lines.forEach(function (L) {
        if (L.price == null) return;
        const yy = y(L.price);
        if (yy < PAD.t - 2 || yy > PAD.t + plotH + 2) return;
        ctx.strokeStyle = L.color; ctx.setLineDash(L.dash ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(PAD.l + plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = L.color; ctx.fillRect(PAD.l + plotW + 1, yy - 8, PAD.r - 2, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText((L.label ? L.label + ' ' : '') + fmt(L.price), PAD.l + plotW + 3, yy);
      });

      if (st.px != null && st.px >= PAD.l && st.px <= PAD.l + plotW && st.py >= PAD.t && st.py <= PAD.t + plotH) {
        ctx.strokeStyle = muted; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(st.px, PAD.t); ctx.lineTo(st.px, PAD.t + plotH);
        ctx.moveTo(PAD.l, st.py); ctx.lineTo(PAD.l + plotW, st.py); ctx.stroke(); ctx.setLineDash([]);
        const p = hi - (st.py - PAD.t) / plotH * (hi - lo);
        ctx.fillStyle = muted; ctx.fillRect(PAD.l + plotW + 1, st.py - 8, PAD.r - 2, 16);
        ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(p), PAD.l + plotW + 3, st.py);
      }
    }

    function indexAt(px) {
      const r = range(), step = (canvas.clientWidth - PAD.l - PAD.r) / r.count;
      const i = r.start + Math.floor((px - PAD.l) / step);
      return i >= r.start && i < r.end ? i : -1;
    }
    function local(e) { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }

    canvas.addEventListener('pointerdown', function (e) {
      const p = local(e);
      st.drag = { x: p.x, offset: st.offset, moved: false };
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ } }
    });
    canvas.addEventListener('pointermove', function (e) {
      const p = local(e);
      if (st.drag) {
        const step = (canvas.clientWidth - PAD.l - PAD.r) / range().count;
        const moved = Math.round((p.x - st.drag.x) / step);
        if (Math.abs(p.x - st.drag.x) > 4) st.drag.moved = true;
        st.offset = st.drag.offset + moved; clampOffset();
      } else if (e.pointerType === 'mouse') {
        st.px = p.x; st.py = p.y;
        if (opts.onHover) opts.onHover(st.bars[indexAt(p.x)] || null);
      }
      schedule();
    });
    function endDrag() { st.drag = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', function () {
      st.px = st.py = null; if (opts.onHover) opts.onHover(null); schedule();
    });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 0.87); }, { passive: false });
    canvas.addEventListener('dblclick', reset);

    return { setData: setData, setLines: setLines, zoom: zoom, reset: reset, draw: draw, state: st };
  }

  return { create: create };
}));
