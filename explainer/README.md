# Oh, I Get It: explainer videos

Complex topics explained with everyday analogies, in several languages from one episode file.

## The everyday way: the episode editor
Open **/explainer/editor.html** on your website (for example `https://<you>.github.io/<repo>/explainer/editor.html`). It works on a phone or a laptop.

- **Change words and prices.** Pick a language tab, open a scene, and edit. The preview updates as you type. Each language has its own words and prices; the animation is shared.
- **Add a language.** Tap **+ Add language** (for example `hi` for Hindi). Every scene starts with a copy of the English, ready to translate. Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali and Gujarati fonts are included.
- **Change the animation.** Change the length of a scene, reorder, duplicate or delete scenes, or add one from the library. Some scenes have their own settings, such as basket items, years and timer seconds.
- **Save.** **Save to GitHub** updates the episode file (add your token once under *GitHub connection*). The **Explainer videos** workflow then builds one video per language, plus a subtitle file and a teleprompter script. Download them from the workflow run.

Unsaved edits are kept on that device as a draft. **Download file** gives you a copy of the episode file.

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

## Scene library
Presenter (you on camera with a branded background), walk into a shop, tap to pay, payment journey, shopping basket, more money chasing the same goods, rising costs, and end card.
A new kind of scene (for example a padlock for an encryption episode) is a new entry in `SCENES` in `engine.js`. After that it is available to every episode and language from the editor.

## Notes
- All prices are illustrative. Keep the "illustrative" notes on screen unless you use checked official data.
- The editor page is public on your website, like the rest of the site. Your GitHub token is stored only in your browser.
- Not done yet: recording yourself into the presenter scenes, and scenes stretching automatically to your recorded voice.
