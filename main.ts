// Entry point for the threejs-fps-02 bounty (Node 22, standard library
// only). The game itself lives in the game/ folder beside this file: plain
// static files that the browser loads as ES modules, with three.js resolved
// through an import map. This program does one job — it hands the game in.
// It copies game/ and screenshots/ into /output and writes
// /output/dossier.json, the summary the judge reads, using the vendored
// make.fun library in vendor/makefun-threejs.ts.
//
// The game is "Harbour Line": a round-based tactical FPS on the docks of
// Port Meridian. Two teams fight short rounds, Vanguard plants a charge at
// Site A or Site B, money flows between rounds into a buy menu, and bots
// route, hold, engage, plant and defuse while gunfire rewards stopping to
// aim. Try it locally with `node serve.ts`, then open
// http://localhost:8080. Outside the grader, MAKEFUN_OUTPUT_DIR takes the
// place of /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The scorer's caps (reference/gate.json). Only text_max_bytes changes the
// dossier's bytes; the other limits simply refuse an entry the scorer would
// refuse anyway — more than 4 screenshots, or one larger than 256 KiB; more
// than 993 files under game/, or 48 MiB of game files in total. game/ counts
// against /output's own 1000-entry ceiling alongside screenshots/ and
// dossier.json, so the copy above has to leave them room.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
const dossier = buildDossier(outDir, caps);
writeFileSync(join(outDir, 'dossier.json'), dossier);
