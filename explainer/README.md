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
- Teleprompter (26 Nov): while you record a scene, the line to read lights up in time with the animation, the next line is shown below it, a small animation plays alongside, and a Pace slider (0.6x to 1.6x) slows or speeds the prompter. The video still follows your actual voice.
- Make video on this device (26 Nov): the editor draws every frame, encodes video and sound (WebCodecs) and packs an MP4 on the phone, with your voice and camera. No GitHub build needed; GitHub is optional (Save to GitHub only stores the episode file). Camera takes also keep a separate voice-only copy (`.aud`) because phones decode that reliably. Needs iOS 17+ Safari or recent Chrome. The older build-based method is still there as a button. Muxer: explainer/vendor/mp4-muxer.js (MIT).
- Upload to YouTube (26 Nov): after Make video, a card uploads the MP4 straight from the phone (private or unlisted) with a Google sign-in. Uses the same Google OAuth client ID as the studio page (remembered under the same site storage key). Pick the Oh, I Get It channel when Google asks which account/channel. Captions upload is not done yet.

- Presenter layouts "Standing in front of the banner" (cut-out of you, no box) and "Soft edges": the cut-out uses MediaPipe selfie segmentation (vendor/selfie, Apache-2.0), run on the device by cutout.js. If it cannot start, the video falls back to soft edges. The Make video step takes longer with the cut-out.

- Step-card scenes and Shorts (Nov 2026): the `cards` scene type (engine.js) shows 2 to 4 pictures with short words, one by one; items are written as `picture | title | small words` (use / for a new line, add ! to the picture to highlight a card). Pictures are plain drawings, no brand logos. The episode `agentic-payments` uses it. An episode file can list suggested Shorts as `shorts: [{ title:{en}, scenes:[zero-based scene numbers] }]`. In the editor's Video tab, "Make Shorts" makes a vertical 9:16 video on the device from the ticked scenes (title on top, scene pictures in the middle, big captions underneath, your voice), with its own YouTube upload (#Shorts). The channel name is now "Oh, I Get It!!" (channel.json).
- Nov 2026 (later): every step-card scene shows the channel logo top-left; the `outro` scene type is the animated like / share / subscribe end scene (cursor taps Subscribe, it turns grey, the bell rings); the Make Shorts card has Start and End sliders for each ticked scene (the maker keeps only that stretch of picture and voice).
- Popups behind the presenter: the presenter scene has a Popups field (one per line: line number | picture | word); each appears when that spoken line starts and fades away, behind the cut-out picture of you. Used in the agentic-payments intro.
- Shorts speed: the Make Shorts card shows the Short's length at 1x, 1.2x and 1.5x and has a Speed choice (1x to 1.5x). Picture, captions and voice are sped up together; the voice keeps its pitch (overlap-add time stretching in editor.html, speedUp()).

## Teleprompter (recording)
Same style as the studio: the whole script is one colour and scrolls past a fixed dashed reading line (30% down the box). Speed is set in words per minute (- / + in steps of 5, 80 to 220, remembered as `exWpm`). The animation and popups follow the same clock, so they stay in step when the speed changes. Pause/Resume, Mirror and Text size are on the recorder. Popups now sit in the side margins (x 130 and 1790) so the presenter's body never covers them.

## Trim a recording, and big visuals in Side by side
- Under "Your recording" each scene now has Start and End sliders (0.05 s steps, plus - / + nudges). Moving End plays the last 3 seconds so you can stop before you reach for the camera. "Back to the automatic trim" undoes it.
- In the presenter scene with the Side by side or Circle layout, the popups lines (line number | picture | word) show BIG on the empty half, one spoken line at a time (two or three pictures sit side by side). Other layouts keep the small popups beside you.

## Animated story beside you (presenter, Side by side / Circle)
Set "Animated story beside you" to the shops story: two shops with their tags (cheapest detergent and soap, best quality milk and cheese), a person walking back and forth ("Two shops? Such a hassle..."), then the AI agent visiting both shops with ticks, filling a basket and "Paid for you". It follows the spoken lines 3 to 6 (change the start with `storyFrom` in the scene data). Lines before that still use the big popups.

## Thumbnails
Video tab, "Thumbnails" card: 1280x720 video thumbnail and 1080x1920 Short thumbnail drawn on a canvas (no external images). Your photo (default explainer/assets/bk.png, a copy of studio/assets/bk.png, or an uploaded one kept in this browser only) is cut out with the same on-device tool as the video and sits on the left or right with a glow outline. Three headline lines, a small tag, optional shopping robot, saves as PNG (share sheet on iPhone). The photo is used as it is: no edits to the face. Words are saved per episode in this browser (`ex.thumb.<id>`).

## My video in any scene, and the new end scene
- Every scene except the presenter has "My video in this scene": a round bubble (bottom right or left) or Side by side (the scene shrinks to one side, your video beside it). Recording that scene then records your camera, and Make video puts you in the frame (`cam` in the scene data, `Explainer.camSlot`).
- The end scene (outro) with three spoken lines is animated per line: a robot shopping (line 1), comments appearing (line 2), then like, share and subscribe with the bell (line 3). Headings per line: `head1`, `head2`, `heading`. With fewer than three lines it plays the old like/share/subscribe animation.

## Cards follow the script
Step cards appear when the spoken line they belong to starts (same timing as the captions, so it follows your recording). A card can name its line with an optional 4th part: `phone | Add your card | Like a wallet | 2` (line 2). Several cards on the same line come in one after another across that line. Without the 4th part the cards share the last lines in order.

## Animation matched to your voice
EXPERIMENTAL and OFF by default (it made well-timed scenes worse). Tapping "Match animation to my voice (experimental)" on a scene listens for the pauses between lines, saves `take.marks` and sets `take.marksOn`; "Back to automatic timing" undoes it. Without `marksOn` lines are spread by their length, as before. Tip: leave a short pause (a breath) between lines when you record.

## Line timing (exact sync)
- While recording a scene with several lines, tap **Next line ▶** the moment you start each new line. The animation then follows your real voice (take.marks, marksOn).
- Under every recording, "⏱ Line timing" lets you type the second where each line starts (▶ plays from just before it). "Back to automatic timing" returns to the length-based estimate, which stays the default.

## Custom Shorts (own script, own recording)
`episodes/short-robot-shopping.json` and `short-cheapest-total.json` are one-scene episodes written for Shorts. Record the scene, set the line times, then Video tab, Shorts, tick scene 1. New presenter stories (data.story): `agentshop` (you say what you need, the agent visits both shops, totals, limit, winner, question) and `compare` (two price boards, totals, winner, agent). `storyFrom` is the line where the story starts (it uses that line plus the next four).

## Instagram Reels
Configuration > Instagram connection (account ID, token, token type, API version; stored only on the device). Video tab: "Post Reel to Instagram" under the YouTube card. Flow: the video is committed to a spare `ig-media` branch of the repo via the GitHub connection, Instagram is asked to fetch it (`video_url`), the container is polled until FINISHED, published, and the temporary file is deleted. Needs a Professional Instagram account. Unverified on a real account: browser CORS to graph.instagram.com/graph.facebook.com, and whether Instagram accepts the raw.githubusercontent.com content type (application/octet-stream).

## Motion beta (opt-in, off by default)
Tick **Motion beta** in the editor header to try it. It only changes the feel, never the timing, so your line sync is untouched.
- Smoother start and stop on all eased moves (cubic instead of quadratic).
- Scenes glide in (slight rise and scale-up with ease-out), drift very slowly while on screen, and ease out at the end.
- Captions pop in with a small overshoot, then settle.
- Scenes that carry your video stay still so the gold frame matches your camera.
Applies to the preview and the finished video. Also settable per episode with `"motion":"beta"` in the JSON. Research notes: ease-out for entrances, one focal element at a time, short anticipation, restrained overshoot, consistent easing (duck.design, motion principles guides).
