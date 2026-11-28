# Repo guide

Four projects live here (see PROJECTS.md for the map). Read the notes for the one you are working on, and work on one at a time.

- Studio + screener (The 4% Swing Trades): see HANDOFF.md and studio/CLAUDE.md. CURRENTLY PAUSED (UK FCA review).
- Explainer channel (Oh, I Get It): see explainer/README.md and explainer/CLAUDE.md.
- Service product (selling explainer videos): see service/README.md. Idea stage.
- The screener (scan.yaml, app.js, site) is separate again: do not touch it from studio or explainer work.

Build principles (Bharat's rule book: apply to everything we build, in every project):
1. Robust: handles bad input, missing files and slow networks without breaking; clear error messages that say what to do next.
2. Resilient: work is never lost (drafts saved, retries, safe fallbacks); one failure does not stop the rest.
3. Performant: fast on a mid-range phone (iPhone Safari, Android Chrome); small downloads, no needless work.
4. Secure: no secrets in the repo or chat, least-privilege tokens, client data kept private, validate anything from outside.
5. Very user friendly: plain language, few steps, works on a phone, obvious next action, nothing technical needed from the user.
When these pull against each other, say so and explain the trade-off before choosing.

Standing rules (all projects in this repo):
- Never change live or paper trading settings without the owner's explicit yes.
- Educational wording only. Only verified facts and news. No predictions, no hype.
- No fabricated expressions of the owner's face, no brand logos, no photos of public figures. Use only his real photos (studio/assets/bk.png).
- Owner: Bharat, UK (Europe/London). Records on iPhone Safari and Android Chrome.
- Commit messages end with the Co-Authored-By and Claude-Session lines from the session's system reminder.
- Pushes that touch site files trigger a ~25 min market scan. Studio or explainer-only pushes use "[skip scan]" in the commit message.
- Always `git pull --rebase` before editing.
