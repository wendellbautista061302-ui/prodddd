# PROD2026 MASTER CLOUD

A production management system for tracking labor, materials, job orders (JO), worker statistics, and attendance — with Firebase cross-device live sync.

---

## 📁 Project Structure

```
prod2026/
├── index.html              ← Main HTML (structure & layout)
├── css/
│   └── styles.css          ← All styles & CSS variables
├── js/
│   ├── main.js             ← App logic (labor, materials, scheduler, stats, etc.)
│   └── supabase-sync.js    ← Firebase live sync module
└── README.md
```

---

## 🚀 How to Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages** → set source to `main` branch, `/ (root)`.
3. Your app will be live at: `https://<your-username>.github.io/<repo-name>/`

---

## 🔥 Firebase Setup (Cross-Device Sync)

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project.
2. Enable **Realtime Database**.
3. In the app, go to **⚙️ Settings** → paste your Firebase config.
4. The config is saved to `localStorage` and persists across sessions.

Firebase Realtime Database nodes used:
| Node | Purpose |
|------|---------|
| `jo_queue` | Scanner pushes new JOs; Master consumes & deletes |
| `jo_history` | Shared JO History across all devices |
| `jos_data` | Shared calendar/schedule data |
| `jo_done` | Signal to remove a JO from history on all devices |

---

## ⚙️ Features

- **Labor System** — Scan J.O., assign workers, track time-in/time-out, compute efficiency & cost
- **Worker Stats & Analytics** — Points leaderboard, pass/fail rates, daily efficiency charts
- **J.O. History Panel** — Real-time shared JO history across devices via Firebase
- **J.O. Scheduler** — Google Calendar-style drag-and-drop job order scheduler
- **J.O. Cost Tracker** — Per-JO cost breakdown by cutting stages and production stages
- **Materials System** — Material issuance, return tracking, cost-per-piece calculation
- **Attendance Module** — Weekly attendance grid auto-populated from labor logs
- **Print Utilities** — Thermal slip printing (58mm / 80mm), daily reports

---

## 🖨️ Print Setup

- Supports thermal receipt printers (58mm, 80mm, 76mm rolls) and label paper (A6, 100×150mm)
- Configure under **📄 PRINT SETUP** in the app

---

## 📊 Google Sheets Integration

- Labor data can be synced to Google Sheets via Apps Script URL
- Configure the URL under **⚙️ SETTINGS → Apps Script Cloud URL**
- J.O. Cost Tracker can export to Sheets per J.O. via the **📊** button

---

## 🔒 Security Notes

- All data is stored in `localStorage` by default (browser only)
- Firebase sync is optional and requires your own Firebase project
- Worker Stats are password-protected within the app

---

*Built for PROD2026 production floor management.*
