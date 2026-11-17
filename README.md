# Token Radar — which pre-token protocol launches next

A ranked board of the pre-token protocols in a sealed DefiLlama snapshot,
scored by the value a token would imply from the snapshot's own figures.

## The model (radar-3)

Implied value = TVL × category multiple × growth × maturity.

- **Category multiple**: the median market-cap / TVL of the token-bearing
  protocols in the same category, shrunk toward the global median (k = 4) so a
  thin category cannot set the price alone. Categories with fewer than three
  comparables use the global median. The multiples are computed from the
  snapshot at build time, never typed in.
- **Growth**: the 7-day change, clamped to −50% … +100%, weighted 0.6×.
- **Maturity**: 0.6 for a new protocol, rising to 1.0 at three years.
- **Cap**: the implied value never exceeds three times TVL.

The board ranks every rankable pre-token protocol: the 40-protocol watchlist
plus every other protocol that is pre-token, not an exchange, not a versioned
pool, and not a wrapped, staked or bridged product of a token that already
trades. Protocols whose token already trades are shown apart, by market cap.

## Run it

```sh
node main.ts --input <snapshot.json> [--out <dir>]
```

Writes `board.json`, `data.js`, the dashboard, the screenshots and
`dossier.json` (last) into the output directory. Exits 0 when the board
passes its own checks, 1 when it does not.

## Files

- `main.ts` — the runner: snapshot in, finished entry out.
- `lib/model.ts` — the radar-3 model: multiples, implied values, farm plans.
- `dashboard/` — the page: board, live-token view, model explainer, detail
  drawer with the full derivation and a seven-step farm plan per protocol.
- `screenshots/` — the board, the detail view and the filtered view.
- `vendor/makefun-board.ts` — the board library the competition kit ships.

## License

MIT. See LICENSE.
