// Home hero: a toy grid for illustration, not a result. Frequency comes from one aggregate swing
// equation with governor droop; the PCC voltage from a linear sensitivity to the power at the PCC.
// The wind turbine parks above 25 m/s and restarts below 19 m/s once its rotor has stopped, after the
// supervisory thresholds in Caleb's DFIG project. Without JavaScript the diagram still works as links.
(() => {
  'use strict';
  const fig = document.getElementById('minigrid');
  if (!fig || !window.requestAnimationFrame) return;
  const $ = (id) => document.getElementById(id);
  const inSun = $('in-sun'), inWind = $('in-wind'), inLoad = $('in-load');
  const outSun = $('out-sun'), outWind = $('out-wind'), outLoad = $('out-load');
  const roF = $('ro-f'), roV = $('ro-v'), note = $('grid-note'), live = $('grid-live');
  const rotor = $('rotor'), wtLink = $('wt-link'), arrow = $('grid-arrow');
  if (!inSun || !roF || !rotor) return;
  const flows = {};
  fig.querySelectorAll('.flow').forEach((p) => { flows[p.dataset.k] = { el: p, off: 0 }; });
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Toy parameters: per unit on the toy's own base unless noted.
  const F0 = 50, H = 5, D = 1, R = 0.05, TG = 0.5, SYS = 5;  // Hz; s; pu/pu; pu; s; system base / toy base
  const PV_MAX = 0.35, WT_MAX = 0.40, LOAD_MAX = 1.0, EV = 0.08;
  const V_SRC = 1.02, R_TH = 0.08, X_TH = 0.12, Q_RES = 0.15;
  const V_IN = 5, V_RATED = 13, V_OUT = 25, V_RESTART = 19;  // m/s

  let parked = false, omega = 0, angle = 0, df = 0, dpm = 0, pnet0 = 0, last = 0, raf = 0, visible = true;

  const wind = () => Number(inWind.value);
  function turbine() {                       // [rotor speed, power], both per unit of rated
    const v = wind();
    if (parked) return [0, 0];
    if (v < V_IN) return [0.25 * v / V_IN, 0];
    if (v < V_RATED) return [v / V_RATED, (v ** 3 - V_IN ** 3) / (V_RATED ** 3 - V_IN ** 3)];
    return [1, 1];
  }
  function park(rotorStopped) {
    const v = wind();
    if (!parked && v > V_OUT) parked = true;
    else if (parked && v < V_RESTART && rotorStopped) parked = false;
  }
  function powers() {
    const pv = PV_MAX * inSun.value / 100, wt = WT_MAX * turbine()[1], load = LOAD_MAX * inLoad.value / 100;
    return { pv, wt, load, ev: EV, grid: load + EV - pv - wt };
  }
  const volts = (p) => V_SRC - R_TH * p.grid - X_TH * Q_RES * p.load;
  const steadyDf = (p) => -((p.grid - pnet0) / SYS) / (1 / R + D);

  function labels() {
    outSun.textContent = inSun.value + ' %';
    outWind.textContent = wind() + ' m/s';
    outLoad.textContent = inLoad.value + ' %';
  }
  function render(p, dt) {
    roF.textContent = (F0 * (1 + df)).toFixed(2) + ' Hz';
    roV.textContent = volts(p).toFixed(2) + ' pu';
    rotor.setAttribute('transform', 'rotate(' + angle.toFixed(1) + ' 250 34)');
    wtLink.classList.toggle('is-parked', parked);
    note.textContent = parked ? 'Above 25 m/s the turbine parks. It restarts below 19 m/s, once the rotor has stopped.' : '';
    arrow.setAttribute('transform', p.grid < 0 ? 'rotate(180 70 150)' : '');
    for (const k in flows) {
      const f = flows[k], P = p[k], mag = Math.abs(P);
      f.el.style.strokeWidth = (2 + 6 * mag).toFixed(2);
      f.el.style.opacity = mag < 0.005 ? '0' : '1';
      if (dt) {
        f.off -= Math.sign(P) * (6 + 50 * mag) * dt;
        f.el.style.strokeDashoffset = f.off.toFixed(1);
      }
    }
  }

  function settle() {                       // reduced motion: jump to the steady state on input
    omega = turbine()[0];
    park(true);
    const p = powers();
    df = steadyDf(p);
    dpm = -df / R;
    render(p, 0);
  }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0);
    last = t;
    const p = powers(), dpe = (p.grid - pnet0) / SYS;
    const n = Math.max(1, Math.ceil(dt / 0.005)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const ddf = (dpm - dpe - D * df) / (2 * H), ddpm = (-df / R - dpm) / TG;
      df += ddf * h;
      dpm += ddpm * h;
    }
    omega += (turbine()[0] - omega) * Math.min(1, dt / 1.5);
    park(omega < 0.02);
    angle = (angle + omega * 240 * dt) % 360;
    render(powers(), dt);
    loop();
  }
  function loop() {
    if (!raf && visible && !still.matches && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }

  function onInput() {
    labels();
    if (still.matches) settle();
  }
  let timer = 0;
  function announce() {                     // one polite summary after the user lets go
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = powers();
      live.textContent = 'Frequency settles near ' + (F0 * (1 + steadyDf(p))).toFixed(2) +
        ' hertz; PCC voltage ' + volts(p).toFixed(2) + ' per unit.';
    }, 400);
  }
  [inSun, inWind, inLoad].forEach((el) => {
    el.addEventListener('input', onInput);
    el.addEventListener('change', announce);
  });
  still.addEventListener('change', () => { stop(); if (still.matches) settle(); else loop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else loop(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) loop(); else stop(); }).observe(fig);
  }

  pnet0 = powers().grid;                     // the governor is dispatched for the opening state
  omega = turbine()[0];
  labels();
  fig.classList.add('is-live');
  settle();
  loop();
})();
