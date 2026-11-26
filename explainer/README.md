# Oh, I Get It: explainer videos

Complex topics explained with everyday analogies, in several languages from one episode file.

## The everyday way: the episode editor
Open **/explainer/editor.html** on your website (for example `https://<you>.github.io/<repo>/explainer/editor.html`). It works on a phone or a laptop.

- **Change words and prices.** Pick a language tab, open a scene, and edit. The preview updates as you type. Each language has its own words and prices; the animation is shared.
- **Add a language.** Tap **+ Add language** (for example `hi` for Hindi). Every scene starts with a copy of the English, ready to translate. Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali and Gujarati fonts are included.
- **Change the animation.** Change the length of a scene, reorder, duplicate or delete scenes, or add one from the library. Some scenes have their own settings, such as basket items, years and timer seconds.
- **Save.** **Save to GitHub** updates the episode file (add your token once under *GitHub connection*). The **Explainer videos** workflow then builds one video per language, plus a subtitle file and a teleprompter script. Download them from the workflow run.

Unsaved edits are kept on that device as a draft. **Download file** gives you a copy of the episode file.

## Recording yourself and making the final video
Your recordings never leave your phone (or laptop). Only their timings are saved, so the build can time each scene to your voice.

1. Open a scene and tap **🎥 Record yourself** (presenter scenes) or **🎙 Record voice** (every other scene), or **📁 Choose a file** to use a clip you filmed in the camera app. Allow the camera or microphone when the browser asks.
2. When recording: after a 3-2-1 countdown, read the lines on screen, tap **■ Stop**, play it back, then **✓ Use this take** (or **✓ Use it, record next scene ›**, or **↺ Try again**).
3. Tap **Save to GitHub**. The build (about 5 to 10 minutes) makes the animation timed to your voice, with no voice and no picture of you in it.
4. On the **same phone and browser**, tap **🎬 Make video**. It plays through once in real time, adding your voice and camera. Keep the page open and the screen on. Then **Save the video** or **Share…** (YouTube, WhatsApp, Files).

What to know:
- Recordings are kept in that browser's storage. Clearing Safari's website data deletes them, and iPhone may delete them if you do not open the page for about 7 days. Record and make the video within a few days.
- Each scene lasts as long as you speak, plus a short pause before and after; the animation stretches to fit and quiet bits at the start and end are trimmed. Each language has its own recordings. A scene with no recording keeps its fixed length and is silent.
- In presenter scenes your video sits in a rounded frame on the branded background (cropped to fit: keep your head near the middle). Your real background shows inside the frame.
- Phones make a 720p video, laptops 1080p. Long episodes (several minutes) are riskier on a phone.
- Tips: phone at eye level, face a window, quiet room. Works in Safari on iPhone and Chrome on Android or a laptop.

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
| branch `explainer-renders` | The latest soundless video and `timeline.json` per episode and language, used by Make video (published by the build) |

## Scene library
Presenter (you on camera with a branded background), walk into a shop, tap to pay, payment journey, shopping basket, more money chasing the same goods, rising costs, and end card.
A new kind of scene (for example a padlock for an encryption episode) is a new entry in `SCENES` in `engine.js`. After that it is available to every episode and language from the editor.

## Notes
- All prices are illustrative. Keep the "illustrative" notes on screen unless you use checked official data.
- The editor page is public on your website, like the rest of the site. Your GitHub token is stored only in your browser.
- Recording is built (November 2026), with recordings kept on Bharat's device only (his choice: nothing stored in any repository). Earlier same-day versions uploaded takes to GitHub and then to a private repository; both were dropped, and no takes were ever stored.
- How it fits together: a take is `scene.lang.<lang>.take = { file, kind: video|voice, dur, in, out, store: 'device' }`. The file itself is in the browser's IndexedDB (database `oh-i-get-it-takes`), keyed by `file`. `in`/`out` = where the voice starts and ends (measured while recording, or from the sound of a chosen file). Scene length = voice + 0.3s before + 0.5s after (LEAD/TAIL in engine.js).
- The build (render.js) uses only those timings for device takes: soundless video with an empty camera frame, plus `timeline.json` (take times, camera slot, fade, and a fingerprint `sig` from `Explainer.takeSig`). The workflow force-pushes these to the `explainer-renders` branch as one commit with no history. If a real file sits in `explainer/takes/`, render.js still mixes it in itself (trim, loudness, camera frames).
- Make video (editor.html): fetches the build via the GitHub API (ref explainer-renders), checks `sig` matches the editor's current timings, then plays the build into a canvas, draws the camera video into the rounded slot with the scene fades, schedules each voice with Web Audio (loudness evened out, gentle compressor) and records with MediaRecorder. Real time; screen kept on with Wake Lock where available.
- Tested here (headless Chrome with a simulated camera and microphone): record, keep, reload (takes still there), Save (only the episode file was sent), render, Make video (23s video with voice and camera in the right places), and choosing a video file (speech start and end found correctly). Not yet tried on Bharat's real iPhone or Android phone: the first real run is the real test. Known risk carried over from the studio page: iPhone Safari froze on long takes there.
- Still open: publishing straight to YouTube from Make video (the studio page has code for this; for now use Share or Save), removing your real background, captions lined up to exact words, and a full-screen presenter layout.
