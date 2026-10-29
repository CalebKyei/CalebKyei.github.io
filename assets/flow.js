// DFIG page: a wind-speed scrubber over the simplified supervisory flow. It highlights the active state
// with the report's thresholds and keeps the state until the return threshold is crossed (hysteresis).
// Schematic: below rated, generator speed is taken as proportional to the wind, so 1800 and 1584 rpm
// sit at the rated wind of 13 m/s and at 0.88 x 13 = 11.4 m/s.
(() => {
  'use strict';
  const input = document.getElementById('wind-scrub');
  const wrap = document.querySelector('.flow-scrub');
  if (!input || !wrap) return;
  const out = document.getElementById('wind-out');
  const msg = document.getElementById('flow-state');
  const boxes = {};
  document.querySelectorAll('.flowfig .st').forEach((g) => { boxes[g.dataset.s] = g; });

  const CUT_IN = 5, RATED = 13, BACK = 0.88 * RATED, CUT_OUT = 25, RESTART = 19;
  const run = (v) => (v >= RATED ? 'rated' : v >= CUT_IN ? 'mppt' : 'idle');
  function next(s, v) {
    if (v > CUT_OUT) return 'cutout';
    if (s === 'cutout') return v < RESTART ? run(v) : 'cutout';
    if (s === 'rated') return v < BACK ? (v < CUT_IN ? 'idle' : 'mppt') : 'rated';
    return run(v);
  }
  const TEXT = {
    idle: () => '<strong>Idle.</strong> Below cut-in, about 5 m/s: no torque.',
    mppt: () => '<strong>MPPT.</strong> Torque follows K<sub>opt</sub>Ω² with the pitch at 0°.',
    rated: (v) => '<strong>Rated.</strong> The pitch PI holds 1800 rpm.' +
      (v < RATED ? ' Hysteresis: it stays here until the speed falls below 1584 rpm, about 11.4 m/s.' : ''),
    cutout: (v) => '<strong>Cut-out.</strong> Blades feathered.' +
      (v <= CUT_OUT ? ' Hysteresis: no restart until the wind is below 19 m/s and the rotor has slowed.' : ''),
  };

  let state = 'idle', prev = 0;
  function show(v) {
    // Walk the slider's path in small steps, so a jump crosses every threshold on the way.
    const step = v > prev ? 0.5 : -0.5;
    for (let x = prev; step > 0 ? x < v : x > v; x += step) state = next(state, x);
    state = next(state, v);
    prev = v;
    out.textContent = v.toFixed(1) + ' m/s';
    for (const k in boxes) boxes[k].classList.toggle('is-active', k === state);
    msg.innerHTML = TEXT[state](v);
  }
  input.addEventListener('input', () => show(Number(input.value)));
  wrap.hidden = false;
  show(Number(input.value));
})();
