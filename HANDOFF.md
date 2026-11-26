# Handoff notes (written 2026-11-26 for a new chat)

Owner: Bharat (UK). Repo: bkilapar-ship-it/profits-with-bk (GitHub Pages site + studio + explainer).
Standing rules: never change live/paper trading settings without the owner's explicit yes; educational wording only; only verified news;
no fabricated faces, no brand logos, no photos of public figures. Commit trailers: Co-Authored-By + Claude-Session lines. Studio-only pushes use "[skip scan]".

## Where things stand (26 Nov 2026)
Paused because of UK FCA financial-promotion risk (the daily script names stocks with entry/target/stop). Nothing in the scripts changed yet.
- studio/PAUSED exists: studio.yaml builds nothing while it exists (delete the file to resume).
- studio.yaml schedule cron lines commented out (restore the two lines to resume).
- Scheduled tasks switched off: "Daily draft script" (trig_01X6vV4hqW2dEC4qkZKv13zQ), "Daily market research" (trig_01RH4WKgtUfDU9F3prh44teP; its prompt still says "Trade With BK" / plain English).
- Screener (scan.yaml) and site untouched and still running.
- Regulatory notes: FCA financial promotions restriction (FSMA s21) applies to content reachable by UK viewers; criminal offence, up to 2 years / unlimited fine.
  Recommendation was to get a UK financial-regulation solicitor's opinion before resuming named daily picks.

## Studio (daily "The 4% Swing Trades" video) in studio/
make.js, lib/script.js (episode scripts), lib/render.js (scenes, thumbnails), lib/draft.js (pre-close draft), combine.html (Publish page, Shorts builder, add-on clips),
lib/teleprompter.js, popover.js (like/subscribe), anim.js (beta animated visuals, off by default). Draft mode: third line `draft` in research-trigger/studio.txt.
Latest work: glowing news thumbnail, bigger logo everywhere, big-logo "small channel" ask scene, daily briefing opener with portrait ring (studio/assets/bk.png).
Open ideas: Shorts layout (captions take 30-40%), ticker/sector badges (no logos), Instagram Reels sharing, iPhone Safari freeze on long takes (undiagnosed).

## New channel "Oh, I Get It" (explainer videos) in explainer/
Built on the studio infrastructure by a separate session (commit 75178a6). Read explainer/README.md.
Episode files explainer/episodes/*.json (inflation, tap-to-pay; English + Telugu), editor at /explainer/editor.html, engine.js scene library,
workflow .github/workflows/explainer.yaml renders one video, subtitles and script per language.
Not done: recording yourself into presenter scenes, scenes auto-stretching to recorded voice.
