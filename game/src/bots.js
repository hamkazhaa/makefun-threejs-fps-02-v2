// The other nine agents on the dock. A bot is a small box-built humanoid
// — head (the headshot target), torso, legs, a rifle — dressed in its
// team's colour. Each one thinks in states: it follows a route across the
// map's waypoint graph, holds a spot, fights an enemy it can see, plants
// the charge, defuses it, or pulls back when badly hurt. Bots hear shots,
// take a human-like moment to react, and aim worse at range and at a moving
// target, so a player who stops, aims, and picks the moment wins duels.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './map.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.74;
const BOT_SPEED = 3.7;
const EYE = 1.55;

const VANGUARD_NAMES = ['Rook', 'Haven', 'Sable'];
const EMBER_NAMES = ['Cinder', 'Ash', 'Flint', 'Onyx'];

// The spawn tables live here, next to the bots that use them, and match.js
// reads the same coordinates from MAP, so the two files always agree.
const SPAWNS = { vanguard: MAP.vanguardSpawn, ember: MAP.emberSpawn };

// Shortest path over the waypoint graph: plain Dijkstra with a linear scan
// for the nearest unvisited node. The graph is small, so this is plenty.
function dijkstra(nodes, start, goal) {
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  dist[start] = 0;
  for (let round = 0; round < nodes.length; round += 1) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      if (!done[i] && dist[i] < bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best === -1) break;
    done[best] = true;
    if (best === goal) break;
    for (const edge of nodes[best].edges) {
      const via = dist[best] + edge.cost;
      if (via < dist[edge.to]) {
        dist[edge.to] = via;
        prev[edge.to] = best;
      }
    }
  }
  if (dist[goal] === Infinity) return [];
  const path = [];
  for (let cur = goal; cur !== -1; cur = prev[cur]) path.unshift(cur);
  return path;
}

// Assemble one bot's visible body out of boxes and return its named parts.
function assembleBody(scene, team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: team === 'vanguard' ? 0x2c3a44 : 0x453029,
    roughness: 0.85,
    metalness: 0.1,
  });
  const accentColor = team === 'vanguard' ? PALETTE.teal : PALETTE.ember;
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.5,
    metalness: 0.2,
    emissive: accentColor,
    emissiveIntensity: 0.5,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.9 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.4, metalness: 0.6 });
  function part(w, h, d, x, y, z, material, parent = group) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const legL = part(0.16, 0.78, 0.2, -0.11, 0.39, 0, suit);
  const legR = part(0.16, 0.78, 0.2, 0.11, 0.39, 0, suit);
  const torso = part(0.52, 0.62, 0.3, 0, 1.08, 0, suit);
  part(0.54, 0.1, 0.32, 0, 1.32, 0, accent); // shoulder stripe
  const head = part(0.26, 0.26, 0.26, 0, 1.56, 0, skin);
  part(0.28, 0.08, 0.28, 0, 1.7, 0, accent); // helmet band
  const armL = part(0.12, 0.5, 0.14, -0.32, 1.12, 0.08, suit);
  const armR = part(0.12, 0.5, 0.14, 0.32, 1.12, 0.08, suit);
  const gun = part(0.07, 0.1, 0.62, 0.18, 1.18, -0.3, gunMetal);
  armL.rotation.x = -0.9;
  armR.rotation.x = -0.9;
  scene.add(group);
  return { group, head, torso, legL, legR, gun };
}

export function createBots(scene, map, callbacks) {
  const bots = [];
  const colliders = map.colliders;
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  // Would a bot-sized box at (x, y, z) intersect any solid collider?
  function blocked(x, y, z) {
    probe.min.set(x - BOT_RADIUS, y + 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + BOT_HEIGHT - 0.05, z + BOT_RADIUS);
    for (const c of colliders) {
      if (probe.intersectsBox(c)) return true;
    }
    return false;
  }

  // The connected waypoint nearest a point on the ground.
  function closestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    map.nodes.forEach((n, i) => {
      if (n.edges.length === 0) return; // never route from an isolated node
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // Copy a bot's logical position and facing onto its visible body.
  function placeBody(bot) {
    bot.body.group.position.set(bot.position.x, bot.body.group.position.y, bot.position.z);
    bot.body.group.rotation.y = bot.yaw;
  }

  function makeBot(team, name, spawn, index) {
    const body = assembleBody(scene, team);
    const bot = {
      id: `${team}-${index}`,
      team,
      name,
      body,
      position: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: spawn.yaw,
      health: 100,
      alive: true,
      state: 'route',
      path: [],
      pathIndex: 0,
      targetNode: -1,
      holdUntil: 0,
      lastSeen: null, // {enemy, at}
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      aimError: 0.02,
      walkPhase: Math.random() * 6,
      thinkAt: Math.random() * 0.2,
      channel: null, // {type: 'plant'|'defuse', until, at}
      carrying: false,
      speed: BOT_SPEED * (0.92 + Math.random() * 0.16),
      damageFlash: 0,
    };
    body.group.position.copy(bot.position);
    body.group.rotation.y = bot.yaw;
    body.head.userData = { bot, part: 'head' };
    body.torso.userData = { bot, part: 'body' };
    body.legL.userData = { bot, part: 'legs' };
    body.legR.userData = { bot, part: 'legs' };
    bots.push(bot);
    return bot;
  }

  function setRoute(bot, x, z) {
    const from = closestNode(bot.position.x, bot.position.z);
    const to = closestNode(x, z);
    bot.path = dijkstra(map.nodes, from, to);
    bot.pathIndex = 0;
    bot.targetNode = to;
  }

  // Walk toward the current waypoint. Returns true once the whole route is
  // done. Movement is axis-separated so a bot slides along walls instead of
  // sticking on them, and it is clamped inside the dock.
  function walkRoute(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = map.nodes[bot.path[bot.pathIndex]];
    const stepX = node.x - bot.position.x;
    const stepZ = node.z - bot.position.z;
    const stepLen = Math.hypot(stepX, stepZ);
    if (stepLen < 0.6) {
      bot.pathIndex += 1;
      bot.stuckTime = 0;
      bot.lastDist = undefined;
      return bot.pathIndex >= bot.path.length;
    }
    // Stuck detection: if we stop closing on the waypoint, skip it — a node
    // can sit just behind a container corner the bot cannot round.
    if (bot.lastDist !== undefined && stepLen > bot.lastDist - 0.05) {
      bot.stuckTime = (bot.stuckTime || 0) + dt;
      if (bot.stuckTime > 1.2) {
        bot.pathIndex += 1;
        bot.stuckTime = 0;
        bot.lastDist = undefined;
        return bot.pathIndex >= bot.path.length;
      }
    } else {
      bot.stuckTime = 0;
    }
    bot.lastDist = stepLen;
    const vx = (stepX / stepLen) * bot.speed;
    const vz = (stepZ / stepLen) * bot.speed;
    const nx = bot.position.x + vx * dt;
    if (!blocked(nx, bot.position.y, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + vz * dt;
    if (!blocked(bot.position.x, bot.position.y, nz)) bot.position.z = nz;
    bot.position.x = Math.max(-25.4, Math.min(25.4, bot.position.x));
    bot.position.z = Math.max(-17.4, Math.min(17.4, bot.position.z));
    const targetYaw = Math.atan2(-stepX, -stepZ);
    let dyaw = targetYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += dyaw * Math.min(1, dt * 6);
    return false;
  }

  // A bot's eye position, reusing one scratch vector.
  function eye(bot) {
    return tmp.set(bot.position.x, bot.position.y + EYE, bot.position.z);
  }

  // Can this bot see a point? Within range, roughly in front of it, and
  // with a clear line of sight.
  function sees(bot, x, y, z) {
    const ox = x - bot.position.x;
    const oy = y - (bot.position.y + EYE);
    const oz = z - bot.position.z;
    const range = Math.hypot(ox, oy, oz);
    if (range > 55) return false;
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const toTarget = new THREE.Vector3(ox, 0, oz).normalize();
    const inFront = forward.dot(toTarget) >= 0.1 || range <= 4;
    if (!inFront) return false;
    return map.losClear(bot.position.x, bot.position.y + EYE, bot.position.z, x, y, z);
  }

  // Decide where a bot should go next when it has no fight to take.
  function chooseGoal(bot, ctx) {
    if (bot.team === 'vanguard') {
      // Vanguard pushes a site; the carrier heads for the nearer one, the
      // others split between the two at random.
      const site = ctx.planted
        ? null
        : bot.carrying
          ? ctx.nearSite(bot)
          : Math.random() < 0.5
            ? ctx.sites.A
            : ctx.sites.B;
      if (site) {
        setRoute(bot, site.x, site.z);
        bot.state = 'route';
        return;
      }
      // Nothing to push: hunt the last known enemy position.
      setRoute(bot, ctx.enemyLastX ?? 0, ctx.enemyLastZ ?? 0);
      bot.state = 'route';
      return;
    }
    // Ember holds near a site, spread across both of them.
    const site = bot.id.endsWith('0') || bot.id.endsWith('2') ? ctx.sites.A : ctx.sites.B;
    const holdX = site.x + (Math.random() * 6 - 3);
    const holdZ = site.z + 3 + Math.random() * 4;
    setRoute(bot, holdX, holdZ);
    bot.state = 'route';
    bot.holdSite = site;
  }

  // Fire at an enemy in short bursts, after a reaction delay, with
  // distance-based inaccuracy. Hits and misses both draw a tracer.
  function fireAt(bot, enemy, dt, now) {
    if (now < bot.reactAt) return;
    if (bot.burstLeft <= 0) {
      if (now < bot.nextShotAt) return;
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.nextShotAt = now + 0.7 + Math.random() * 0.6;
    }
    if (now < bot.nextShotAt - 0.6) return;
    bot.nextShotAt = now + 0.13;
    bot.burstLeft -= 1;
    const target = enemy.eyePos.clone();
    target.y -= 0.25; // aim at the chest
    const from = new THREE.Vector3(bot.position.x, bot.position.y + 1.35, bot.position.z);
    const dist = from.distanceTo(target);
    const error = 0.012 + dist * 0.0016 + (enemy.speed || 0) * 0.003;
    const hitChance = Math.max(0.1, Math.min(0.62, 0.55 - dist * 0.007));
    const hit = Math.random() < hitChance;
    const head = hit && Math.random() < 0.14;
    let end;
    if (hit) {
      end = target.clone();
      const damageAmount = Math.round((head ? 44 : 22) * (dist > 30 ? 0.75 : 1));
      if (enemy.isPlayer) callbacks.onPlayerHit(damageAmount, bot, head);
      else callbacks.onBotHit(bot, enemy.bot, damageAmount, head);
    } else {
      end = target.clone();
      end.x += (Math.random() - 0.5) * dist * error * 4;
      end.y += (Math.random() - 0.5) * dist * error * 4 + 0.3;
      end.z += (Math.random() - 0.5) * dist * error * 4;
    }
    callbacks.onTracer(from, end);
    callbacks.onShotSound(bot, dist);
    bot.body.gun.position.z = -0.24;
    setTimeout(() => {
      bot.body.gun.position.z = -0.3;
    }, 60);
  }

  // Hurt a bot. Returns true if the hit killed it. A bot that is shot turns
  // toward the shooter, and one below 35 health pulls back instead of
  // fighting on.
  function hurt(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.damageFlash = 1;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.body.group.rotation.x = -Math.PI / 2;
      bot.body.group.position.y = 0.25;
      return true;
    }
    if (bot.health < 35 && bot.state !== 'engage') {
      bot.state = 'fallback';
      bot.holdUntil = 0;
    }
    return false;
  }

  function step(dt, now, ctx) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      // Walk-cycle animation.
      bot.walkPhase += dt * 9;
      const sway = Math.sin(bot.walkPhase) * 0.45;
      bot.body.legL.rotation.x = sway;
      bot.body.legR.rotation.x = -sway;
      if (bot.damageFlash > 0) {
        bot.damageFlash -= dt * 4;
        bot.body.torso.material.emissive.setHex(0x881111);
        bot.body.torso.material.emissiveIntensity = Math.max(0, bot.damageFlash);
      }

      // Perception runs on a staggered timer: scan for the nearest visible
      // enemy and engage it, or give up the fight once it has been out of
      // sight for a while.
      if (now >= bot.thinkAt) {
        bot.thinkAt = now + 0.15 + Math.random() * 0.1;
        let mark = null;
        let markDist = Infinity;
        for (const foe of ctx.enemiesOf(bot)) {
          if (!foe.alive) continue;
          const p = foe.eyePos;
          const d = Math.hypot(p.x - bot.position.x, p.y - (bot.position.y + EYE), p.z - bot.position.z);
          if (d < markDist && sees(bot, p.x, p.y, p.z)) {
            mark = foe;
            markDist = d;
          }
        }
        if (mark) {
          if (!bot.lastSeen) bot.reactAt = now + 0.35 + Math.random() * 0.35;
          bot.lastSeen = { enemy: mark, at: now };
          bot.state = 'engage';
        } else if (bot.state === 'engage') {
          if (bot.lastSeen && now - bot.lastSeen.at > 2.5) {
            bot.lastSeen = null;
            bot.state = 'route';
            chooseGoal(bot, ctx);
          }
        }
      }

      // Plant and defuse channels: the bot stands still until the timer
      // runs out, then the callback resolves the round.
      if (bot.channel) {
        if (now >= bot.channel.until) {
          const kind = bot.channel.type;
          bot.channel = null;
          if (kind === 'plant') callbacks.onPlanted(bot);
          else callbacks.onDefused(bot);
        } else {
          continue;
        }
      }

      if (bot.state === 'engage' && bot.lastSeen) {
        const foe = bot.lastSeen.enemy;
        if (!foe.alive) {
          bot.lastSeen = null;
          bot.state = 'route';
          chooseGoal(bot, ctx);
          placeBody(bot);
          continue;
        }
        const eye = foe.eyePos;
        const dx = eye.x - bot.position.x;
        const dz = eye.z - bot.position.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let dyaw = targetYaw - bot.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        bot.yaw += dyaw * Math.min(1, dt * 8);
        const dist = Math.hypot(dx, dz);
        // Keep a fighting distance: close in when far away, back off when
        // the enemy is point blank.
        if (dist > 16) {
          walkRoute(bot, dt) || setRoute(bot, eye.x, eye.z);
        } else if (dist < 3) {
          const nx = bot.position.x + Math.sin(bot.yaw) * bot.speed * dt;
          const nz = bot.position.z + Math.cos(bot.yaw) * bot.speed * dt;
          if (!blocked(nx, bot.position.y, bot.position.z)) bot.position.x = nx;
          if (!blocked(bot.position.x, bot.position.y, nz)) bot.position.z = nz;
        }
        fireAt(bot, foe, dt, now);
        placeBody(bot);
        continue;
      }

      if (bot.state === 'fallback') {
        // Run back toward the team's spawn, then rejoin the attack or defence.
        setRoute(bot, 0, bot.team === 'vanguard' ? 15 : -15);
        if (walkRoute(bot, dt)) {
          bot.state = 'route';
          chooseGoal(bot, ctx);
        }
        placeBody(bot);
        continue;
      }

      // Route and hold behaviour.
      if (bot.state === 'route') {
        if (bot.path.length === 0) chooseGoal(bot, ctx);
        const arrived = walkRoute(bot, dt);
        if (arrived) {
          // At a site with the charge: start planting it.
          if (bot.carrying && ctx.plantSite) {
            const site = ctx.plantSite(bot);
            if (site) {
              bot.channel = { type: 'plant', until: now + 3, at: now };
              bot.state = 'planting';
              continue;
            }
          }
          // At a planted charge as a defender: start defusing it.
          if (ctx.planted && bot.team === 'ember') {
            bot.channel = { type: 'defuse', until: now + 5, at: now };
            bot.state = 'defusing';
            continue;
          }
          bot.state = 'hold';
          bot.holdUntil = now + 3 + Math.random() * 4;
          // Sweep the lane while holding.
          bot.yaw += (Math.random() - 0.5) * 1.2;
        }
      } else if (bot.state === 'hold') {
        if (now >= bot.holdUntil) {
          bot.state = 'route';
          chooseGoal(bot, ctx);
        } else {
          bot.yaw += Math.sin(now * 0.5 + bot.walkPhase) * dt * 0.4;
        }
      } else if (bot.state === 'planting' || bot.state === 'defusing') {
        // The channel above handles this; nothing else to do.
      } else {
        chooseGoal(bot, ctx);
      }

      placeBody(bot);
    }
  }

  // Clear every bot body from the scene and spawn a fresh set for a round.
  // On even rounds the first Vanguard bot carries the charge.
  function respawnAll(round, carrier) {
    for (const bot of bots) scene.remove(bot.body.group);
    bots.length = 0;
    SPAWNS.vanguard.forEach((spawn, i) => {
      const bot = makeBot('vanguard', VANGUARD_NAMES[i], spawn, i);
      bot.body.group.userData.isBotBody = true;
      if (carrier === 'vanguard-0' && i === 0) bot.carrying = true;
    });
    SPAWNS.ember.forEach((spawn, i) => {
      const bot = makeBot('ember', EMBER_NAMES[i], spawn, i);
      bot.body.group.userData.isBotBody = true;
    });
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function hitMeshes() {
    const meshes = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      meshes.push(bot.body.head, bot.body.torso, bot.body.legL, bot.body.legR);
    }
    return meshes;
  }

  function carrier() {
    return bots.find((b) => b.carrying && b.alive) || null;
  }

  return { bots, step, damage: hurt, respawnAll, aliveCount, hitMeshes, carrier };
}
