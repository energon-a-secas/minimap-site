// ── Event handlers ───────────────────────────────────────────
// All user input: screens, chargen, roster, atlas, and in-game
// controls (mouse move-to, WASD, Q skill, T waypoints, Esc).

import { $, setScreen } from './utils.js';
import { state, save, createCharacter, defaultCharacter, deleteCharacter } from './state.js';
import { startRun, stopRun, useSkill, respawn, teleportTo, setMoveTarget } from './game.js';
import { renderHub, selectNode } from './hub.js';
import { renderChargen, renderRoster, setDraftClass, setDraftOption, draft } from './chargen.js';
import { renderWaypointPanel, toggleWaypointPanel, hideCleared } from './hud.js';
import { resizeCanvases, paintBackdrop, screenToWorld } from './render.js';

// ── Screen routing ───────────────────────────────────────────

export function goChargen() { setScreen('chargen'); renderChargen(); $('charName').value = ''; }
export function goRoster() { stopRun(); setScreen('roster'); renderRoster(); }
export function goHub() { stopRun(); setScreen('hub'); renderHub(); }
function goGame(nodeId) { setScreen('game'); startRun(nodeId); }

function leaveToHub() { toggleWaypointPanel(false); goHub(); }

// ── Modal helpers (template pattern) ─────────────────────────

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.removeAttribute('hidden');
  document.body.classList.add('modal-open');
  modal.querySelector('.modal__header [data-modal-close]')?.focus();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.setAttribute('hidden', '');
  document.body.classList.remove('modal-open');
}

function getOpenModal() { return document.querySelector('.modal:not([hidden])'); }

// ── Bind everything (called once from app.js) ────────────────

export function bindEvents() {
  // header
  $('rosterBtn').addEventListener('click', goRoster);
  $('helpBtn').addEventListener('click', () => openModal('helpModal'));
  document.addEventListener('click', (e) => {
    const modal = e.target.closest?.('.modal');
    if (modal && !modal.hasAttribute('hidden') && e.target.closest('[data-modal-close]')) closeModal(modal.id);
  });

  // chargen
  $('classPicker').addEventListener('click', (e) => {
    const card = e.target.closest('.class-card');
    if (card) setDraftClass(card.dataset.cls);
  });
  $('bodyOptions').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setDraftOption(chip.dataset.key, chip.dataset.value);
  });
  $('createCharBtn').addEventListener('click', () => {
    createCharacter(state, { name: $('charName').value, cls: draft.cls, body: { ...draft.body } });
    goHub();
  });
  $('skipCharBtn').addEventListener('click', () => {
    createCharacter(state, defaultCharacter());
    goHub();
  });

  // roster
  $('rosterList').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) {
      state.activeId = play.dataset.play;
      save(state);
      goHub();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const char = state.roster.find((c) => c.id === del.dataset.del);
      if (char && window.confirm(`Delete ${char.name} (level ${char.level}) forever?`)) {
        deleteCharacter(state, del.dataset.del);
        state.roster.length ? renderRoster() : goChargen();
      }
    }
  });
  $('newCharBtn').addEventListener('click', goChargen);

  // atlas hub
  $('atlasSvg').addEventListener('click', (e) => {
    const node = e.target.closest('[data-node]');
    if (node) selectNode(node.dataset.node);
  });
  $('atlasSvg').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = e.target.closest?.('[data-node]');
    if (node) { e.preventDefault(); selectNode(node.dataset.node); }
  });
  $('enterMapBtn').addEventListener('click', () => {
    if (state.selectedNode) goGame(state.selectedNode);
  });

  bindGameInput();

  window.addEventListener('resize', () => {
    if (!state.run) return;
    resizeCanvases();
    paintBackdrop(state.run.map);
  });
}

// ── In-game input ────────────────────────────────────────────

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

function bindGameInput() {
  const canvas = $('gameCanvas');

  canvas.addEventListener('mousedown', (e) => {
    const run = state.run;
    if (!run || run.over || e.button !== 0) return;
    const w = screenToWorld(run, e.clientX, e.clientY);
    run.input.mouse = { down: true, x: w.x, y: w.y };
    setMoveTarget(w.x, w.y);
  });
  canvas.addEventListener('mousemove', (e) => {
    const run = state.run;
    if (!run || !run.input.mouse.down) return;
    const w = screenToWorld(run, e.clientX, e.clientY);
    run.input.mouse.x = w.x;
    run.input.mouse.y = w.y;
  });
  window.addEventListener('mouseup', (e) => {
    const run = state.run;
    if (!run || e.button !== 0 || !run.input.mouse.down) return;
    run.input.mouse.down = false;
    if (!run.over) setMoveTarget(run.input.mouse.x, run.input.mouse.y);
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    useSkill();
  });

  document.addEventListener('keydown', (e) => {
    // modal escape always wins
    const modal = getOpenModal();
    if (modal) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(modal.id); }
      return;
    }
    if (state.screenIsTyping || e.target.tagName === 'INPUT') return;
    const run = state.run;
    if (!run || document.body.dataset.screen !== 'game') return;
    const key = e.key.toLowerCase();
    if (MOVE_KEYS.includes(key)) {
      run.input.keys[key] = true;
      e.preventDefault();
      return;
    }
    if (key === 'q') { useSkill(); return; }
    if (key === 't') {
      if (toggleWaypointPanel()) renderWaypointPanel(run, teleportTo, leaveToHub);
      return;
    }
    if (key === 'escape') {
      if (!toggleWaypointPanel(false)) leaveToHub();
    }
  });
  document.addEventListener('keyup', (e) => {
    const run = state.run;
    if (!run) return;
    const key = e.key.toLowerCase();
    if (MOVE_KEYS.includes(key)) delete run.input.keys[key];
  });

  // HUD buttons
  $('skillBtn').addEventListener('click', useSkill);
  $('waypointBtn').addEventListener('click', () => {
    const run = state.run;
    if (run && toggleWaypointPanel()) renderWaypointPanel(run, teleportTo, leaveToHub);
  });
  $('wpClose').addEventListener('click', () => toggleWaypointPanel(false));
  $('leaveBtn').addEventListener('click', leaveToHub);
  $('respawnBtn').addEventListener('click', respawn);
  $('backToHubBtn').addEventListener('click', () => { hideCleared(); leaveToHub(); });
  $('stayBtn').addEventListener('click', () => {
    hideCleared();
    if (state.run) state.run.over = null;
  });
}
