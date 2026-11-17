// One sealed snapshot in, one finished entry out.
//
//   node main.ts --input <snapshot.json>
//
// Reads the snapshot, builds the radar-3 board, and writes the output that
// the gate checks: board.json and data.js, the dashboard's source and the
// captured screenshots, and dossier.json last, with the judge-visible text
// capped so the dashboard's source stays inside it.
//
// Flags:
//   --input <path>     the snapshot file (required)
//   --out <path>       where the output goes (default: $MAKEFUN_OUTPUT_DIR, else ./out)
//   --model <string>   the model version to write into the dossier (default: radar-3)
//
// Exits 0 when the gate passes, 1 when it fails or the run is unusable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRadar,
  boardIssue,
  buildBoard,
  parseSnapshot,
  SnapshotError,
  dataScript,
  MODEL_VERSION,
  type BoardRow,
  type Snapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

interface Cli {
  input: string | null;
  out: string | null;
  model: string;
}

/** The command line's flags. */
function parseArgs(argv: string[]): Cli {
  const cli: Cli = { input: null, out: null, model: MODEL_VERSION };
  const flags: Array<{ arg: string; set: (v: string) => void }> = [
    { arg: '--input', set: (v) => (cli.input = v) },
    { arg: '--out', set: (v) => (cli.out = v) },
    { arg: '--model', set: (v) => (cli.model = v) },
  ];
  for (let i = 0; i < argv.length; i++) {
    const flag = flags.find((f) => f.arg === argv[i]);
    if (!flag) throw new Error(`unknown argument: ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag.arg} needs a value`);
    flag.set(value);
    i++;
  }
  return cli;
}

function error(message: string): never {
  throw new Error(message);
}

/** Where this file lives, so the dashboard's source is found from any working directory. */
const here = path.dirname(fileURLToPath(import.meta.url));

/** Copy every file in `from` into `to` (creating it), and return the names copied. */
function copyDir(from: string, to: string): string[] {
  fs.mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const sub of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, sub), path.join(dst, sub));
        names.push(`${name}/${sub}`);
      }
    } else {
      fs.copyFileSync(src, dst);
      names.push(name);
    }
  }
  return names;
}

/** Whether a file is an image the output may carry: no GIF, no SVG, no AVIF, no WebP, no BMP. */
const IMAGE = /\.(png|jpe?g)$/i;

/** The screenshots to copy: every image file in the entry's screenshots/ directory, sorted by name. */
function screenshotNames(): string[] {
  const dir = path.join(here, 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => IMAGE.test(name))
    .sort();
}

async function main(): Promise<number> {
  let cli: Cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error('usage: node main.ts --input <snapshot.json> [--out <dir>] [--model <string>]');
    return 1;
  }
  if (cli.input === null) error('--input <snapshot.json> is required');

  const input = path.resolve(cli.input);
  if (!fs.existsSync(input)) error(`no snapshot at ${input}`);
  let snapshot: Snapshot;
  try {
    snapshot = parseSnapshot(fs.readFileSync(input, 'utf8'));
  } catch (e) {
    if (e instanceof SnapshotError) error(`unusable snapshot: ${e.message}`);
    throw e;
  }

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) error(`board fails its own checks: ${issue}`);

  const out = path.resolve(cli.out ?? process.env.MAKEFUN_OUTPUT_DIR ?? path.join(here, 'out'));
  fs.mkdirSync(out, { recursive: true });

  // The board: one row per rank, the whole board in one file.
  const boardJson = `${JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source, model: cli.model, rows: board }, null, 2)}\n`;
  fs.writeFileSync(path.join(out, 'board.json'), boardJson);

  // The dashboard's dataset: the same board in compact form, with the model it runs.
  fs.writeFileSync(path.join(out, 'data.js'), dataScript(radar));

  // The dashboard's source, byte for byte, so the page and the gate read the same files.
  const copied = copyDir(path.join(here, 'dashboard'), path.join(out, 'dashboard'));
  if (copied.length === 0) error('the dashboard directory is empty');

  // The screenshots: the board, the detail view and the filtered view, in that order.
  const shots = screenshotNames();
  if (shots.length > 0) {
    const dir = path.join(out, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of shots) fs.copyFileSync(path.join(here, 'screenshots', name), path.join(dir, name));
  }

  // The dossier last: the judge-visible text is the dashboard's source and the
  // screenshots, capped so the source stays inside it. buildDossier returns
  // the dossier as bytes; the scorer rebuilds it from this output and compares
  // bytes, so it is written exactly as returned.
  const dossierBytes = await buildDossier(out, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  fs.writeFileSync(path.join(out, 'dossier.json'), dossierBytes);

  const tvl = board.reduce((sum, r) => sum + r.tvl_usd, 0);
  const avgSteps = board.reduce((sum, r) => sum + r.farm_steps.length, 0) / board.length;
  const top = board[0]!;
  const lines = [
    `wrote ${out} for ${snapshot.source} @ ${snapshot.as_of}`,
    `board: ${board.length} rows (${radar.watchlist_size} watchlist + ${board.length - radar.watchlist_size} others)`,
    `rows: ${board.length} total, ${board.filter((r) => r.model.multiple_samples > 0).length} priced on a category multiple, ${board.length - board.filter((r) => r.model.multiple_samples > 0).length} on the global median`,
    `model: ${cli.model} — ${radar.multiples.length} category multiples, global ${radar.global_multiple}`,
    `top: #${top.rank} ${top.name} ($${top.implied_value_usd.toLocaleString('en-US')}) at TVL $${top.tvl_usd.toLocaleString('en-US')}`,
    `board TVL: $${(tvl / 1e9).toFixed(1)}B; mean farm steps per row: ${avgSteps.toFixed(1)}`,
    `live tokens shown: ${radar.live.length}`,
    `dashboard files: ${copied.join(', ')}`,
    `screenshots: ${shots.length > 0 ? shots.join(', ') : 'none'}`,
    `dossier: ${dossierBytes.length.toLocaleString('en-US')} bytes written`,
  ];
  console.log(lines.join('\n'));
  return 0;
}

process.exitCode = await main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  return 1;
});
