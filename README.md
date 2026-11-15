# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by an implied value computed from a
frozen DefiLlama snapshot, and shows a reader how to farm each one. The
board covers every protocol on the snapshot's watchlist and adds the
pre-token protocols below that floor, strongest first. Implied value is a
model — TVL, seven-day growth, age with no token, and how many chains the
protocol runs on — never a hand-picked list of names. Live-token protocols
are set aside with their market caps, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

The program reads the snapshot, writes the ranked board to
`out/board.json`, the dashboard's data to `out/data.js`, and copies
`dashboard/` and `screenshots/` to `out/`, then writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
