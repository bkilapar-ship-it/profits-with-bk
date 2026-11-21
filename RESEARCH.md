# Research protocol and ledger (Trade With BK)

Goal: improve the live Uptrend Dip plan's return per unit of drawdown, without fooling ourselves.

## Rules Claude follows when working on its own
1. Research is read-only: scripts download data and write results; they never touch orders or settings.
2. Every experiment is written down BEFORE it runs, with its pass bar (table below). Every result is logged, including failures.
3. Development window: Oct 2016 to 2022. Final test window: 2023 to 2026, looked at ONCE per finalist, never used to pick between variants.
4. Each extra variant tried raises the chance of a lucky result, so the bar rises: a finalist must beat live on return/risk in BOTH 2016-2019 and 2020-2022, keep 70%+ of live return, and cut worst drawdown 25%+. After 30 logged variants the bar becomes 40% drawdown cut.
5. At most 3 batches of experiments before stopping and reporting, unless the owner extends this.
6. Claude NEVER edits live trading settings (paper.yaml env values, paper.js) on its own. It proposes the change with the numbers and waits for the owner's yes.
7. Anything that only passes on one event (e.g. Nov 2026) or one period is reported as such and not adopted.

## Ledger (variants tried so far = 13 risk rules + 7 stop rules + 12 earlier research variants)
| Date | Experiment | Result |
|---|---|---|
| 2026-11-21 | Stop rules: fixed 3-8% vs 3 ATR | None beat live. 4% stop: CAGR 3.1% vs 7.1% |
| 2026-11-21 | Risk rules (13) | Only 7.5% size passed: CAGR 6.5%, worst drawdown -12.0% (live 7.1%, -17.2%) |

| 2026-11-21 | Batch 1 launched: size 9/7.5/6/5%, 7.5%+max-4-open, 7.5%+30% day cap (6 variants; ledger now 38, so the 40% drawdown-cut bar applies) | Size 6% and 5% PASS the 40% bar (6%: keeps 85% of return, drawdown -9.9% vs -17.2%; 5%: keeps 81%, drawdown -8.6%). 7.5% fails only because 2016-19 return/risk is negative for every rule there (noise). Max-4-open and day-cap combos cost too much return. Final exam 2023-26: 5% return/risk 1.07, 6% 1.00, live 0.75. Owner chose 6% on 2026-11-21 (PAPER_SIZE_PCT set to 0.06). |
| 2026-11-21 | Batch 3 launched (volatility-scaled sizing): 6% scaled 0.5-1.5x, 6% scaled 0.33-2x, 5% and 7.5% scaled. Baseline is now the adopted 6% flat. Bar: keep 90%+ of its return, drawdown no worse, return/risk higher overall and not lower in either development period. Ledger now 42 variants. | running |

## Queue (pre-registered, not yet run)
- Batch 1: 7.5% size combined with max-4-open and with 30% day cap; size 5% and 6% to check the curve is smooth.
- Batch 2: does signal-day relative volume or distance above the 200-day average rank signals better (use as ranking, not as a filter).
- Batch 3: dollar-risk sizing (smaller size where ATR is large).
