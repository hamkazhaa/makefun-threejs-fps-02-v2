// HUD: every DOM readout — health, armour, ammo, money, timer, score, alive counts,
// killfeed, crosshair spread, hitmarker, damage flash, plant progress, the buy menu
// and the start / pause / round / match overlays — plus a live top-down minimap
// drawn on a 2D canvas from the map's cover footprints.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

const BUY_ITEMS = [
  { id: 'rifle', name: 'AR-77 Longshot', price: 2700, key: '1' },
  { id: 'smg', name: 'VK-9 Repeater', price: 1500, key: '2' },
  { id: 'shotgun', name: 'M12 Breacher', price: 1700, key: '3' },
  { id: 'sniper', name: 'LR-90 Deadeye', price: 4750, key: '4' },
  { id: 'pistol', name: 'P9 Sidearm', price: 300, key: '5' },
  { id: 'grenade', name: 'Frag Grenade', price: 300, key: '6' },
  { id: 'armor', name: 'Kevlar Vest', price: 650, key: '7' },
];

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-value'), healthBar: $('health-bar'), armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    money: $('money-value'), timer: $('timer-value'), scoreV: $('score-vanguard'),
    scoreE: $('score-ember'), round: $('round-value'), aliveV: $('alive-vanguard'),
    aliveE: $('alive-ember'), killfeed: $('killfeed'), crosshair: $('crosshair'),
    hitmarker: $('hitmarker'), damage: $('damage-flash'), plant: $('plant-bar'),
    plantFill: $('plant-fill'), plantLabel: $('plant-label'), overlay: $('overlay'),
    overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyMenu: $('buy-menu'), buyList: $('buy-list'),
    buyMoney: $('buy-money'), buyTimer: $('buy-timer'), charge: $('charge'),
    minimap: $('minimap'), announce: $('announce'),
  };
  const mapCtx = els.minimap ? els.minimap.getContext('2d') : null;
  let hitTimer = null;
  let announceTimer = null;

  // Build the buy menu once.
  if (els.buyList) {
    for (const item of BUY_ITEMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.id = item.id;
      const desc = item.id === 'grenade' ? GRENADE.desc : item.id === 'armor' ? ARMOR.desc : WEAPONS[item.id].desc;
      button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${desc}</span><span class="buy-price">$${item.price}</span>`;
      button.addEventListener('click', () => callbacks.onBuy(item.id));
      els.buyList.appendChild(button);
    }
  }
  els.play.addEventListener('click', () => callbacks.onPlay());

  function showOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'HARBOUR LINE';
      els.overlayCopy.innerHTML = 'A round-based tactical shooter on the docks of Port Meridian. Plant the charge at Site A or Site B — or eliminate the Ember team. First to 7 rounds takes the match.<br><br>Click to play. Your team buys between rounds with <b>B</b>.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'The dock waits. Click to get back in.';
      els.play.textContent = 'Resume';
    } else if (kind === 'round') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.copy;
      els.play.textContent = 'Next round';
    } else if (kind === 'match') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.copy;
      els.play.textContent = 'Play again';
    }
  }
  function hideOverlay() { els.overlay.hidden = true; }

  function drawMinimap(state) {
    if (!mapCtx || !state.minimapRects) return;
    const ctx = mapCtx;
    const W = els.minimap.width;
    const H = els.minimap.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
    ctx.fillRect(0, 0, W, H);
    const sx = (x) => ((x + 27) / 54) * W;
    const sz = (z) => ((z + 19) / 38) * H;
    ctx.fillStyle = '#4d5a66';
    for (const r of state.minimapRects) ctx.fillRect(sx(r.x), sz(r.z), Math.max(1, (r.w / 54) * W), Math.max(1, (r.d / 38) * H));
    // Sites.
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    for (const [key, site] of [['A', state.sites.A], ['B', state.sites.B]]) {
      ctx.fillStyle = key === 'A' ? '#2fa8a0' : '#e05a2a';
      ctx.beginPath();
      ctx.arc(sx(site.x), sz(site.z), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(key, sx(site.x), sz(site.z) + 4);
    }
    // Charge.
    if (state.planted) {
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(sx(state.planted.x), sz(state.planted.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dots: player, allies, enemies (only when recently seen).
    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const ally of state.allies) dot(ally.x, ally.z, '#2fa8a0', 2.5);
    for (const enemy of state.enemies) dot(enemy.x, enemy.z, '#e05a2a', 2.5);
    dot(state.player.x, state.player.z, '#ffffff', 3.5);
    // Player facing tick.
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(sx(state.player.x), sz(state.player.z));
    ctx.lineTo(sx(state.player.x) - Math.sin(state.player.yaw) * 8, sz(state.player.z) - Math.cos(state.player.yaw) * 8);
    ctx.stroke();
  }

  return {
    setHealth(health, armor) {
      els.health.textContent = Math.max(0, Math.ceil(health));
      els.healthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
      els.healthBar.classList.toggle('low', health <= 30);
      els.armor.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, reloading) {
      els.ammoMag.textContent = reloading ? '--' : mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(money) { els.money.textContent = `$${money}`; },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('urgent', !!urgent);
    },
    setScore(v, e, round) {
      els.scoreV.textContent = v;
      els.scoreE.textContent = e;
      els.round.textContent = `ROUND ${round}`;
    },
    setAlive(v, e) {
      els.aliveV.textContent = `●`.repeat(v) + `○`.repeat(Math.max(0, 4 - v));
      els.aliveE.textContent = `●`.repeat(e) + `○`.repeat(Math.max(0, 4 - e));
    },
    setSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill, holdMs = 110) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      els.damage.classList.add('on');
      setTimeout(() => els.damage.classList.remove('on'), 220);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const line = document.createElement('div');
      line.className = `feed-line ${killerTeam}`;
      line.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.lastChild);
    },
    announce(text, ms = 2600) {
      els.announce.textContent = text;
      els.announce.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => els.announce.classList.remove('on'), ms);
    },
    clearAnnounce() {
      clearTimeout(announceTimer);
      els.announce.classList.remove('on');
    },
    setPlant(progress, label) {
      if (progress == null) {
        els.plant.hidden = true;
        return;
      }
      els.plant.hidden = false;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
      els.plantLabel.textContent = label;
    },
    setCharge(carrying) {
      els.charge.hidden = !carrying;
    },
    showBuy(money, seconds) {
      els.buyMenu.hidden = false;
      els.buyMoney.textContent = `$${money}`;
      els.buyTimer.textContent = `Buy phase — ${Math.ceil(seconds)}s — press B or click to close`;
      for (const button of els.buyList.children) {
        button.classList.toggle('poor', Number(button.querySelector('.buy-price').textContent.slice(1)) > money);
      }
    },
    hideBuy() { els.buyMenu.hidden = true; },
    buyFlash(ok) {
      els.buyMenu.classList.remove('ok', 'no');
      void els.buyMenu.offsetWidth;
      els.buyMenu.classList.add(ok ? 'ok' : 'no');
    },
    showOverlay, hideOverlay,
    drawMinimap,
  };
}
