# Explainer Studio (service product, stage 1)

A self-serve studio that clients use in their own browser to make animated explainer videos in **their own brand**.
Built 28 Nov 2026 from a copy of the channel editor (`explainer/`). The channel itself is unchanged.

## What a client does
1. **My brand:** name, tagline, end-of-Short words, website, three colours (or a ready-made set) and an optional logo.
2. **Script and scenes:** write what they will say in each scene, then record it on their phone or laptop (the words scroll like a teleprompter).
3. **Make the video:** the studio makes the MP4 on their device. They also get a vertical Short, a captions file (.srt), the script (.txt) and thumbnails (16:9 and 9:16).
4. **My videos and backup:** start, copy or delete videos, download a backup file, open a backup file, move the brand kit to another device, or wipe everything.

## How it meets the build principles
- **Robust:** the brand kit is checked by `brand.js` (text trimmed and capped, colours checked, a background that is too light is darkened so white writing stays readable, and accent colours are lightened until they stand out). Opened files are checked before use: size limits, known scene types only, at most 60 scenes, and safe language codes. Clear messages say what to do next.
- **Resilient:** every edit is saved on the device as you go. Recordings and the last finished video and Short survive a reload. The studio asks the browser for persistent storage and shows how much space is used. Backups are one tap away.
- **Performant:** everything runs on the device with no server round trips. Phones make 720p and laptops make 1080p. Fonts load only for the scripts in use.
- **Secure and private:** no accounts, tokens or uploads. Scripts, recordings, logos and finished videos never leave the client's browser. A strict Content Security Policy only allows the page's own files, so nothing can be sent elsewhere. Logos are always redrawn as a small PNG, which strips any scripts or hidden data. The page asks search engines not to index it, and it sends no referrer.
- **User friendly:** four numbered tabs, a welcome screen for first-time users, plain-language help and a live preview while the brand is being set up.

## Files
| File | What it is |
|---|---|
| `index.html` | The studio (copied from `explainer/editor.html`; GitHub, YouTube, Instagram and the build-based method removed; brand tab, backup tab and file checks added) |
| `brand.js` | Brand kit checks, colour presets, logo processing |
| `engine.js` | Copy of the channel engine. All colours go through one colour map (`themeMap` in `el()`), and the logo is the client's logo, or their initials in a circle |
| `cutout.js`, `vendor/`, `fonts/` | The same on-device person cut-out, MP4 muxer and free fonts (licences are in the folders) |

Storage on the device: `localStorage` keys start with `svc.` and recordings are in IndexedDB `svc-studio-takes`. These are kept apart from the channel editor's data, even on the same website.

## Tested (headless Chrome, simulated camera and microphone, phone and laptop sizes)
Brand setup (the logo is refused until permission is ticked, and a light background is darkened automatically), live branded preview, recording a scene, making a 26-second 1080p video, making a 9-second vertical Short, the thumbnail, keeping the finished video after a reload, opening a broken file (refused with a clear message) and opening a real episode file. No page errors.
**Not yet tried on a real iPhone or Android phone.** The channel editor's notes apply: iOS 17+ Safari or recent Chrome is needed. iPhone may clear website data after about 7 days without a visit.

## Known limits (stage 1)
- The copy will not pick up future channel improvements automatically. Copy them across deliberately.
- One brand per browser. A brand kit file moves it to another device.
- Fonts: DM Sans and the bundled Noto Sans scripts only.
- No accounts, payments or cloud saving. These are stage 2 and need a hosting service and payment provider in Bharat's name, plus a privacy policy and terms.
- Not published yet: the site deploy (`scan.yaml`) only publishes the channel and screener. The plan is a new repository with its own GitHub Pages site.
- The scene library still includes the channel's shopping and price scenes. They are generic, but some clients will want other scenes.
