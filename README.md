# My App

Josh's Hub, a web app for his iPhone home screen. The app lives in `v2/`.

The old Hub was retired on Nov 26, 2026. The address at the top now opens the new Hub, and the old offline helper (`sw.js`) only switches itself off. The old app's files are kept in this repo's history.

Every update goes to the `v2-next` branch first; the "New Hub check" runs the phone check and moves it to `main` (live) only if it passes.
