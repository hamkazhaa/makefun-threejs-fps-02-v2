// Visual effects, pooled so the hot loops allocate nothing: tracer lines, impact
// sparks, muzzle flash, explosion smoke and thrown frag grenades. A tracer is one
// thin stretched box; sparks are small points that fade.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 400;

export function createEffects(scene, colliders) {
  const tracerPool = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp, transparent: true, opacity: 0.9 });
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracerPool.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;

  const particleGeo = new THREE.BufferGeometry();
  const particlePos = new Float32Array(MAX_PARTICLES * 3);
  const particleVel = new Float32Array(MAX_PARTICLES * 3);
  const particleLife = new Float32Array(MAX_PARTICLES);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  const particleMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95 });
  const points = new THREE.Points(particleGeo, particleMat);
  points.frustumCulled = false;
  scene.add(points);
  let particleIndex = 0;

  const flash = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
  scene.add(flash);
  let flashLife = 0;

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.4, metalness: 0.7 });
  const tmp = new THREE.Vector3();

  function spawnTracer(from, to, life = 0.07) {
    const t = tracerPool[tracerIndex];
    tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
    const dir = tmp.copy(to).sub(from);
    const len = dir.length();
    if (len < 0.1) return;
    t.mesh.position.copy(from).addScaledVector(dir, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = life;
  }

  function spawnSparks(at, count, color = 0xffc46b) {
    particleMat.color.setHex(color);
    for (let n = 0; n < count; n += 1) {
      const i = particleIndex;
      particleIndex = (particleIndex + 1) % MAX_PARTICLES;
      particlePos[i * 3] = at.x;
      particlePos[i * 3 + 1] = at.y;
      particlePos[i * 3 + 2] = at.z;
      particleVel[i * 3] = (Math.random() - 0.5) * 6;
      particleVel[i * 3 + 1] = Math.random() * 4 + 1;
      particleVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
      particleLife[i] = 0.4 + Math.random() * 0.3;
    }
    particleGeo.attributes.position.needsUpdate = true;
  }

  function spawnExplosion(at) {
    spawnSparks(at, 90, 0xff8a3c);
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x555049, transparent: true, opacity: 0.5 }),
    );
    smoke.position.copy(at);
    scene.add(smoke);
    let life = 0.9;
    const id = setInterval(() => {
      life -= 0.1;
      smoke.scale.multiplyScalar(1.25);
      smoke.material.opacity = Math.max(0, life * 0.5);
      if (life <= 0) {
        clearInterval(id);
        scene.remove(smoke);
        smoke.geometry.dispose();
        smoke.material.dispose();
      }
    }, 100);
    flash.position.copy(at);
    flash.intensity = 60;
    flashLife = 0.18;
  }

  function throwGrenade(from, direction) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      velocity: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 2.2,
      bounced: 0,
    });
  }

  function stepGrenades(dt, onExplode) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= 14 * dt;
      const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
      // Simple bounce: stop the axis that entered a collider.
      const probe = new THREE.Box3(
        new THREE.Vector3(next.x - 0.09, next.y - 0.09, next.z - 0.09),
        new THREE.Vector3(next.x + 0.09, next.y + 0.09, next.z + 0.09),
      );
      let blocked = false;
      for (const c of colliders) {
        if (probe.intersectsBox(c)) { blocked = true; break; }
      }
      if (blocked) {
        g.velocity.multiplyScalar(-0.4);
        g.velocity.y = Math.abs(g.velocity.y) * 0.4 + 1;
        g.bounced += 1;
      } else {
        g.mesh.position.copy(next);
      }
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * 0.4;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      if (g.fuse <= 0) {
        const at = g.mesh.position.clone();
        scene.remove(g.mesh);
        grenades.splice(i, 1);
        spawnExplosion(at);
        onExplode(at);
      }
    }
  }

  function step(dt) {
    for (const t of tracerPool) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (particleLife[i] > 0) {
        particleLife[i] -= dt;
        particlePos[i * 3] += particleVel[i * 3] * dt;
        particlePos[i * 3 + 1] += particleVel[i * 3 + 1] * dt;
        particlePos[i * 3 + 2] += particleVel[i * 3 + 2] * dt;
        particleVel[i * 3 + 1] -= 9 * dt;
        if (particlePos[i * 3 + 1] < 0.03) particlePos[i * 3 + 1] = 0.03;
        anyAlive = true;
      } else {
        particlePos[i * 3 + 1] = -100;
      }
    }
    if (anyAlive) particleGeo.attributes.position.needsUpdate = true;
    if (flashLife > 0) {
      flashLife -= dt;
      if (flashLife <= 0) flash.intensity = 0;
    }
  }

  return {
    spawnTracer, spawnSparks, spawnExplosion, throwGrenade, stepGrenades, step,
    muzzleFlash(at) {
      flash.position.copy(at);
      flash.intensity = 26;
      flashLife = 0.05;
    },
  };
}
