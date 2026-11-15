# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by an implied value computed from a frozen DefiLlama snapshot, and shows a reader how to farm each one. The board covers all 40 watchlist protocols and adds every other pre-token protocol that meets the field guide's definition, strongest first. Live-token protocols are set aside with their market caps, never mixed into the ranking.

## How it ranks

Implied value is one function of the snapshot figures, the same for every protocol:

```
implied = round(TVL x 0.25 x growth x maturity x chains)
growth   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4
chains   = 1 + 0.02 x min(chains - 1, 10)
```

TVL is the size of the economy that would back a token. Seven-day growth is momentum. Maturity is how long the protocol has run with no token. Chains is reach: more chains means a wider holder base for the eventual token, at most a 20% premium. No protocol name is special-cased. A protocol ranks only if it records no token and is not a wrapped, staked, or bridged product of a token that already trades, per the field guide's own rule.

Each row carries an eight-step farm plan with what it costs and how long it takes, derived from the protocol's category, chains, TVL, and age. The dashboard also has a model sandbox: change a constant and the board re-ranks at once with the same function.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The program reads the snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

## Outputs

- `board.json`: the ranked board, one row per pre-token protocol with its implied value, model breakdown, and farm plan.
- `data.js`: the dashboard's dataset, as one script the page reads with no network.
- `dashboard/`: the static page: board, detail view, filtered view, live-token view, and model sandbox.
- `dossier.json`: the dossier the judge reads, built with the vendored make.fun library.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
