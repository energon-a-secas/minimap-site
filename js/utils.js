// escHtml and debounce come from the DOM Kit (js/neorgon-dom.js). This
// site's showToast is left alone: it creates and removes its own element
// rather than toggling a class, which the kit's contract does not cover.
//
// Do not edit js/neorgon-dom.js. Edit packages/neorgon-ui/dom/ and run
// packages/neorgon-ui/sync-dom.sh.
import { escHtml, debounce } from './neorgon-dom.js';
export { escHtml, debounce };

// ── Shared utilities ─────────────────────────────────────────
// Small, pure helper functions used across multiple modules.

/** Cached element lookup by ID. */
const _els = {};
export function $(id) {
  return _els[id] || (_els[id] = document.getElementById(id));
}


/** Seeded PRNG (mulberry32). Returns a function yielding [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random int in [min, max] inclusive from an rng function. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

export function lerp(a, b, t) { return a + (b - a) * t; }

/** Distance from point P to segment AB (all in tile space). */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + t * dx, ay + t * dy);
}

/** Compact number: 1234567 -> "1.23M". */
export function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

/** Switch top-level screens: chargen | roster | hub | game. */
export function setScreen(name) {
  document.body.dataset.screen = name;
  for (const sc of document.querySelectorAll('.screen')) {
    sc.hidden = sc.id !== `screen-${name}`;
  }
  const footer = document.getElementById('siteFooter');
  if (footer) footer.hidden = name === 'game';
}

/** Show a temporary toast inside the game stage (or body fallback). */
let _toastTimer = null;
export function showToast(msg) {
  const box = document.getElementById('toastbox');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  // Announced by screen readers. Without these the toast is
  // invisible to anyone not looking at that corner of the screen.
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('visible'), 10);
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 2600);
  clearTimeout(_toastTimer);
}

