// Token Radar, model radar-2: the entry program for make.fun's token-radar-01.
//
// It reads the sealed snapshot (a directory holding snapshot.json, or the file itself), scores
// every rankable pre-token protocol with the model in lib/model.ts, and writes the ranked board,
// the dashboard data, the dashboard and screenshots, and the dossier the judge reads. The program
// never touches the network: the dashboard is static and reads the data file this program writes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as model from './lib/model.ts';
import * as boardLib from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const GATE = {
  textMaxBytes: 65_536,
  screenshots: { max: 4, maxBytes: 524_288 },
  dashboard: { maxFiles: 400, maxBytes: 4_194_304 },
};

const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A fatal run problem: the message goes to stderr and the process exits with `code`. */
class RunError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

const fail = (message: string, code: number): never => {
  throw new RunError(message, code);
};

/** --input/--output out of the arguments, reduced into one options object. */
const parseArgs = (argv: string[]): { input: string; output: string } =>
  argv.reduce(
    (opts, token, i, all) => {
      const [flag, inline] = token.split('=', 2);
      const value = inline ?? all[i + 1];
      return flag === '--input' && value !== undefined
        ? { ...opts, input: value }
        : flag === '--output' && value !== undefined
          ? { ...opts, output: value }
          : opts;
    },
    { input: '/input', output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output' },
  );

/** The snapshot file: a .json path as given, else snapshot.json inside the directory. */
const resolveInput = (input: string): string =>
  input.endsWith('.json') ? input : path.join(input, 'snapshot.json');

/** One directory's regular files copied into `to`, skipping names that start with a dot. */
const copyFiles = (from: string, to: string): string[] => {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  return fs
    .readdirSync(from)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => fs.statSync(path.join(from, name)).isFile())
    .map((name) => {
      fs.copyFileSync(path.join(from, name), path.join(to, name));
      return name;
    });
};

/** The whole run: read, score, check, write. Returns the two lines the run reports. */
const main = (): string[] => {
  const { input, output } = parseArgs(process.argv.slice(2));
  const inputFile = resolveInput(input);
  if (!fs.existsSync(inputFile)) {
    fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const snapshot = model.parseSnapshot(fs.readFileSync(inputFile, 'utf8'));
  const { board, radar } = model.buildRadar(snapshot);
  const issue = model.boardIssue(board, snapshot);
  if (issue !== null) {
    fail(`token radar: the model wrote a board the gate refuses: ${issue}`, 1);
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  fs.writeFileSync(path.join(output, 'data.js'), model.dataScript(radar));
  const dash = copyFiles(path.join(here, 'dashboard'), path.join(output, 'dashboard'));
  const shots = copyFiles(path.join(here, 'screenshots'), path.join(output, 'screenshots'));
  if (shots.length < 3) {
    fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  shots.forEach((name) => {
    if (!IMAGE_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  });
  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
// Writing it before the screenshots are checked would let a bad board pass as a good dossier.
  fs.writeFileSync(
    path.join(output, 'dossier.json'),
    boardLib.buildDossier(output, {
      text_max_bytes: GATE.textMaxBytes,
      screenshots: { max: GATE.screenshots.max, max_bytes: GATE.screenshots.maxBytes },
      dashboard: { max_files: GATE.dashboard.maxFiles, max_bytes: GATE.dashboard.maxBytes },
    }),
  );
  return [
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
    `token radar: wrote ${path.join(output, 'board.json')}, ${path.join(output, 'data.js')}, ${path.join(output, 'dashboard')} (${dash.length} files), ${path.join(output, 'screenshots')} (${shots.length} images) and ${path.join(output, 'dossier.json')}`,
  ];
};

try {
  main().forEach((line) => process.stdout.write(`${line}\n`));
} catch (e) {
  if (e instanceof RunError) {
    process.stderr.write(`${e.message}\n`);
    process.exit(e.code);
  }
  throw e;
}
