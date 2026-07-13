# 🍜 NomNom Log — AI Calorie Scanner

A cute, completely free calorie & nutrition tracker that runs as a mobile web app.
Snap a photo of your food and the AI figures out what it is, estimates the calories
and macros, and tells you how nutritious it is — then logs it into your daily tracker.

## ✨ Features

- **📸 AI food scanner** — take a photo (or pick from your gallery) and Claude's
  vision API identifies the dish and estimates calories, protein, carbs, fat,
  fiber, sugar and sodium, with a confidence badge and adjustable portion size.
- **🌱 Nutrition verdict** — every food gets a friendly badge: *Great choice!*,
  *Okay in moderation*, or *Treat — enjoy occasionally!*, with a one-line reason
  based on nutrient density (protein & fiber up, sugar & sodium down).
- **🏠 Daily tracker** — animated calorie progress ring against your target,
  macro bars, micro-nutrient chips, a chronological food log with edit/delete,
  and a little mascot that cheers you on.
- **🎯 Manual target** — set your own daily calorie target (and optional protein
  target) in Settings.
- **🗓️ Calendar overview** — monthly view color-coded by whether each day stayed
  within target, with per-day detail, 7-day averages and a logging streak.
- **✏️ Manual entry** — works fully offline and without any API key.
- **💸 Completely free** — no accounts, no backend, no tracking. All data stays
  in your browser's local storage.

## 📱 Install on iPhone (or any phone)

1. Host the folder anywhere static (GitHub Pages works great) and open it in
   **Safari** on iOS / Chrome on Android.
2. Tap **Share → Add to Home Screen**. It installs as a standalone app with its
   own icon, splash color and offline support (via a service worker).

## 🔑 Enabling the AI scanner

The scanner calls the Anthropic API directly from your browser:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com).
2. In the app, open **Settings → AI scanner** and paste the key.

The key is stored only in your device's local storage and is sent only to
Anthropic (`api.anthropic.com`) when you analyze a photo. Scans use the
`claude-opus-4-8` model with structured outputs, so each scan costs a fraction
of a cent of your own API credit. Without a key, everything except the scanner
still works.

## 🛠️ Development

No build step — plain HTML/CSS/JS. Serve locally with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Note: the camera and service worker require HTTPS (or `localhost`).

### Project layout

```
index.html            app shell (4 tabs: Today / Scan / Calendar / Settings)
css/style.css         pastel theme, light & dark mode, iOS safe areas
js/app.js             storage, tracker, scanner (Claude vision API), calendar
sw.js                 offline app-shell cache
manifest.webmanifest  PWA manifest
icons/                generated app icons
```

Chart colors (`#D8517F` / `#C97C10` / `#0E9888`) were validated for contrast and
color-vision-deficiency separation on both the light and dark surfaces.
