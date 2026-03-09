// popup.js — ContextNote Extension Popup

const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const SETTINGS_KEY = "cn_show_highlights";
const THEME_KEY = "cn_theme";
const API_BASE = "http://127.0.0.1:5000";

// ── THEME ENGINE ──
function applyThemeToPopup(theme) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
}

chrome.storage.local.get([THEME_KEY], (res) => {
  applyThemeToPopup(res[THEME_KEY] || "indigo");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[THEME_KEY]) applyThemeToPopup(changes[THEME_KEY].newValue);
  // If folders are updated from the dashboard, refresh the dropdown live
  if (changes[FOLDERS_KEY]) loadFolderDropdown();
});

// ── FOLDER DROPDOWN LOADER ──
function loadFolderDropdown() {
  const select = document.getElementById("folderSelect");
  if (!select) return;

  chrome.storage.local.get([FOLDERS_KEY, "cn_show_pro_ui"], (res) => {
    const folders = res[FOLDERS_KEY] || [];

    if (folders.length === 0) {
      // Hide the whole folder row if no folders exist yet
      const row = document.getElementById("folderRow");
      if (row) row.style.display = "none";
      return;
    }

    // Show the folder row
    const row = document.getElementById("folderRow");
    if (row) row.style.display = "flex";

    select.innerHTML =
      `<option value="">No folder</option>` +
      folders
        .map(
          (f) =>
            `<option value="${f.replace(/"/g, "&quot;")}">${f.replace(/</g, "&lt;")}</option>`,
        )
        .join("");
  });
}

// ── MAIN ──
document.addEventListener("DOMContentLoaded", () => {
  // Load folder dropdown on open
  loadFolderDropdown();

  // ── HIGHLIGHT TOGGLE ──
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
          .catch(() => {});
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
      (win) => {
        if (win) window.close();
      },
    );
  });

  // ── OPEN DASHBOARD ──
  document.getElementById("openDashboard").addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
  });

  // ── SAVE NOTE ──
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const noteTitleInput = document.getElementById("noteTitle");
    const noteInput = document.getElementById("noteInput");
    const folderSelect = document.getElementById("folderSelect");

    const title = noteTitleInput.value.trim() || "Untitled";
    const content = noteInput.value.trim();
    const selectedFolder = folderSelect ? folderSelect.value : "";

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
      // Save folder if one was selected, otherwise null
      folder: selectedFolder || null,
    };

    const result = await chrome.storage.local.get(STORAGE_KEY);
    const notes = result[STORAGE_KEY] ? JSON.parse(result[STORAGE_KEY]) : [];
    notes.push(noteData);
    await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(notes) });

    // Reset inputs
    noteTitleInput.value = "";
    noteInput.value = "";
    if (folderSelect) folderSelect.value = "";

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
          <div class="note-title">${n.pinned ? "⭐ " : ""}${n.title.replace(/</g, "&lt;")}${n.folder ? ` <span class="note-folder-tag">${n.folder.replace(/</g, "&lt;")}</span>` : ""}</div>
          ${n.selection ? `<div class="context">"${n.selection.replace(/</g, "&lt;")}"</div>` : ""}
          ${n.content ? `<div class="content">${n.content.replace(/</g, "&lt;")}</div>` : ""}
        `;
        notesList.appendChild(card);
      });

    // Delete
    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        if (!confirm("Delete this note?")) return;

        allNotes = allNotes.filter((n) => n.id !== id);
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(allNotes),
        });

        try {
          const res = await fetch(`${API_BASE}/api/notes/${id}`, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok)
            console.warn("Note deleted locally, but sync to cloud failed.");
        } catch (e) {
          console.log("Server offline, note deleted locally.");
        }

        window.location.reload();
      });
    });

    // Edit
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

          try {
            await fetch(`${API_BASE}/api/notes/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: newTitle, content: newContent }),
              credentials: "include",
            });
          } catch (err) {
            console.error("Server is offline, update saved locally only.");
          }

          window.location.reload();
        }
      });
    });
  }

  loadPageNotes();
});
