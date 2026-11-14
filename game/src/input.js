// Keyboard + mouse input with pointer lock. The game never reads the DOM for keys
// during the simulation: it keeps one Set of held codes and a small look queue the
// fixed-step loop drains, so input and simulation stay decoupled.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    firing: false,
    aiming: false,
    fired: false,
    lookX: 0,
    lookY: 0,
  };
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) { keys.delete(event.code); }
  function onMouseMove(event) {
    if (!locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (!locked) return;
    if (event.button === 0) { state.firing = true; state.fired = true; }
    if (event.button === 2) state.aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) { state.firing = false; state.aiming = false; }
    onLockChange(locked);
  }
  function onContextMenu(event) { event.preventDefault(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    isLocked() { return locked; },
    requestLock() {
      if (!locked) canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takeFired() {
      const fired = state.fired;
      state.fired = false;
      return fired;
    },
    pressed(code) {
      if (!keys.has(code)) return false;
      keys.delete(code);
      return true;
    },
    clear() {
      keys.clear();
      state.firing = false;
      state.aiming = false;
      state.lookX = 0;
      state.lookY = 0;
    },
  };
}
