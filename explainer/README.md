# Oh, I Get It: explainer videos

Complex topics explained with everyday analogies, in several languages from one episode file.

## The everyday way: the episode editor
Open **/explainer/editor.html** on your website (for example `https://<you>.github.io/<repo>/explainer/editor.html`). It works on a phone or a laptop.

- **Change words and prices.** Pick a language tab, open a scene, and edit. The preview updates as you type. Each language has its own words and prices; the animation is shared.
- **Add a language.** Tap **+ Add language** (for example `hi` for Hindi). Every scene starts with a copy of the English, ready to translate. Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali and Gujarati fonts are included.
- **Change the animation.** Change the length of a scene, reorder, duplicate or delete scenes, or add one from the library. Some scenes have their own settings, such as basket items, years and timer seconds.
- **Save.** **Save to GitHub** updates the episode file (add your token once under *GitHub connection*). The **Explainer videos** workflow then builds one video per language, plus a subtitle file and a teleprompter script. Download them from the workflow run.

Unsaved edits are kept on that device as a draft. **Download file** gives you a copy of the episode file.

## Recording yourself
Each scene card has a **Your recording** box, for the language tab you are on.

1. Add your GitHub token once under *GitHub connection* (recordings are uploaded as soon as you keep them, to your private recordings repository).
2. Open a scene and tap **🎥 Record yourself** (presenter scenes) or **🎙 Record voice** (every other scene). Allow the camera or microphone when the browser asks.
3. Tap **● Start recording**. After a 3-2-1 countdown, read the lines shown on screen, then tap **■ Stop**.
4. Play it back. Tap **✓ Use this take**, or **✓ Use it, record next scene ›** to go straight on, or **↺ Try again**.
5. When all scenes are done, tap **Save to GitHub**. The videos are built with your voice in them.

What happens to a recording:
- The scene lasts as long as you speak, plus a short pause before and after. The animation stretches to fit. Quiet bits at the start and end are trimmed.
- Each language has its own recordings. A Telugu scene never uses the English recording. A scene with no recording keeps its fixed length and has no voice.
- In presenter scenes your video appears in a rounded frame on the branded background (cropped to fit, so keep your head near the middle). Your real background shows inside the frame.
- Your voice is evened out in loudness. Captions are spread over the time you speak, longer lines getting more time.
- Tips: phone at eye level, face a window, quiet room, earphones with a mic help. Works in Safari on iPhone and Chrome on Android or a laptop.

## Files
| File | What it is |
|---|---|
| `episodes/<name>.json` | One episode: languages, scenes, and each scene's words and prices per language |
| `episodes/index.json` | The list of episodes the editor shows |
| `channel.json` | Channel name and tagline per language |
| `engine.js` | The scene library and animation engine (the only file that needs code changes for a new kind of scene) |
| `editor.html` | The episode editor |
| `player.html`, `render.js` | Turn an episode into videos: `node explainer/render.js explainer/episodes/inflation.json [--lang te]` |
| `fonts/` | Free fonts (SIL Open Font License) |
| `channel.json` → `takesRepo` | The private repository that holds your recordings (`takes/<episode>/<language>/`) |

## Scene library
Presenter (you on camera with a branded background), walk into a shop, tap to pay, payment journey, shopping basket, more money chasing the same goods, rising costs, and end card.
A new kind of scene (for example a padlock for an encryption episode) is a new entry in `SCENES` in `engine.js`. After that it is available to every episode and language from the editor.

## Notes
- All prices are illustrative. Keep the "illustrative" notes on screen unless you use checked official data.
- The editor page is public on your website, like the rest of the site. Your GitHub token is stored only in your browser.
- Recording is built (November 2026). In the editor: Record yourself / Record voice per scene and language, with a teleprompter and countdown; the take uploads right away; a recording on its own does not start a video build, saving the episode does. Preview plays your recording in step with the animation.
- Recordings are kept private (Bharat's choice): they go to the private repository named in `channel.json` → `takesRepo` (set to `bkilapar-ship-it/oh-i-get-it-recordings`, editable under GitHub connection in the editor), under `takes/<episode>/<language>/`. Takes stored there are marked `"store": "private"`. The preview fetches them with the token. The workflow clones that repository using the Actions secret `TAKES_TOKEN` and passes `--takes-root explainer-takes` to render.js. Without the secret, the build still works but warns, and scenes keep their fixed length. With `takesRepo` empty, recordings go to `explainer/takes/` in this public repository instead.
- Setup Bharat needs to do once: create the private repository, give his editor token access to it (Contents read and write), and add the same token as the Actions secret `TAKES_TOKEN` in profits-with-bk.
- The finished videos in the workflow download are still on the public repository's Actions page, as before. Raw takes are not.
- How a recording works: `scene.lang.<lang>.take = { file, kind: video|voice, dur, in, out }`. `in`/`out` are where your voice starts and ends, measured by the editor while recording (render.js finds them itself if missing). Scene length = voice + 0.3s before + 0.5s after (LEAD/TAIL in engine.js). render.js decodes each take, trims, evens out loudness, mixes it in with the sound effects, and draws presenter video frames into the camera frame.
- Tested here with simulated camera and microphone (headless Chrome): record, keep, upload, save and render all worked, video and voice in the right places. Not yet tried on Bharat's real iPhone or Android phone: the first real recording is the real test.
- Old takes stay in the recordings repository when you record again; they are harmless but take space.
- Still open: removing or replacing your real background (it shows inside the frame for now), a full-screen presenter layout, cleaning up unused old takes, and lining captions up to the exact words (they are spread evenly over your speaking time).
