import OBR from "@owlbear-rodeo/sdk";
import { setWalls, blocked } from "./walls.js";

const $ = (s) => document.querySelector(s);
const DOUBLE_TAP_MS = 500;
const REPEAT_FIRST = 350, REPEAT_NEXT = 180; // Halten = wiederholte Schritte
const CAM_SPEED = 22; // px pro Frame bei voller Auslenkung

const st = {
  mode: "both", input: "stick", max: 30, used: 0, history: [],
  dpi: 150, perCell: 5, unit: "ft", gm: false, busy: false,
  ...JSON.parse(localStorage.getItem("joy") || "{}"),
};
const save = () => localStorage.setItem("joy", JSON.stringify({ mode: st.mode, input: st.input, max: st.max, used: st.used, history: st.history }));
const notify = (m, v = "WARNING") => OBR.notification.show(m, v);

function render() {
  $("#used").textContent = st.used;
  $("#unit").textContent = st.unit;
  $("#max").value = st.max;
  const f = $("#fill");
  f.style.width = st.max ? Math.min(100, (st.used / st.max) * 100) + "%" : "0";
  f.classList.toggle("full", st.max > 0 && st.used >= st.max);
  $("#undo").disabled = !st.history.length;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === st.mode));
  document.querySelectorAll("[data-input]").forEach((b) => b.classList.toggle("on", b.dataset.input === st.input));
  $("#stick").hidden = st.input !== "stick";
  $("#dpad").hidden = st.input !== "dpad";
  save();
}

/* ---------- Szene / Grid ---------- */
async function loadGrid() {
  st.dpi = await OBR.scene.grid.getDpi();
  const s = await OBR.scene.grid.getScale();
  st.perCell = s.parsed.multiplier || 5;
  st.unit = s.parsed.unit || "ft";
  render();
}

/* ---------- Kamera ---------- */
async function centerOn(p) {
  const [scale, w, h] = await Promise.all([OBR.viewport.getScale(), OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  await OBR.viewport.setPosition({ x: w / 2 - p.x * scale, y: h / 2 - p.y * scale });
}
async function zoom(factor) {
  const [pos, scale, w, h] = await Promise.all([OBR.viewport.getPosition(), OBR.viewport.getScale(), OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  const s2 = Math.min(Math.max(scale * factor, 0.1), 10);
  const c = { x: (w / 2 - pos.x) / scale, y: (h / 2 - pos.y) / scale }; // Szenenpunkt in der Bildschirmmitte bleibt fix
  await OBR.viewport.animateTo({ scale: s2, position: { x: w / 2 - c.x * s2, y: h / 2 - c.y * s2 } });
}

/* ---------- Token-Schritt ---------- */
async function targets() {
  const ids = await OBR.player.getSelection();
  if (!ids?.length) return [];
  const items = await OBR.scene.items.getItems(ids);
  return items.filter((i) => st.gm || i.createdUserId === OBR.player.id);
}

// Rückgabe: true = bewegt, "blocked" = Wand/Budget, false = nichts getan
async function step(dx, dy, bypass) {
  if (st.busy) return false;
  st.busy = true;
  try {
    const items = await targets();
    if (!items.length) { notify("Wähle zuerst einen eigenen Token aus."); return false; }
    if (st.max && st.used + st.perCell > st.max) { notify(`Bewegung aufgebraucht (${st.used} / ${st.max} ${st.unit}).`); return "blocked"; }

    const moves = items.map((i) => ({
      id: i.id, from: { ...i.position },
      to: { x: i.position.x + dx * st.dpi, y: i.position.y + dy * st.dpi },
    }));
    if (!bypass && !st.gm && moves.some((m) => blocked(m.from, m.to))) {
      notify("🧱 Wand im Weg – zweimal schnell tippen, um durchzugehen.");
      return "blocked";
    }
    const to = new Map(moves.map((m) => [m.id, m.to]));
    await OBR.scene.items.updateItems(items, (list) => { for (const it of list) it.position = to.get(it.id); });

    st.used += st.perCell;
    st.history.push({ cost: st.perCell, moves: moves.map(({ id, from }) => ({ id, from })) });
    render();
    if (st.mode === "both") await centerOn(moves[0].to);
    return true;
  } catch (e) {
    console.error(e); notify("Token konnte nicht bewegt werden."); return false;
  } finally { st.busy = false; }
}

async function undo() {
  const h = st.history.pop();
  if (!h) return;
  const from = new Map(h.moves.map((m) => [m.id, m.from]));
  await OBR.scene.items.updateItems((i) => from.has(i.id), (list) => { for (const it of list) it.position = from.get(it.id); });
  st.used = Math.max(0, st.used - h.cost);
  render();
  if (st.mode === "both") await centerOn(h.moves[0].from);
}

function endTurn() { st.used = 0; st.history = []; render(); notify("Zug beendet.", "SUCCESS"); }

/* ---------- Eingabe-Steuerung (Joystick, Pfeiltasten, Tastatur) ---------- */
let vec = { x: 0, y: 0 }, curKey = null, timer = null, last = { key: null, t: 0 }, camRunning = false;

function quant(x, y) {
  const i = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return { key: i, x: Math.round(Math.cos(i * Math.PI / 4)), y: Math.round(Math.sin(i * Math.PI / 4)) };
}

function setVector(x, y) {
  vec = { x, y };
  const mag = Math.hypot(x, y);
  if (st.mode === "cam") { if (mag > 0.1) camLoop(); return; }
  const dir = mag < 0.4 ? null : quant(x, y);
  const key = dir ? dir.key : null;
  if (key === curKey) return;
  curKey = key;
  clearTimeout(timer);
  if (dir) press(dir);
}

async function press(dir) {
  const now = performance.now();
  const dbl = last.key === dir.key && now - last.t < DOUBLE_TAP_MS; // Doppeltipp in gleiche Richtung = Wand ignorieren
  last = { key: dir.key, t: dbl ? 0 : now };
  if ((await step(dir.x, dir.y, dbl)) !== true) return;
  const rep = async () => {
    if (curKey !== dir.key) return;
    if ((await step(dir.x, dir.y, false)) === true && curKey === dir.key) timer = setTimeout(rep, REPEAT_NEXT);
  };
  timer = setTimeout(rep, REPEAT_FIRST);
}

async function camLoop() {
  if (camRunning) return;
  camRunning = true;
  let pos = await OBR.viewport.getPosition();
  while (st.mode === "cam" && Math.hypot(vec.x, vec.y) > 0.1) {
    const m = Math.min(1, Math.hypot(vec.x, vec.y)); // m² = sanfter Anlauf, feine Kontrolle
    pos = { x: pos.x - vec.x * m * CAM_SPEED, y: pos.y - vec.y * m * CAM_SPEED };
    await OBR.viewport.setPosition(pos);
    await new Promise(requestAnimationFrame);
  }
  camRunning = false;
}

// Joystick
const pad = $("#stick"), knob = $("#knob");
function stickMove(e) {
  const r = pad.getBoundingClientRect(), R = r.width / 2;
  let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  knob.style.transform = `translate(${x * R * 0.55}px, ${y * R * 0.55}px)`;
  setVector(x, y);
}
pad.addEventListener("pointerdown", (e) => { pad.setPointerCapture(e.pointerId); stickMove(e); });
pad.addEventListener("pointermove", (e) => { if (pad.hasPointerCapture(e.pointerId)) stickMove(e); });
const stickEnd = () => { knob.style.transform = ""; setVector(0, 0); };
pad.addEventListener("pointerup", stickEnd);
pad.addEventListener("pointercancel", stickEnd);

// Pfeiltasten (8 Richtungen)
document.querySelectorAll("[data-d]").forEach((b) => {
  const [dx, dy] = b.dataset.d.split(",").map(Number);
  const n = Math.hypot(dx, dy);
  b.addEventListener("pointerdown", (e) => { b.setPointerCapture(e.pointerId); b.classList.add("down"); setVector(dx / n, dy / n); });
  const up = () => { b.classList.remove("down"); setVector(0, 0); };
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
});

// Tastatur (Laptop): Pfeile / WASD
const keys = new Set();
const KEYMAP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
function keyVec() {
  let x = 0, y = 0;
  keys.forEach((k) => { x += KEYMAP[k][0]; y += KEYMAP[k][1]; });
  const n = Math.hypot(x, y) || 1;
  setVector(x / n, y / n);
}
addEventListener("keydown", (e) => { if (e.target.tagName === "INPUT" || !(e.key in KEYMAP)) return; e.preventDefault(); keys.add(e.key); keyVec(); });
addEventListener("keyup", (e) => { if (keys.delete(e.key)) keyVec(); });

/* ---------- UI-Events ---------- */
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; render(); }));
document.querySelectorAll("[data-input]").forEach((b) => b.addEventListener("click", () => { st.input = b.dataset.input; render(); }));
$("#max").addEventListener("change", (e) => { st.max = Math.max(0, Number(e.target.value) || 0); render(); });
$("#zin").addEventListener("click", () => zoom(1.25));
$("#zout").addEventListener("click", () => zoom(0.8));
$("#undo").addEventListener("click", undo);
$("#end").addEventListener("click", endTurn);

/* ---------- Start ---------- */
render();
OBR.onReady(async () => {
  st.gm = (await OBR.player.getRole()) === "GM";
  OBR.player.onChange(async () => { st.gm = (await OBR.player.getRole()) === "GM"; });
  const init = async (ready) => {
    if (!ready) return;
    await loadGrid();
    setWalls(await OBR.scene.items.getItems());
  };
  OBR.scene.onReadyChange(init);
  OBR.scene.grid.onChange(loadGrid);
  OBR.scene.items.onChange(setWalls);
  init(await OBR.scene.isReady());
});
