// Live sinusoidal-PWM oscilloscope for the homepage hero. No dependencies.
//
// A single-phase full bridge is switched by comparing a sine reference with a triangle carrier
// (bipolar or unipolar SPWM). The bridge voltage drives an LC low-pass filter with a resistive load,
// simulated with an exact zero-order-hold discretisation. Everything is per unit of the DC bus.
(() => {
  'use strict';

  const canvas = document.getElementById('scope-canvas');
  const figure = canvas && canvas.closest('.scope');
  if (!figure || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas'); // static traces, redrawn only on change
  const lctx = layer.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    ma: $('ma'), mf: $('mf'), maOut: $('ma-out'), mfOut: $('mf-out'), run: $('scope-run'),
    fsw: $('ro-fsw'), v1: $('ro-v1'), thd: $('ro-thd'), tdiv: $('ro-tdiv'), flag: $('ro-flag'), live: $('scope-live'),
  };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  // ---- Simulation ---------------------------------------------------------------------------

  const F1 = 50;          // fundamental, Hz
  const FN = 300;         // LC filter natural frequency, Hz
  const ZETA = 0.5;       // LC filter damping ratio (set by the load resistance)
  const N = 3600;         // samples per fundamental period
  const WARM = 3;         // periods simulated before recording, to reach steady state
  const CYCLES = 2;       // periods recorded

  // x' = A x + B u with x = [i_L, v_o], L = 1, C = 1/wn^2, R = wn/(2 zeta):
  // A = [[0, -1], [wn^2, -2 zeta wn]], B = [1, 0].  Phi = e^(A dt), Gam = int_0^dt e^(A s) ds B.
  const [P00, P01, P10, P11, G0, G1] = (() => {
    const wn = 2 * Math.PI * FN;
    const dt = 1 / (F1 * N);
    const a = [0, -dt, wn * wn * dt, -2 * ZETA * wn * dt]; // A dt, row-major
    const mul = (x, y) => [x[0] * y[0] + x[1] * y[2], x[0] * y[1] + x[1] * y[3],
      x[2] * y[0] + x[3] * y[2], x[2] * y[1] + x[3] * y[3]];
    let term = [1, 0, 0, 1];
    const phi = [1, 0, 0, 1];
    const gam = [1, 0, 0, 1]; // series for int e^(A s) ds / dt
    for (let k = 1; k < 14; k++) {
      term = mul(term, a).map((v) => v / k);       // (A dt)^k / k!
      for (let j = 0; j < 4; j++) { phi[j] += term[j]; gam[j] += term[j] / (k + 1); }
    }
    return [phi[0], phi[1], phi[2], phi[3], gam[0] * dt, gam[2] * dt];
  })();

  const len = CYCLES * N;
  const trace = { ref: new Float32Array(len), car: new Float32Array(len), sw: new Int8Array(len), out: new Float32Array(len) };
  const result = { v1: 0, thd: 0, phase: 0 };

  function simulate(ma, mf, unipolar) {
    let i = 0;
    let v = 0;
    const total = (WARM + CYCLES) * N;
    for (let n = 0; n < total; n++) {
      const t = (n + 0.5) / N;                         // time in fundamental periods
      const u = (mf * t) % 1;
      const c = 4 * Math.abs(u - 0.5) - 1;             // triangle carrier, +-1
      const r = ma * Math.sin(2 * Math.PI * t);        // sine reference
      const s = unipolar ? (r > c) - (-r > c) : (r > c ? 1 : -1);
      const i2 = P00 * i + P01 * v + G0 * s;
      v = P10 * i + P11 * v + G1 * s;
      i = i2;
      const k = n - WARM * N;
      if (k >= 0) { trace.ref[k] = r; trace.car[k] = c; trace.sw[k] = s; trace.out[k] = v; }
    }
    // Fundamental and THD of the filtered output over the last full period.
    const base = (CYCLES - 1) * N;
    let mean = 0;
    for (let k = 0; k < N; k++) mean += trace.out[base + k];
    mean /= N;
    let a1 = 0, b1 = 0, rms2 = 0;
    for (let k = 0; k < N; k++) {
      const x = trace.out[base + k] - mean;
      const th = 2 * Math.PI * (k + 0.5) / N;
      a1 += x * Math.cos(th);
      b1 += x * Math.sin(th);
      rms2 += x * x;
    }
    a1 *= 2 / N; b1 *= 2 / N; rms2 /= N;
    result.v1 = Math.hypot(a1, b1);
    result.thd = Math.sqrt(Math.max(0, rms2 - result.v1 * result.v1 / 2)) / (result.v1 / Math.SQRT2);
  }

  // ---- Drawing ------------------------------------------------------------------------------

  let W = 0, H = 0, dpr = 1, shown = len, geo = null, colors = null;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name) => cs.getPropertyValue(name).trim();
    // The screen is dark in both themes, so the trace glow is always on.
    return {
      screen: get('--scope-screen'), grid: get('--scope-grid'), major: get('--scope-major'),
      muted: get('--scope-muted'), ch1: get('--ch1'), ch2: get('--ch2'), ch3: get('--ch3'), glow: true,
    };
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(rect.width);
    H = Math.round(rect.height);
    for (const c of [canvas, layer]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    shown = W < 460 ? N : len;                         // one period on narrow screens, two otherwise
    const left = 30, right = 12, top = 34, bottom = 12; // top leaves room for the legend
    const pw = W - left - right, ph = H - top - bottom;
    const band = ph / 3;
    geo = {
      left, top, pw, ph, band,
      x: (k) => left + (k / (shown - 1)) * pw,
      // channel centre lines and the half-height that maps to |value| = range
      ch: [
        { y0: top + band * 0.5, span: band * 0.42 / 1.35 },
        { y0: top + band * 1.5, span: band * 0.42 / 1.15 },
        { y0: top + band * 2.5, span: band * 0.42 / 1.45 },
      ],
    };
    return true;
  }

  function drawGrid(g) {
    const { left, top, pw, ph, band } = geo;
    g.fillStyle = colors.screen;
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1;
    g.strokeStyle = colors.grid;
    g.beginPath();
    for (let i = 0; i <= 10; i++) { const x = Math.round(left + (pw * i) / 10) + 0.5; g.moveTo(x, top); g.lineTo(x, top + ph); }
    for (let i = 0; i <= 12; i++) { const y = Math.round(top + (ph * i) / 12) + 0.5; g.moveTo(left, y); g.lineTo(left + pw, y); }
    g.stroke();
    g.strokeStyle = colors.major;
    g.beginPath();
    for (let c = 1; c < 3; c++) { const y = Math.round(top + band * c) + 0.5; g.moveTo(left, y); g.lineTo(left + pw, y); }
    g.rect(left + 0.5, top + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
    g.stroke();
    // channel ground markers
    const tags = [colors.ch1, colors.ch2, colors.ch3];
    g.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    geo.ch.forEach((c, idx) => {
      const y = c.y0;
      g.fillStyle = tags[idx];
      g.beginPath();
      g.moveTo(4, y - 7); g.lineTo(17, y - 7); g.lineTo(23, y); g.lineTo(17, y + 7); g.lineTo(4, y + 7);
      g.closePath();
      g.fill();
      g.fillStyle = colors.screen;
      g.fillText(String(idx + 1), 12, y + 0.5);
    });
  }

  function path(g, data, ch, from, to, step) {
    const c = geo.ch[ch];
    g.beginPath();
    if (step) {
      let prev = data[from];
      g.moveTo(geo.x(from), c.y0 - prev * c.span);
      for (let k = from + 1; k < to; k++) {
        const val = data[k];
        if (val !== prev) {
          const x = geo.x(k);
          g.lineTo(x, c.y0 - prev * c.span);
          g.lineTo(x, c.y0 - val * c.span);
          prev = val;
        }
      }
      g.lineTo(geo.x(to - 1), c.y0 - prev * c.span);
    } else {
      const stride = Math.max(1, Math.floor(shown / (geo.pw * 2))); // about 2 points per CSS pixel
      g.moveTo(geo.x(from), c.y0 - data[from] * c.span);
      for (let k = from + stride; k < to; k += stride) g.lineTo(geo.x(k), c.y0 - data[k] * c.span);
      g.lineTo(geo.x(to - 1), c.y0 - data[to - 1] * c.span);
    }
  }

  function stroke(g, color, width, glow) {
    if (glow && colors.glow) {
      g.save();
      g.globalAlpha = 0.18;
      g.lineWidth = width + 4;
      g.strokeStyle = color;
      g.stroke();
      g.restore();
    }
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }

  function drawStatic() {
    const g = lctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(g);
    g.save();
    g.beginPath();
    g.rect(geo.left, geo.top, geo.pw, geo.ph);
    g.clip();
    g.lineJoin = 'round';
    // CH1: carrier (thin) and reference
    path(g, trace.car, 0, 0, shown, false);
    g.globalAlpha = 0.55; stroke(g, colors.ch1, 1, false); g.globalAlpha = 1;
    path(g, trace.ref, 0, 0, shown, false);
    stroke(g, colors.ch1, 2, true);
    // CH2: bridge voltage
    path(g, trace.sw, 1, 0, shown, true);
    stroke(g, colors.ch2, 1.4, true);
    // CH3: ideal fundamental (dashed) and filtered output
    const ideal = trace.ref; // m_a sin(theta): what a perfect filter would deliver below overmodulation
    path(g, ideal, 2, 0, shown, false);
    g.setLineDash([4, 5]); g.globalAlpha = 0.6; stroke(g, colors.muted, 1, false); g.setLineDash([]); g.globalAlpha = 1;
    path(g, trace.out, 2, 0, shown, false);
    stroke(g, colors.ch3, 2, true);
    g.restore();
  }

  // ---- Animation: a beam sweeps across, brightening the traces it passes ----------------------

  const SWEEP_MS = 3200;
  let running = !reduceMotion.matches;
  let visible = true;
  let raf = 0;
  let t0 = performance.now();

  function frame(now) {
    if (!geo) return; // canvas not laid out yet (hidden, or printing)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    if (!running || reduceMotion.matches) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = ((now - t0) % SWEEP_MS) / SWEEP_MS;
    const head = Math.min(shown - 1, Math.floor(p * shown));
    const tail = Math.max(0, head - Math.floor(shown * 0.06));
    const x = geo.x(head);
    ctx.save();
    ctx.beginPath();
    ctx.rect(geo.left, geo.top, geo.pw, geo.ph);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = colors.major;
    ctx.fillRect(x, geo.top, 1, geo.ph);
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';
    if (head > tail) {
      path(ctx, trace.ref, 0, tail, head + 1, false); stroke(ctx, colors.ch1, 3, true);
      path(ctx, trace.sw, 1, tail, head + 1, true); stroke(ctx, colors.ch2, 2.2, true);
      path(ctx, trace.out, 2, tail, head + 1, false); stroke(ctx, colors.ch3, 3, true);
    }
    const dots = [[trace.ref, 0, colors.ch1], [trace.sw, 1, colors.ch2], [trace.out, 2, colors.ch3]];
    for (const [data, ch, col] of dots) {
      const c = geo.ch[ch];
      ctx.beginPath();
      ctx.arc(x, c.y0 - data[head] * c.span, 3.2, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.fill();
    }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  }

  function schedule() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (running && visible && !reduceMotion.matches) raf = requestAnimationFrame(frame);
    else frame(performance.now()); // paint the static layer once
  }

  // ---- Wiring -------------------------------------------------------------------------------

  const params = () => ({
    ma: parseFloat(ui.ma.value),
    mf: parseInt(ui.mf.value, 10),
    unipolar: figure.querySelector('input[name="scheme"]:checked').value === 'unipolar',
  });

  const fmtThd = (x) => {
    const pct = x * 100;
    return (pct < 10 ? pct.toFixed(1) : Math.round(pct).toString()) + ' %';
  };
  const fmtHz = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(2).replace(/0$/, '') + ' kHz' : hz + ' Hz');

  let liveTimer = 0;

  function update() {
    const p = params();
    simulate(p.ma, p.mf, p.unipolar);
    if (geo || layout()) { drawStatic(); schedule(); } // otherwise relayout() draws once visible

    const maTxt = p.ma.toFixed(2);
    ui.maOut.value = maTxt;
    ui.mfOut.value = String(p.mf);
    ui.ma.setAttribute('aria-valuetext', maTxt);
    ui.mf.setAttribute('aria-valuetext', p.mf + ', switching at ' + fmtHz(p.mf * F1).replace(' ', ' '));
    ui.fsw.textContent = fmtHz(p.mf * F1);
    ui.v1.textContent = result.v1.toFixed(2) + ' pu';
    ui.thd.textContent = fmtThd(result.thd);
    ui.tdiv.textContent = (shown === N ? 2 : 4) + ' ms/div';
    ui.flag.hidden = p.ma <= 1;

    const summary = 'Modulation index ' + maTxt + ', carrier ratio ' + p.mf + ', ' +
      (p.unipolar ? 'unipolar' : 'bipolar') + ' switching. Filtered output: fundamental ' +
      result.v1.toFixed(2) + ' per unit, total harmonic distortion ' + fmtThd(result.thd).replace(' ', ' ') + '.';
    canvas.setAttribute('aria-label', 'Oscilloscope view of sinusoidal pulse-width modulation. ' + summary);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { ui.live.textContent = summary; }, 700);
  }

  function relayout() {
    colors = readColors();
    if (layout()) { drawStatic(); schedule(); }
  }

  function setRunning(on) {
    running = on;
    ui.run.textContent = on ? 'Pause sweep' : 'Resume sweep';
    if (on) t0 = performance.now();
    schedule();
  }

  function syncMotion() {
    ui.run.hidden = reduceMotion.matches;
    running = !reduceMotion.matches;
    ui.run.textContent = 'Pause sweep';
    schedule();
  }

  figure.classList.add('is-live');
  colors = readColors();
  layout();
  syncMotion();
  update();

  ui.ma.addEventListener('input', update);
  ui.mf.addEventListener('input', update);
  for (const r of figure.querySelectorAll('input[name="scheme"]')) r.addEventListener('change', update);
  ui.run.addEventListener('click', () => setRunning(!running));
  reduceMotion.addEventListener('change', syncMotion);
  darkScheme.addEventListener('change', relayout);

  let resizeRaf = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const before = shown;
      relayout();
      if (shown !== before) update();
    });
  };
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(canvas);
  else window.addEventListener('resize', onResize);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      schedule();
    }).observe(canvas);
  }
})();
