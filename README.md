# My App

An empty app shell for iPhone. It's a web app that gets added to the home screen, so it opens full screen like a real app.

## Files

- `index.html` — the screens and the bottom tab bar
- `styles.css` — the dark mode look
- `app.js` — tab switching and the sign-on screen
- `hubdb.js` — lets the app's pages read and save their data through the data box
- `store.js` — reads and saves the app's data in the private data box (a separate private repo)
- `vault.js` — saves the app's data on the device, scrambled with your username + password
- `sw.js` — offline support
- `manifest.webmanifest` + `icons/` — app name and icon

## Privacy

The code here is an empty frame. Your sign-on and everything you save stay on your own device and are never written into this repo.

## Put it on an iPhone

1. Turn on GitHub Pages: Settings → Pages → Deploy from a branch → `main` / `(root)`.
2. Open the Pages link in Safari.
3. Share → Add to Home Screen.
