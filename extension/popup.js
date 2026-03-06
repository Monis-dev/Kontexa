// popup.js — ContextNote Extension Popup

const STORAGE_KEY = "context_notes_data";
const SETTINGS_KEY = "cn_show_highlights";
const THEME_KEY = "cn_theme";

// ── THEME ENGINE (Synced natively with CSS attributes) ──
function applyThemeToPopup(theme) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Load saved theme on popup open
chrome.storage.local.get([THEME_KEY], (res) => {
  applyThemeToPopup(res[THEME_KEY] || "indigo");
});

// Live-sync theme if user changes it in dashboard while popup is open
chrome.storage.onChanged.addListener((changes) => {
  if (changes[THEME_KEY]) {
    applyThemeToPopup(changes[THEME_KEY].newValue);
  }
});

// ── HIGHLIGHT TOGGLE ──
document.addEventListener("DOMContentLoaded", () => {
  const toggleEl = document.getElementById("highlightToggle");
  if (toggleEl) {
    chrome.storage.local.get(SETTINGS_KEY, (res) => {
      toggleEl.checked = res[SETTINGS_KEY] !== false;
    });

    toggleEl.addEventListener("change", async () => {
      const isEnabled = toggleEl.checked;
      await chrome.storage.local.set({ [SETTINGS_KEY]: isEnabled });
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab && tab.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            action: isEnabled ? "refresh_highlights" : "remove_highlights",
          })
          .catch(() => {}); // catch errors if injected script isn't on page
      }
    });
  }

  // ── POP OUT ──
  document.getElementById("popOutBtn").addEventListener("click", () => {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 360,
        height: 650,
      },
      () => window.close(),
    );
  });

  // ── OPEN DASHBOARD ──
  document.getElementById("openDashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  // ── SAVE NOTE ──
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const noteTitleInput = document.getElementById("noteTitle");
    const noteInput = document.getElementById("noteInput");
    const title = noteTitleInput.value.trim() || "Untitled";
    const content = noteInput.value.trim();
    if (!content && title === "Untitled") return;

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.url) {
      alert("Cannot save note on this specific page.");
      return;
    }

    const noteData = {
      id: Date.now().toString(),
      url: tab.url,
      domain: new URL(tab.url).hostname || "Unknown Domain",
      title,
      content,
      selection: "",
      pinned: false,
    };

    const result = await chrome.storage.local.get(STORAGE_KEY);
    const notes = result[STORAGE_KEY] ? JSON.parse(result[STORAGE_KEY]) : [];
    notes.push(noteData);
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(notes) });

    noteTitleInput.value = "";
    noteInput.value = "";
    window.location.reload();
  });

  // ── LOAD NOTES FOR CURRENT PAGE ──
  async function loadPageNotes() {
    const notesList = document.getElementById("notesList");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.url) {
      notesList.innerHTML =
        '<div class="empty-state">Cannot read notes on this page.</div>';
      return;
    }

    const result = await chrome.storage.local.get(STORAGE_KEY);
    let allNotes = result[STORAGE_KEY] ? JSON.parse(result[STORAGE_KEY]) : [];
    const pageNotes = allNotes.filter((n) => n.url === tab.url);

    if (pageNotes.length === 0) {
      notesList.innerHTML =
        '<div class="empty-state">No notes for this page.</div>';
      return;
    }

    notesList.innerHTML = "";
    pageNotes
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      .forEach((n) => {
        const card = document.createElement("div");
        card.className = "note-card";
        card.innerHTML = `
          <button class="btn-edit" data-id="${n.id}"
            data-title="${n.title.replace(/"/g, "&quot;")}"
            data-content="${(n.content || "").replace(/"/g, "&quot;")}">✎</button>
          <button class="btn-delete" data-id="${n.id}">&times;</button>
          <div class="note-title">${n.pinned ? "⭐ " : ""}${n.title.replace(/</g, "&lt;")}</div>
          ${n.selection ? `<div class="context">"${n.selection.replace(/</g, "&lt;")}"</div>` : ""}
          ${n.content ? `<div class="content">${n.content.replace(/</g, "&lt;")}</div>` : ""}
        `;
        notesList.appendChild(card);
      });

    // Delete Notes
    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("Delete this note?")) return;
        allNotes = allNotes.filter((n) => n.id !== id);
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(allNotes),
        });
        window.location.reload();
      });
    });

    // Edit Notes
    document.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        const newTitle = prompt(
          "Edit Heading:",
          e.target.getAttribute("data-title"),
        );
        if (newTitle === null) return;
        const newContent = prompt(
          "Edit Description:",
          e.target.getAttribute("data-content"),
        );
        if (newContent === null) return;
        const idx = allNotes.findIndex((n) => n.id === id);
        if (idx > -1) {
          allNotes[idx].title = newTitle;
          allNotes[idx].content = newContent;
          await chrome.storage.local.set({
            [STORAGE_KEY]: JSON.stringify(allNotes),
          });
          window.location.reload();
        }
      });
    });
  }

  loadPageNotes();
});
