// Weapons: five original guns plus a frag grenade. Each weapon is data — damage,
// fire rate, spread, recoil, range, price — and one small viewmodel built from
// boxes, so the gun the player sees matches the gun the code fires. Spread grows
// with movement and with sustained fire and shrinks when crouched or aiming down
// sights: stopping to aim pays.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 300,
    damage: 34, headMult: 4, fireInterval: 0.16, auto: false,
    mag: 12, reserve: 48, reloadTime: 1.1, spread: 0.011, moveSpread: 0.02,
    recoil: 0.011, range: 60, zoom: 1, sound: 'pistol', desc: 'Reliable sidearm. Free with every loadout.',
  },
  smg: {
    id: 'smg', name: 'VK-9 Repeater', kind: 'smg', price: 1500,
    damage: 26, headMult: 4, fireInterval: 0.075, auto: true,
    mag: 25, reserve: 100, reloadTime: 1.6, spread: 0.016, moveSpread: 0.028,
    recoil: 0.008, range: 45, zoom: 1, sound: 'smg', desc: 'Fast close-quarters spray. Punishes wild fire.',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, fireInterval: 0.11, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.1, spread: 0.008, moveSpread: 0.024,
    recoil: 0.013, range: 80, zoom: 1.15, sound: 'rifle', desc: 'The all-round rifle. Accurate when still.',
  },
  sniper: {
    id: 'sniper', name: 'LR-90 Deadeye', kind: 'sniper', price: 4750,
    damage: 88, headMult: 2.2, fireInterval: 1.15, auto: false,
    mag: 5, reserve: 15, reloadTime: 2.8, spread: 0.001, moveSpread: 0.06,
    recoil: 0.05, range: 120, zoom: 2.6, sound: 'sniper', desc: 'One shot, one kill — if you hold still.',
  },
  shotgun: {
    id: 'shotgun', name: 'M12 Breacher', kind: 'shotgun', price: 1700,
    damage: 12, headMult: 2, fireInterval: 0.85, auto: false, pellets: 8,
    mag: 6, reserve: 24, reloadTime: 2.4, spread: 0.045, moveSpread: 0.02,
    recoil: 0.035, range: 22, zoom: 1, sound: 'shotgun', desc: 'Eight pellets. Devastating up close.',
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, desc: 'Cooks 2.2 s, then 120 damage in 5 m.' };
export const ARMOR = { id: 'armor', name: 'Kevlar Vest', price: 650, desc: '+50 armor, absorbs half of each hit.' };

// A boxy first-person viewmodel, built from the weapon's kind: long barrel for the
// rifle and sniper, short body for the pistol and SMG, wide tube for the shotgun.
export function buildViewmodel(camera, weaponId) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x333a42, roughness: 0.45, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.85, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2fa8a0, roughness: 0.5, metalness: 0.3, emissive: 0x2fa8a0, emissiveIntensity: 0.35 });
  function part(w, h, d, x, y, z, material = dark) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  if (weaponId === 'pistol') {
    part(0.05, 0.07, 0.3, 0, 0, -0.15);
    part(0.045, 0.12, 0.06, 0, -0.08, 0.02, grip);
    part(0.055, 0.015, 0.05, 0, 0.045, -0.28, accent);
  } else if (weaponId === 'shotgun') {
    part(0.09, 0.09, 0.55, 0, 0, -0.2);
    part(0.07, 0.07, 0.4, 0, -0.02, -0.32);
    part(0.07, 0.12, 0.16, 0, -0.09, 0.05, grip);
    part(0.095, 0.02, 0.08, 0, 0.055, -0.4, accent);
  } else if (weaponId === 'sniper') {
    part(0.06, 0.08, 0.7, 0, 0, -0.28);
    part(0.05, 0.05, 0.1, 0, 0.06, -0.2);
    part(0.06, 0.06, 0.12, 0, 0.075, -0.18, accent);
    part(0.05, 0.13, 0.07, 0, -0.09, 0.02, grip);
  } else {
    part(0.07, 0.09, 0.5, 0, 0, -0.22);
    part(0.05, 0.14, 0.06, 0, -0.1, -0.12, grip);
    part(0.06, 0.05, 0.22, 0, -0.06, -0.3);
    part(0.075, 0.02, 0.06, 0, 0.055, -0.42, accent);
    if (weaponId === 'smg') part(0.05, 0.05, 0.14, 0, -0.09, -0.32, grip);
  }
  group.position.set(0.28, -0.24, -0.5);
  group.scale.setScalar(0.85);
  camera.add(group);
  return group;
}

export function createWeaponState() {
  return {
    id: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    reloading: false,
    reloadEnd: 0,
    lastShot: -10,
    heat: 0, // sustained-fire bloom, 0..1
    grenades: 0,
  };
}

// Current spread in radians: base + movement + heat, reduced by crouch and ADS.
export function currentSpread(weapon, speed, crouching, aiming) {
  let spread = weapon.spread + weapon.moveSpread * Math.min(1, speed / 5.4) + weapon.heat * 0.02;
  if (crouching) spread *= 0.7;
  if (aiming) spread *= 0.45;
  return spread;
}

export function applyDamageFalloff(weapon, distance) {
  if (distance <= weapon.range * 0.5) return 1;
  if (distance >= weapon.range) return 0.5;
  return 1 - 0.5 * ((distance - weapon.range * 0.5) / (weapon.range * 0.5));
}
