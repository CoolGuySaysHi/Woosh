# 🚀 Woosh Browser

Your very own desktop browser with tabs and a custom search page!

---

## ▶️ How to Run

1. Install **Node.js** from https://nodejs.org (LTS version)
2. Open a terminal in this folder
3. Run: `npm install`  ← (only needed once)
4. Run: `npm start`    ← opens Woosh!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close current tab |
| `Ctrl + L` | Focus address bar |
| `Ctrl + R` | Reload |
| `Alt + ←` | Go back |
| `Alt + →` | Go forward |
| `Enter` in address bar | Navigate / search |

---

## 📁 Files

```
woosh-browser/
├── main.js       ← Electron main process, tab engine
├── preload.js    ← IPC bridge
├── index.html    ← Browser toolbar + tab bar UI
├── style.css     ← All the styling
├── renderer.js   ← Tab and button logic
├── newtab.html   ← Your custom Woosh search/home page
└── package.json
```

---

## 💡 Things to add next

- **Bookmarks** — save favourite sites, store in a JSON file
- **History page** — log every URL you visit
- **Custom shortcuts** on the new tab page (edit newtab.html!)
- **Themes** — light mode, different color schemes
- **Download manager** 
- **Zoom in/out** with Ctrl+/−
- **Tab reordering** — drag tabs around
- **Favicon support** — show site icons in tabs

---

## 🖥️ Making a desktop shortcut (Windows)

Quick way:
1. Right-click desktop → New → Shortcut
2. Set location to: `cmd /c "cd C:\path\to\woosh-browser && npm start"`
3. Name it **Woosh**

Proper .exe way:
```
npm install --save-dev electron-builder
npx electron-builder --win --dir
```
Creates a real app in the `dist/` folder!

---

Built with ❤️ using Electron, HTML, CSS & JS.
