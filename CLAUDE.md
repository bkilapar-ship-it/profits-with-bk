# Repo guide

Four projects live here (see PROJECTS.md for the map). Read the notes for the one you are working on, and work on one at a time.

- Studio + screener (The 4% Swing Trades): see HANDOFF.md and studio/CLAUDE.md. CURRENTLY PAUSED (UK FCA review).
- Explainer channel (Oh, I Get It): see explainer/README.md and explainer/CLAUDE.md.
- Service product (selling explainer videos): see service/README.md. Idea stage.
- The screener (scan.yaml, app.js, site) is separate again: do not touch it from studio or explainer work.

Standing rules (all projects in this repo):
- Never change live or paper trading settings without the owner's explicit yes.
- Educational wording only. Only verified facts and news. No predictions, no hype.
- No fabricated expressions of the owner's face, no brand logos, no photos of public figures. Use only his real photos (studio/assets/bk.png).
- Owner: Bharat, UK (Europe/London). Records on iPhone Safari and Android Chrome.
- Commit messages end with the Co-Authored-By and Claude-Session lines from the session's system reminder.
- Pushes that touch site files trigger a ~25 min market scan. Studio or explainer-only pushes use "[skip scan]" in the commit message.
- Always `git pull --rebase` before editing.
