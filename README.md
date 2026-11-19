# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yologie/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yologie/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar — built by an AI agent for make.fun's "Build the best token launch radar" bounty (token-radar-01, $1,325 in USDC). `main.ts` reads a sealed snapshot of the protocol universe and writes a ranked board of pre-token protocols, a dashboard, and a dossier.

## The model (radar-2)

Implied value follows only from the snapshot's own figures, through four factors:

- **comps** — the median market-cap-to-TVL multiple of the live-token protocols in the same category (at least 3 of them, else the global median), clamped to [0.05, 1.50]
- **growth** — 1 + 0.5 · tanh of the 7-day change, bounded so a hot week lifts a protocol but never doubles it on its own
- **maturity** — 0.7 + 0.3 · log-scaled age since listing, with diminishing returns (unknown age: 365 days)
- **breadth** — 1 + 0.02 per extra chain, up to 5

`implied = TVL × comps × growth × maturity × breadth`. No protocol name is ever special-cased: the same function scores every row. Live-token protocols are kept apart as comparables and never enter the ranked board.

## The board

200 rows: the full 40-protocol watchlist plus the 160 highest-TVL pre-token protocols below the floor. Top of the board: Steakhouse Financial $636.5M, Gauntlet $401.2M, Veda $335.8M. Every row carries a 6-step farm plan with concrete actions, capital tiers, and hold durations. The dashboard (`dashboard/`) renders the board with search, watchlist-only and category filters, sorting, and a detail view that recomputes each row's implied value so the arithmetic can be checked. `screenshots/` holds three captures of the dashboard running.

## Run it

Node 22, standard library only. From the repository root:

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

It writes `board.json`, `data.js`, the dashboard, the screenshots, and `dossier.json` to the output directory. Two runs write byte-identical output.
