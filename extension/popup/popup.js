// popup.js — ContextNote Extension Popup

const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const SETTINGS_KEY = "cn_show_highlights";
const THEME_KEY = "cn_theme";
const API_BASE = "https://context-notes.onrender.com";

let cachedNotes = null;

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

    let notes = result[STORAGE_KEY] || [];

    if (typeof notes === "string") {
      try {
        notes = JSON.parse(notes);
      } catch {
        notes = [];
      }
    }

    notes.push(noteData);

    await chrome.storage.local.set({ [STORAGE_KEY]: notes });

    // Reset inputs
    noteTitleInput.value = "";
    noteInput.value = "";
    if (folderSelect) folderSelect.value = "";

    loadPageNotes();
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

    let allNotes = cachedNotes;

    if (!allNotes) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      allNotes = result[STORAGE_KEY] || [];
      cachedNotes = allNotes;
    }

    if (typeof allNotes === "string") {
      try {
        allNotes = JSON.parse(allNotes);
      } catch {
        allNotes = [];
      }
    }
    const notesByUrl = {};

    for (const note of allNotes) {
      if (!notesByUrl[note.url]) notesByUrl[note.url] = [];
      notesByUrl[note.url].push(note);
    }

    const pageNotes = notesByUrl[tab.url] || [];

    if (pageNotes.length === 0) {
      notesList.innerHTML =
        '<div class="empty-state">No notes for this page.</div>';
      return;
    }

    notesList.innerHTML = "";
    pageNotes
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      .slice(0, 20)
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
          [STORAGE_KEY]: allNotes,
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

        loadPageNotes();
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
            [STORAGE_KEY]: allNotes,
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

          loadPageNotes();
        }
      });
    });
  }

  loadPageNotes();
});

const esc = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");


// ── AI: SUMMARIZE PAGE INTO NOTES ──
document.addEventListener("DOMContentLoaded", () => {
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiNotesContainer = document.getElementById("aiNotesContainer");

  if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener("click", async () => {
      // 1. Check Pro & API Key Status using gatekeeper
      const hasAccess = await ProMode.canAccessAI();
      if (!hasAccess) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("dashboard/dashboard.html"),
        });
        return;
      }

      // 2. Setup UI for Loading
      aiGenerateBtn.disabled = true;
      aiGenerateBtn.innerHTML = "⏳ Reading page...";
      aiNotesContainer.style.display = "block";
      aiNotesContainer.innerHTML = "";

      // 3. Extract Text from Current Page
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab || !tab.url) {
        aiGenerateBtn.innerHTML = "❌ Cannot read this page";
        setTimeout(() => {
          aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
          aiGenerateBtn.disabled = false;
        }, 2000);
        return;
      }

      let pageText = "";
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.innerText,
        });
        pageText = results[0]?.result || "";
      } catch (e) {
        aiGenerateBtn.innerHTML = "❌ Extension lacks permission for this page";
        setTimeout(() => {
          aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
          aiGenerateBtn.disabled = false;
        }, 2000);
        return;
      }

      if (pageText.length < 50) {
        aiGenerateBtn.innerHTML = "❌ Not enough text to summarize";
        setTimeout(() => {
          aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
          aiGenerateBtn.disabled = false;
        }, 2000);
        return;
      }

      // 4. Generate Notes via AI
      aiGenerateBtn.innerHTML = "✨ Generating Notes...";
      let generatedNotes = null;
      try {
        generatedNotes = await AIService.generateNotesFromPage(pageText);
      } catch (e) {
        console.error("AI Service threw an error:", e);
      }

      // Strict validation to prevent the Array.forEach error
      if (
        !generatedNotes ||
        !Array.isArray(generatedNotes) ||
        generatedNotes.length === 0
      ) {
        aiGenerateBtn.innerHTML = "❌ AI Generation Failed";
        setTimeout(() => {
          aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
          aiGenerateBtn.disabled = false;
        }, 2000);
        return;
      }

      // 5. Render Batch-Save UI
      aiGenerateBtn.style.display = "none"; // Hide generate button
      aiNotesContainer.style.display = "block";
      aiNotesContainer.innerHTML = `
        <div style="font-size:13px; font-weight:bold; color:var(--acc, #4f46e5); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          <span>✨ AI Generated Concepts</span>
          <button id="cancelAiBtn" style="background:none; border:none; color:var(--mut, #64748b); cursor:pointer; font-size:12px; padding:4px;">Cancel</button>
        </div>
      `;

      // Render each note with a checkbox safely
      generatedNotes.forEach((n, idx) => {
        // Ensure data exists before rendering to prevent esc() crashes
        const safeTitle = n.title || "Untitled Concept";
        const safeContent = n.content || "No details provided.";

        const aiCard = document.createElement("div");
        aiCard.className = "ai-review-card";
        aiCard.style.cssText =
          "background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-bottom: 8px; display:flex; gap:10px; align-items:flex-start; cursor:pointer;";

        aiCard.innerHTML = `
          <input type="checkbox" id="ai-chk-${idx}" class="ai-checkbox" checked style="margin-top:3px; cursor:pointer;">
          <div style="flex:1;">
            <label for="ai-chk-${idx}" style="font-weight:bold; font-size:13px; color:#92400e; margin-bottom:4px; display:block; cursor:pointer;">${esc(safeTitle)}</label>
            <div style="font-size:12px; color:#b45309; line-height:1.4;">${esc(safeContent)}</div>
          </div>
        `;

        // Clicking the card area toggles the checkbox
        aiCard.addEventListener("click", (e) => {
          if (e.target.tagName !== "INPUT" && e.target.tagName !== "LABEL") {
            const chk = document.getElementById(`ai-chk-${idx}`);
            if (chk) chk.checked = !chk.checked;
          }
        });

        aiNotesContainer.appendChild(aiCard);
      });

      // Add the master Save button
      // Add the master Save button
      const saveAllBtn = document.createElement("button");
      saveAllBtn.style.cssText =
        "width: 100%; padding: 10px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 4px; display:flex; justify-content:center; gap:6px;";
      saveAllBtn.innerHTML = `💾 Save Selected Notes`;
      aiNotesContainer.appendChild(saveAllBtn);

      // --- LOGIC: BATCH SAVE ---
      saveAllBtn.addEventListener("click", async () => {
        saveAllBtn.disabled = true;
        saveAllBtn.innerHTML = "Saving...";

        // Collect checked notes safely
        const notesToSave = [];
        generatedNotes.forEach((n, idx) => {
          const chk = document.getElementById(`ai-chk-${idx}`);
          if (chk && chk.checked) {
            notesToSave.push({
              id: Date.now().toString() + "-" + Math.floor(Math.random() * 1000) + "-" + idx,
              url: tab.url,
              domain: new URL(tab.url).hostname || "Unknown Domain",
              title: "✨ " + (n.title || "AI Concept"),
              content: n.content || "",
              selection: "",
              pinned: false,
              folder: null,
              timestamp: null
            });
          }
        });

        if (notesToSave.length > 0) {
          // Push to storage ONCE
          const storage = await chrome.storage.local.get(STORAGE_KEY);

          let currentNotes = storage[STORAGE_KEY] || [];

          if (typeof currentNotes === "string") {
            try {
              currentNotes = JSON.parse(currentNotes);
            } catch {
              currentNotes = [];
            }
          }

          const updatedNotes = [...currentNotes, ...notesToSave];

          await chrome.storage.local.set({ [STORAGE_KEY]: updatedNotes });
        }

        // Clean up UI and instantly reload the popup to show the new notes
        aiNotesContainer.style.display = "none";
        loadPageNotes(); 
      });

      // --- LOGIC: CANCEL ---
      document.getElementById("cancelAiBtn").addEventListener("click", () => {
        aiNotesContainer.style.display = "none";
        aiNotesContainer.innerHTML = "";
        aiGenerateBtn.style.display = "flex";
        aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
        aiGenerateBtn.disabled = false;
      });
    });
  }
});