# Explainer project: Oh, I Get It

Everyday-analogy explainer videos in several languages from one episode file. Read explainer/README.md first.
Episodes: explainer/episodes/*.json. Scene library and engine: explainer/engine.js. Editor: explainer/editor.html. Build workflow: .github/workflows/explainer.yaml.

Rules specific to this channel:
- All prices and numbers are illustrative; keep the "illustrative" notes on screen unless using checked official data.
- No investment recommendations or stock picks here. Keep it clearly separate from the studio channel.
- Recordings ("takes"): scene.lang.<lang>.take, files in the private repo named in channel.json takesRepo (fallback explainer/takes/). A scene with a take follows the voice length (engine.js timeline); render.js mixes the voice in and shows presenter video. See README Notes for what is still open.
When finishing a task, update explainer/README.md (Notes section).
