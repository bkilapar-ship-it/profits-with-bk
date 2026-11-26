# Explainer project: Oh, I Get It

Everyday-analogy explainer videos in several languages from one episode file. Read explainer/README.md first.
Episodes: explainer/episodes/*.json. Scene library and engine: explainer/engine.js. Editor: explainer/editor.html. Build workflow: .github/workflows/explainer.yaml.

Rules specific to this channel:
- All prices and numbers are illustrative; keep the "illustrative" notes on screen unless using checked official data.
- No investment recommendations or stock picks here. Keep it clearly separate from the studio channel.
- Recordings ("takes") stay on the owner's device (IndexedDB); the episode file only has their timings (scene.lang.<lang>.take). The build times scenes to them and publishes soundless video + timeline.json to the explainer-renders branch; the editor's Make video adds voice and camera in the browser. Never upload takes anywhere. See README Notes.
When finishing a task, update explainer/README.md (Notes section).
