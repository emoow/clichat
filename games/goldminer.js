// Pure logic for the Gold Miner mini-game. No I/O, no side effects.
// Must stay deterministic: every client uses the same seed/inputs and
// arrives at the same map and shot results.

export const MAP_W = 16;
export const MAP_H = 18;
export const HOOK_X = 7; // 0-indexed column of the hook gantry pivot
export const HOOK_Y = 1; // gantry sits on row 0; hook anchor is row 1

// Hook physics constants (seconds-based for active player local sim).
export const SWING_HALF_DEG = 75;            // swings between -75° and +75°
export const SWING_PERIOD_MS = 2400;         // one full back-and-forth cycle
export const HOOK_DESCEND_CELLS_PER_SEC = 14;
export const HOOK_RETRACT_EMPTY_CELLS_PER_SEC = 22;

export const ITEMS = {
  small:   { char: '$', points: 50,   retractMs: 800,  prob: 0.16 },
  big:     { char: 'S', points: 250,  retractMs: 1500, prob: 0.05 },
  diamond: { char: '*', points: 500,  retractMs: 500,  prob: 0.02 },
  stone:   { char: '#', points: -5,   retractMs: 2000, prob: 0.10 },
  mystery: { char: '?', points: 0,    retractMs: 1200, prob: 0.03 },
};
// rest (~64%) stays empty so players have room to navigate to deeper prizes

const COL_LABELS = 'ABCDEFGHIJKLMNOP';

// 32-bit seeded PRNG. Tiny, fast, deterministic across V8 versions.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic map gen from a 32-bit seed.
// Items live in rows 3..MAP_H-2 (skipping gantry rows and bottom border).
export function generateMap(seed) {
  const rng = mulberry32(seed);
  const items = [];
  let nextId = 1;
  for (let y = 3; y < MAP_H - 1; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const r = rng();
      let kind = null;
      let acc = 0;
      for (const k of Object.keys(ITEMS)) {
        acc += ITEMS[k].prob;
        if (r < acc) { kind = k; break; }
      }
      if (!kind) continue;
      const def = ITEMS[kind];
      // Mystery payout decided at gen time so all clients agree.
      const points = kind === 'mystery'
        ? Math.floor(rng() * 500) - 100  // -100 .. +399
        : def.points;
      items.push({ id: nextId++, x, y, kind, points, retractMs: def.retractMs });
    }
  }
  return items;
}

// Cast a ray from (HOOK_X, HOOK_Y) at angleDeg (0=down, +=right).
// Returns { hitId, hitItem, hitX, hitY, distance } where hitId is null on miss.
// `map` is the live items array (already-claimed items removed).
export function simulateShot(map, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad);
  const occ = new Map();
  for (const it of map) occ.set(it.x + ',' + it.y, it);
  const STEP = 0.1;
  let t = 0.5;
  while (true) {
    t += STEP;
    const px = HOOK_X + dx * t;
    const py = HOOK_Y + dy * t;
    if (py >= MAP_H - 0.5) return { hitId: null, hitX: px, hitY: py, distance: t };
    if (px < -0.5 || px > MAP_W - 0.5) return { hitId: null, hitX: px, hitY: py, distance: t };
    const cx = Math.round(px);
    const cy = Math.round(py);
    const it = occ.get(cx + ',' + cy);
    if (it) return { hitId: it.id, hitItem: it, hitX: cx, hitY: cy, distance: t };
  }
}

// Compute the swing angle at a given local time-elapsed (ms).
// Triangle wave between -SWING_HALF_DEG and +SWING_HALF_DEG.
export function swingAngleAt(elapsedMs) {
  const phase = (elapsedMs % SWING_PERIOD_MS) / SWING_PERIOD_MS;
  // 0..0.25 → 0..+1, 0.25..0.75 → +1..-1, 0.75..1 → -1..0
  let v;
  if (phase < 0.25) v = phase / 0.25;
  else if (phase < 0.75) v = 1 - (phase - 0.25) / 0.25;
  else v = -1 + (phase - 0.75) / 0.25;
  return v * SWING_HALF_DEG;
}

function lineCharForAngle(angleDeg) {
  const a = Math.abs(angleDeg);
  if (a < 15) return '|';
  if (a < 60) return angleDeg > 0 ? '\\' : '/';
  return '-';
}

// Render the matrix into a multi-line string. ANSI colors are passed in via `palette`
// so the module stays decoupled from client constants.
export function renderFrame(state, palette) {
  const p = palette || {};
  const DIM = p.DIM || '';
  const CYAN = p.CYAN || '';
  const RESET = p.RESET || '';
  const REVERSE = p.REVERSE || '';
  const YELLOW = p.YELLOW || p.CYAN || '';

  // Build a plain char grid first; coloring happens at row-emit time.
  const grid = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = new Array(MAP_W).fill(' ');
    grid.push(row);
  }
  // Gantry on row 0 (left/center/right of HOOK_X)
  if (HOOK_X - 1 >= 0) grid[0][HOOK_X - 1] = '-';
  grid[0][HOOK_X] = 'T';
  if (HOOK_X + 1 < MAP_W) grid[0][HOOK_X + 1] = '-';

  // Items
  for (const it of state.map) {
    if (it.y >= 0 && it.y < MAP_H && it.x >= 0 && it.x < MAP_W) {
      grid[it.y][it.x] = ITEMS[it.kind]?.char || '?';
    }
  }

  // Hook: only when state has a hook pose
  const hook = state.hook;
  if (hook) {
    const rad = (hook.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = Math.cos(rad);
    const tipDist = Math.max(0.5, hook.length);
    const lineCh = lineCharForAngle(hook.angle);
    // Draw the rope (skip the very tip)
    for (let t = 0.5; t < tipDist - 0.1; t += 0.5) {
      const cx = Math.round(HOOK_X + dx * t);
      const cy = Math.round(HOOK_Y + dy * t);
      if (cx < 0 || cx >= MAP_W || cy < 0 || cy >= MAP_H) break;
      if (grid[cy][cx] === ' ') grid[cy][cx] = lineCh;
    }
    // Tip
    const tipX = Math.round(HOOK_X + dx * tipDist);
    const tipY = Math.round(HOOK_Y + dy * tipDist);
    if (tipX >= 0 && tipX < MAP_W && tipY >= 0 && tipY < MAP_H) {
      const tipCh = hook.carrying ? (ITEMS[hook.carrying.kind]?.char || '?') : 'V';
      grid[tipY][tipX] = '\0' + REVERSE + tipCh + RESET; // sentinel: already-styled
    }
  }

  // Emit lines
  const lines = [];
  let header = '   ';
  for (let x = 0; x < MAP_W; x++) header += ' ' + COL_LABELS[x];
  lines.push(`${DIM}${header}${RESET}`);
  for (let y = 0; y < MAP_H; y++) {
    const rowLabel = String(y + 1).padStart(2, ' ');
    let row = `${DIM}${rowLabel}${RESET} `;
    for (let x = 0; x < MAP_W; x++) {
      let cell = grid[y][x];
      let painted;
      if (typeof cell === 'string' && cell.charCodeAt(0) === 0) {
        painted = cell.slice(1); // pre-styled (tip)
      } else if (cell === ' ') {
        painted = `${DIM}.${RESET}`;
      } else if (cell === '$' || cell === 'S') {
        painted = `${YELLOW}${cell}${RESET}`;
      } else if (cell === '*') {
        painted = `${CYAN}${cell}${RESET}`;
      } else if (cell === '#') {
        painted = `${DIM}${cell}${RESET}`;
      } else if (cell === 'T' || cell === '-') {
        painted = `${DIM}${cell}${RESET}`;
      } else {
        painted = cell;
      }
      row += (x === 0 ? '' : ' ') + painted;
    }
    lines.push(row);
  }
  return lines.join('\n');
}

// Footer rendered separately so callers can append flair (queued-msg counter, etc).
export function renderFooter(state, palette, queuedMsgs = 0) {
  const p = palette || {};
  const DIM = p.DIM || '';
  const CYAN = p.CYAN || '';
  const RESET = p.RESET || '';

  const lines = [];
  if (state.status === 'pending') {
    lines.push(`${DIM}* 等待 /join | 发起人 /start 开始 (已加入 ${state.players.length})${RESET}`);
    lines.push(`${DIM}  玩家: ${state.players.join(', ')}${RESET}`);
  } else if (state.status === 'playing') {
    const cur = state.players[state.currentIdx];
    let remain = '?';
    if (state.turnEndsAt) {
      const sec = Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000));
      remain = `${sec}s`;
    }
    let head = `${CYAN}> ${cur}${RESET}    ${DIM}剩余 ${remain}${RESET}`;
    if (queuedMsgs > 0) head += `   ${CYAN}# ${queuedMsgs} 条新消息${RESET}`;
    lines.push(head);
    const scoreParts = state.players.map((n) => `${n}:${state.scores[n] || 0}`).join('   ');
    lines.push(`${DIM}${scoreParts}${RESET}`);
  } else if (state.status === 'finished') {
    const ranking = [...state.players].sort((a, b) => (state.scores[b] || 0) - (state.scores[a] || 0));
    const parts = ranking.map((n, i) => `${i + 1}. ${n} ${state.scores[n] || 0}`);
    lines.push(`${CYAN}== 排行榜 ==${RESET}`);
    lines.push(parts.join('   '));
  }
  return lines.join('\n');
}

// Helper for narration text on broadcasts.
export function describeShot(by, angleDeg, hitItem, points) {
  if (!hitItem) return `${by} 在 ${angleDeg.toFixed(0)}° 放钩 -> 空 (+0)`;
  const sign = points >= 0 ? '+' : '';
  return `${by} 在 ${angleDeg.toFixed(0)}° 放钩 -> ${hitItem.char || '?'} (${sign}${points})`;
}
