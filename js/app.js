// ── Entry point ──────────────────────────────────────────────
// Load the save, wire events, and route: first visit goes to
// character creation, returning exiles land on the Atlas.

import { state, loadSaved, activeChar } from './state.js';
import { bindEvents, goChargen, goHub, goRoster } from './events.js';

function init() {
  loadSaved(state);
  bindEvents();
  if (state.roster.length === 0) goChargen();
  else if (activeChar(state)) goHub();
  else goRoster();
}

init();
