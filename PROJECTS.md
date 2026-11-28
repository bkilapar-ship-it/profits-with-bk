# The four projects (set up 27 Nov 2026)

| # | Project | What it is | Where it lives now | Status |
|---|---------|-----------|--------------------|--------|
| 1 | **Trade with BK engine** ("4% Swing Trades") | The screener, research scripts, paper trading, the public site | `index.html`, `app.js`, `style.css`, `scanner/`, `research-trigger/`, workflows `scan`, `paper`, `peek`, `open-bars`, `*-research`, `alert-test` | Running |
| 2 | **Studio** | Daily "4% Swing Trades" video builder | `studio/`, workflow `studio.yaml` | PAUSED (UK FCA review) |
| 3 | **Oh, I Get It!!** channel | Explainer editor, engine, episodes, Shorts, YouTube and Instagram posting | `explainer/`, workflow `explainer.yaml` | Active |
| 4 | **Service product** | Selling finished explainer videos (and later the tool) to others | `service/` (notes) and its own repo `OneTake-studio` (the studio) | Idea stage, stage 1 built |

## Why the code is not physically split into four repositories yet
This was checked before deciding. Splitting tonight would break working things:
- The public site deploy (`scan.yaml`) copies `explainer/` into the published site, so the editor runs at `/explainer/editor.html`.
- The editor saves to GitHub using fixed paths (`explainer/...`) in this repository.
- Projects 1 and 2 share workflows, secrets and the `paper-state` branch.
So each project is a clearly fenced folder with its own notes, and one rule file (`CLAUDE.md`) says what each session may touch.

## Working rules per project
- Open a session for one project only; read that project's notes first.
- Project 1: never change live or paper trading settings without the owner's explicit yes. Site pushes trigger a ~25 min scan.
- Project 2: stays paused. Do not edit.
- Project 3: pushes use `[skip scan]`. Educational wording, verified facts only.
- Project 4: see `service/README.md`.

## Proper split later (when you decide), in this order
1. Project 3 first: new repo, its own Pages site, editor paths changed from `explainer/` to repo root, `explainer.yaml` moved.
2. Project 4 starts in its own repo from day one.
3. Projects 1 and 2 last (secrets, `paper-state` branch, alerts); needs your explicit yes.
