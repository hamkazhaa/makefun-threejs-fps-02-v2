// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. The player shoots hitscan weapons with spread, recoil and
// headshots; bots shoot back through the same callbacks; the match module
// owns rounds, money and the charge. ?shot=start|play|buy|end with &seed=N
// sets up a deterministic frame for a capture, renders it twice, then
// freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP, createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADE, buildViewmodel, createWeaponState, currentSpread, applyDamageFalloff } from './weapons.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMatch } from './match.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const lowFx = params.get('lowfx') === '1'; // test affordance: no shadows, pixel ratio 1
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(lowFx ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowFx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 32, 100);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const effects = createEffects(scene, map.colliders);
const player = createPlayer(map.colliders, MAP.vanguardSpawn[0]);
const weaponState = createWeaponState();
const owned = new Set(['pistol']);
let viewmodel = buildViewmodel(camera, 'pistol');
let viewmodelKick = 0;

const hud = createHud({
  onPlay: () => {
    audio.unlock();
    if (match.state.phase === 'menu') {
      match.startMatch();
      hud.hideOverlay(); // buy menu is the active UI now; B locks the mouse in
    } else if (match.state.phase === 'roundEnd' || match.state.phase === 'matchEnd') {
      match.nextRound();
      hud.hideOverlay();
    } else {
      input.requestLock();
    }
  },
  onBuy: (id) => {
    if (match.buy(id)) refreshWeaponHud();
  },
});

const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const shootables = map.shootables;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzle = new THREE.Vector3();
let trauma = 0;
let elapsed = 0;
let frozen = false;
let staging = false; // true while a ?shot= scene is being set up: bots hold still
let lastTime = performance.now();
let accumulator = 0;
let minimapAt = 0;
const seenEnemies = new Map(); // bot id -> {x, z, at}

function refreshWeaponHud() {
  const weapon = WEAPONS[weaponState.id];
  hud.setAmmo(weaponState.mag, weaponState.reserve, weaponState.reloading);
  hud.setMoney(match.state.money);
}

function equipWeapon(id) {
  if (!owned.has(id)) owned.add(id);
  camera.remove(viewmodel);
  weaponState.id = id;
  weaponState.mag = WEAPONS[id].mag;
  weaponState.reserve = WEAPONS[id].reserve;
  weaponState.reloading = false;
  weaponState.heat = 0;
  viewmodel = buildViewmodel(camera, id);
  refreshWeaponHud();
}

function damagePlayer(amount, fromBot, headshot) {
  if (!player.state.alive || match.state.phase !== 'play') return;
  const absorbed = Math.min(player.state.armor, amount * 0.5);
  player.state.armor -= absorbed;
  player.state.health -= amount - absorbed;
  hud.damageFlash();
  hud.setHealth(player.state.health, player.state.armor);
  audio.hurt();
  trauma = Math.min(1, trauma + 0.35);
  if (player.state.health <= 0) {
    player.state.health = 0;
    player.state.alive = false;
    input.releaseLock();
    match.onKill(fromBot.team, fromBot.name, 'vanguard', 'You', headshot);
    hud.announce('You are down — your team fights on');
  }
}

function damageBotByPlayer(bot, amount, part) {
  const killed = bots.damage(bot, amount, part);
  if (killed) {
    match.onKill('vanguard', 'You', 'ember', bot.name, part === 'head');
    hud.hitMarker(true, shot ? 4000 : 110);
    audio.kill();
  }
  return killed;
}

const bots = createBots(scene, map, {
  onPlayerHit: (damage, bot, head) => damagePlayer(damage, bot, head),
  onBotHit: (shooter, victim, damage, head) => {
    if (!victim || !victim.alive) return;
    const killed = bots.damage(victim, damage, head ? 'head' : 'body');
    if (killed) match.onKill(shooter.team, shooter.name, victim.team, victim.name, head);
  },
  onTracer: (from, to) => effects.spawnTracer(from, to),
  onShotSound: (bot, dist) => {
    if (dist < 40) audio.distantShot();
  },
  onPlanted: (bot) => match.onPlantedByBot(bot),
  onDefused: () => match.onDefusedByBot(),
});

const match = createMatch({
  player,
  bots,
  hud,
  audio,
  weaponState,
  equipWeapon,
  onChargeDetonated(planted) {
    effects.spawnExplosion(new THREE.Vector3(planted.x, 1, planted.z));
    audio.explosion();
    trauma = 1;
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.position.x - planted.x, bot.position.z - planted.z);
      if (d < 8) {
        const killed = bots.damage(bot, d < 4 ? 200 : 90, 'body');
        if (killed) match.onKill('vanguard', 'Charge', bot.team, bot.name, false);
      }
    }
    if (player.state.alive) {
      const d = Math.hypot(player.state.position.x - planted.x, player.state.position.z - planted.z);
      if (d < 8) damagePlayer(d < 4 ? 200 : 90, { team: 'vanguard', name: 'Charge' }, false);
    }
  },
});

function syncCamera() {
  const body = player.state;
  if (body.alive) {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  }
  if (trauma > 0) {
    camera.rotation.x += (random() - 0.5) * trauma * 0.03;
    camera.rotation.z += (random() - 0.5) * trauma * 0.03;
  }
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function reload() {
  const weapon = WEAPONS[weaponState.id];
  const full = weaponState.mag === weapon.mag;
  if (weaponState.reloading || full || weaponState.reserve <= 0) return;
  weaponState.reloading = true;
  weaponState.reloadEnd = elapsed + weapon.reloadTime;
  audio.reload();
  hud.setAmmo(weaponState.mag, weaponState.reserve, true);
}

function throwGrenade() {
  const inPlay = match.state.phase === 'play';
  if (weaponState.grenades <= 0 || !inPlay) return;
  weaponState.grenades -= 1;
  audio.grenadePin();
  player.eyePosition(eyePos);
  camera.getWorldDirection(direction);
  effects.throwGrenade(eyePos, direction);
  hud.announce(`Frag out — ${weaponState.grenades} left`);
}

function explodeGrenade(at) {
  audio.explosion();
  trauma = Math.min(1, trauma + 0.5);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.position.x - at.x, bot.position.z - at.z);
    const inRange = d < 5;
    const visible = inRange && map.losClear(at.x, at.y, at.z, bot.position.x, bot.position.y + 1, bot.position.z);
    if (visible) {
      const dmg = Math.round(120 - (d / 5) * 90);
      const killed = bots.damage(bot, dmg, 'body');
      if (killed) match.onKill('vanguard', 'You', bot.team, bot.name, false);
    }
  }
  if (player.state.alive) {
    const d = Math.hypot(player.state.position.x - at.x, player.state.position.z - at.z);
    if (d < 5) damagePlayer(Math.round(120 - (d / 5) * 90), { team: 'ember', name: 'Frag' }, false);
  }
}

function shoot() {
  const weapon = WEAPONS[weaponState.id];
  const now = elapsed;
  const tooSoon = now - weaponState.lastShot < weapon.fireInterval;
  if (weaponState.reloading || tooSoon) return false;
  if (weaponState.mag <= 0) {
    audio.dryFire();
    weaponState.lastShot = now;
    return false;
  }
  weaponState.mag -= 1;
  weaponState.lastShot = now;
  const heatGain = weapon.id === 'smg' ? 0.09 : weapon.id === 'rifle' ? 0.07 : 0.12;
  weaponState.heat = Math.min(1, weaponState.heat + heatGain);
  const speed = player.groundSpeed();
  const spread = shot ? 0 : currentSpread(weapon, speed, player.state.crouching, input.state.aiming);
  player.eyePosition(eyePos);
  camera.getWorldDirection(direction);
  muzzle.copy(eyePos).addScaledVector(direction, 0.6);
  muzzle.y -= 0.12;
  effects.muzzleFlash(muzzle);
  audio.shot(weapon.sound);
  viewmodelKick = 1;
  const pitchKick = weapon.recoil * (0.8 + random() * 0.4);
  const yawKick = (random() - 0.5) * weapon.recoil * 0.5;
  player.recoil(pitchKick, yawKick);
  trauma = Math.min(1, trauma + weapon.recoil * 4);

  const shots = weapon.pellets || 1;
  let scoredHit = false;
  for (let p = 0; p < shots; p += 1) {
    const ray = direction.clone();
    ray.x += (random() * 2 - 1) * spread;
    ray.y += (random() * 2 - 1) * spread;
    ray.z += (random() * 2 - 1) * spread;
    ray.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(eyePos, ray);
    const targets = shootables.concat(bots.hitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) continue;
    effects.spawnTracer(muzzle, hit.point, shot ? 4 : 0.07);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dist = hit.distance;
      const falloff = applyDamageFalloff(weapon, dist);
      const headMult = part === 'head' ? weapon.headMult : 1;
      const legMult = part === 'legs' ? 0.75 : 1;
      const dmg = Math.round(weapon.damage * headMult * falloff * legMult);
      damageBotByPlayer(bot, dmg, part);
      hud.hitMarker(part === 'head', shot ? 4000 : 110);
      if (part === 'head') audio.headshot();
      else audio.hit();
      effects.spawnSparks(hit.point, 6, 0xe5484d);
      scoredHit = true;
    } else {
      effects.spawnSparks(hit.point, 5);
    }
  }
  if (weaponState.mag === 0) refreshWeaponHud();
  else hud.setAmmo(weaponState.mag, weaponState.reserve, false);
  return scoredHit;
}

function step(dt) {
  elapsed += dt;
  trauma = Math.max(0, trauma - dt * 2.2);
  viewmodelKick = Math.max(0, viewmodelKick - dt * 8);
  viewmodel.position.z = -0.5 + viewmodelKick * 0.09;
  viewmodel.position.y = -0.24 - viewmodelKick * 0.02;

  const held = input.state.keys;
  const isAiming = input.state.aiming && player.state.alive;
  const wantFov = isAiming ? 74 / WEAPONS[weaponState.id].zoom : 74;
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();

  // Weapon switching and actions.
  const switchCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  const switchIds = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];
  for (let i = 0; i < switchCodes.length; i += 1) {
    const code = switchCodes[i];
    const id = switchIds[i];
    if (input.pressed(code) && owned.has(id) && id !== weaponState.id) equipWeapon(id);
  }
  if (input.pressed('KeyQ')) {
    const cycle = [...owned];
    const following = cycle[(cycle.indexOf(weaponState.id) + 1) % cycle.length];
    equipWeapon(following);
  }
  if (input.pressed('KeyR')) reload();
  if (input.pressed('KeyG')) throwGrenade();
  if (input.pressed('KeyB') && match.state.phase === 'buy') {
    const menu = document.getElementById('buy-menu');
    if (menu.hidden) {
      hud.showBuy(match.state.money, match.state.buyLeft);
      input.releaseLock();
    } else {
      hud.hideBuy();
      input.requestLock();
    }
  }
  if (input.pressed('KeyM')) audio.toggle();

  if (match.state.phase === 'play' && player.state.alive) {
    player.step(dt, held, isAiming);
    const weapon = WEAPONS[weaponState.id];
    const wantFire = weapon.auto ? input.state.firing : input.takeFired();
    if (wantFire) shoot();
    match.interact(dt, held, player.state.position);
  } else if (match.state.phase === 'buy' && player.state.alive) {
    player.step(dt, held, false);
  }

  if (weaponState.reloading && elapsed >= weaponState.reloadEnd) {
    const weapon = WEAPONS[weaponState.id];
    const need = weapon.mag - weaponState.mag;
    const take = Math.min(need, weaponState.reserve);
    weaponState.mag += take;
    weaponState.reserve -= take;
    weaponState.reloading = false;
    refreshWeaponHud();
  }
  weaponState.heat = Math.max(0, weaponState.heat - dt * 0.55);

  // Bots and match.
  player.eyePosition(eyePos);
  const ctx = match.botContext(eyePos, player.groundSpeed());
  const botsActive = match.state.phase === 'play' || match.state.phase === 'buy';
  if (!staging && botsActive) bots.step(dt, elapsed, ctx);
  match.update(dt, elapsed);
  effects.step(dt);
  effects.stepGrenades(dt, explodeGrenade);

  // Track enemies the player can see, for the minimap.
  minimapAt -= dt;
  if (minimapAt <= 0) {
    minimapAt = 0.25;
    player.eyePosition(eyePos);
    for (const bot of bots.bots) {
      if (bot.team !== 'ember' || !bot.alive) continue;
      const d = Math.hypot(bot.position.x - eyePos.x, bot.position.z - eyePos.z);
      const near = d < 45;
      const seen = near && map.losClear(eyePos.x, eyePos.y, eyePos.z, bot.position.x, bot.position.y + 1.2, bot.position.z);
      if (seen) seenEnemies.set(bot.id, { x: bot.position.x, z: bot.position.z, at: elapsed });
    }
    const allies = bots.bots
      .filter((b) => b.team === 'vanguard' && b.alive)
      .map((b) => ({ x: b.position.x, z: b.position.z }));
    const foes = [...seenEnemies.values()].filter((e) => elapsed - e.at < 3);
    hud.drawMinimap({
      minimapRects: map.minimapRects,
      sites: MAP.sites,
      planted: match.state.planted,
      allies,
      enemies: foes,
      player: { x: player.state.position.x, z: player.state.position.z, yaw: player.state.yaw },
    });
  }

  // HUD readouts.
  const weapon = WEAPONS[weaponState.id];
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weaponState.mag, weaponState.reserve, weaponState.reloading);
  const spreadNow = currentSpread(weapon, player.groundSpeed(), player.state.crouching, isAiming);
  hud.setSpread(6 + spreadNow * 900);
  hud.setAlive(match.teamAlive('vanguard'), match.teamAlive('ember'));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const mouse = input.takeLook();
    const sense = input.state.aiming ? 0.0012 : 0.0021;
    const canLook = player.state.alive && (match.state.phase === 'play' || match.state.phase === 'buy');
    if (canLook) player.look(mouse.x, mouse.y, sense);
    accumulator += dt;
    let count = 0;
    while (accumulator >= FIXED_STEP && count < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      count += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // Spectate an alive ally when dead.
    const dead = !player.state.alive && match.state.phase === 'play';
    if (dead) {
      const ally = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
      if (ally) {
        camera.position.set(ally.position.x, ally.position.y + 1.55, ally.position.z);
        camera.rotation.set(0, ally.yaw, 0, 'YXZ');
      }
    } else {
      syncCamera();
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  audio.unlock();
  staging = true;
  if (name === 'start') {
    match.state.phase = 'menu';
    player.state.position.set(-2, 0, 14);
    player.state.yaw = 0.15;
    player.state.pitch = -0.01;
    settle(10);
    aimAt(new THREE.Vector3(0, 2, -6));
    hud.showOverlay('start');
    hud.setScore(0, 0, 1);
    hud.setMoney(800);
    hud.setHealth(100, 0);
    hud.setAmmo(12, 48, false);
    hud.setTimer(100);
  } else if (name === 'buy') {
    match.startMatch();
    match.state.phase = 'buy';
    match.state.buyLeft = 12;
    match.state.money = 3200;
    player.state.position.set(0, 0, 15);
    player.state.yaw = 0;
    settle(10);
    aimAt(new THREE.Vector3(0, 2, -8));
    hud.showBuy(3200, 12);
    hud.setMoney(3200);
  } else if (name === 'play' || name === 'end') {
    match.startMatch();
    match.state.phase = 'play';
    match.state.timeLeft = 82;
    hud.hideBuy();
    // Stage the scene: the player stands mid-lane, one Ember bot in the
    // sights, one ally covering the left lane, a second Ember bot further
    // up mid. The target bot goes to the first candidate spot with a clear
    // line of sight from the player.
    const foes = bots.bots.filter((b) => b.team === 'ember');
    const mate = bots.bots.find((b) => b.team === 'vanguard');
    player.state.position.set(1.5, 0, 9);
    const spots = [[-2.5, -3], [0, -4], [3, -2], [-5, 0], [5, 2], [-1, 4], [6, -6], [-6, -4], [2, 0], [-3, 6], [0, -8]];
    let mark = null;
    if (foes[0]) {
      for (const [x, z] of spots) {
        const clear = map.losClear(1.5, 1.6, 9, x, 1.3, z);
        if (clear) {
          foes[0].position.set(x, 0, z);
          foes[0].yaw = Math.PI;
          foes[0].body.group.position.copy(foes[0].position);
          foes[0].body.group.rotation.y = foes[0].yaw;
          mark = foes[0];
          break;
        }
      }
    }
    if (foes[1]) {
      foes[1].position.set(5.5, 0, -7);
      foes[1].yaw = Math.PI * 0.9;
      foes[1].body.group.position.copy(foes[1].position);
      foes[1].body.group.rotation.y = foes[1].yaw;
    }
    if (mate) {
      mate.position.set(-6, 0, 6);
      mate.yaw = -0.3;
      mate.body.group.position.copy(mate.position);
      mate.body.group.rotation.y = mate.yaw;
    }
    settle(15);
    if (name === 'play') {
      equipWeapon('rifle');
      if (mark) {
        aimAt(new THREE.Vector3(mark.position.x, 1.1, mark.position.z));
        shoot(); // one torso hit: hitmarker, sparks and tracer, bot stays standing
      }
      settle(6);
      hud.setHealth(100, 0);
      hud.announce('Round 1 — plant the charge or eliminate Ember', 4000);
    } else {
      // Round won: two Ember bots down, charge planted at Site A.
      if (foes[0]) bots.damage(foes[0], 500, 'body');
      if (foes[1]) bots.damage(foes[1], 500, 'body');
      match.state.planted = { site: 'A', x: MAP.sites.A.x, z: MAP.sites.A.z, timer: 22 };
      match.state.scoreV = 3;
      match.state.scoreE = 2;
      match.state.money = 4150;
      hud.setScore(3, 2, 6);
      hud.setMoney(4150);
      hud.setCharge(false);
      hud.clearAnnounce();
      player.state.position.set(-19, 0, -1);
      aimAt(new THREE.Vector3(MAP.sites.A.x, 2, MAP.sites.A.z));
      hud.showOverlay('round', {
        title: 'ROUND WON',
        copy: 'Charge detonated at Site A — Vanguard 3 : 2 Ember. $4150 in your pocket.',
      });
    }
    hud.setAlive(match.teamAlive('vanguard'), match.teamAlive('ember'));
  }
  hud.setAmmo(weaponState.mag, weaponState.reserve, false);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) hud.hideOverlay();
  else if (match.state.phase === 'play' || match.state.phase === 'buy') hud.showOverlay('paused');
});

// Click the game to grab the mouse when playing without pointer lock.
renderer.domElement.addEventListener('click', () => {
  if (shot) return;
  const playing = match.state.phase === 'play' || match.state.phase === 'buy';
  if (playing && !input.isLocked()) {
    if (document.getElementById('buy-menu').hidden) input.requestLock();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.setHealth(100, 0);
hud.setAmmo(weaponState.mag, weaponState.reserve, false);
hud.setMoney(match.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(100);
hud.setAlive(4, 4);
hud.showOverlay('start');
syncCamera();
// Read-only handle for automated playtests (and for the finalist review to
// inspect the live match): phase, round, scores, player and bot positions.
window.__game = {
  match: match.state,
  player: player.state,
  bots: bots.bots,
  weapons: WEAPONS,
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
