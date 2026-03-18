const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const SETTINGS_KEY = "cn_show_highlights";
const THEME_KEY = "cn_theme";
const API_BASE = "https://context-notes.onrender.com";

let cachedNotes = null;
let notesByUrlCache = null;

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
document.addEventListener("DOMContentLoaded", initPopup);

async function initPopup() {
  loadFolderDropdown();
  setupHighlightToggle();
  setupPopupButtons();
  setupSaveButton();
  setupEditDeleteHandler();
  await loadPageNotes();
}

//
// ───────── HIGHLIGHT TOGGLE ─────────
//
function setupHighlightToggle() {
  const toggleEl = document.getElementById("highlightToggle");
  if (!toggleEl) return;

  chrome.storage.local.get(SETTINGS_KEY, (res) => {
    toggleEl.checked = res[SETTINGS_KEY] !== false;
  });

  toggleEl.addEventListener("change", async () => {
    const enabled = toggleEl.checked;

    await chrome.storage.local.set({ [SETTINGS_KEY]: enabled });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) return;

    chrome.tabs
      .sendMessage(tab.id, {
        action: enabled ? "refresh_highlights" : "remove_highlights",
      })
      .catch(() => {});
  });
}

//
// ───────── POPUP BUTTONS ─────────
//
function setupPopupButtons() {
  const popOutBtn = document.getElementById("popOutBtn");
  const dashBtn = document.getElementById("openDashboard");

  if (popOutBtn) {
    popOutBtn.addEventListener("click", () => {
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
  }

  if (dashBtn) {
    dashBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard/dashboard.html"),
      });
    });
  }
}

//
// ───────── SAVE NOTE ─────────
//
function setupSaveButton() {
  const saveBtn = document.getElementById("saveBtn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    const titleInput = document.getElementById("noteTitle");
    const contentInput = document.getElementById("noteInput");
    const folderSelect = document.getElementById("folderSelect");

    const title = titleInput.value.trim() || "Untitled";
    const content = contentInput.value.trim();
    const folder = folderSelect?.value || null;

    if (!content && title === "Untitled") return;

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.url) {
      alert("Cannot save note on this page.");
      return;
    }

    const note = {
      id: Date.now().toString(),
      url: tab.url,
      domain: new URL(tab.url).hostname || "Unknown",
      title,
      content,
      selection: "",
      pinned: false,
      folder,
    };

    let notes = await getNotes();

    notes.push(note);
    cachedNotes = notes;

    await chrome.storage.local.set({ [STORAGE_KEY]: notes });

    titleInput.value = "";
    contentInput.value = "";
    if (folderSelect) folderSelect.value = "";

    rebuildNotesCache(notes);
    loadPageNotes();

    saveBtn.disabled = false;
  });
}

//
// ───────── LOAD PAGE NOTES ─────────
//
async function loadPageNotes() {
  const notesList = document.getElementById("notesList");

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.url) {
    notesList.innerHTML =
      '<div class="empty-state">Cannot read notes on this page.</div>';
    return;
  }

  if (!cachedNotes) {
    cachedNotes = await getNotes();
    rebuildNotesCache(cachedNotes);
  }

  const pageNotes = notesByUrlCache[tab.url] || [];

  if (!pageNotes.length) {
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
        <button class="btn-edit" data-id="${n.id}" data-title="${esc(n.title)}" data-content="${esc(n.content)}">✎</button>
        <button class="btn-delete" data-id="${n.id}">&times;</button>

        <div class="note-title">
          ${n.pinned ? "⭐ " : ""}${esc(n.title)}
          ${n.folder ? `<span class="note-folder-tag">${esc(n.folder)}</span>` : ""}
        </div>

        ${n.selection ? `<div class="context">"${esc(n.selection)}"</div>` : ""}
        ${n.content ? `<div class="content">${esc(n.content)}</div>` : ""}
      `;

      notesList.appendChild(card);
    });
}

//
// ───────── EDIT / DELETE HANDLER ─────────
//
function setupEditDeleteHandler() {
  document.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".btn-delete");
    const editBtn = e.target.closest(".btn-edit");

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;

      let notes = await getNotes();
      notes = notes.filter((n) => String(n.id) !== String(id));

      cachedNotes = notes;
      rebuildNotesCache(notes);

      await chrome.storage.local.set({ [STORAGE_KEY]: notes });

      loadPageNotes();
      return;
    }

    if (editBtn) {
      const id = editBtn.dataset.id;

      const title = prompt("Edit title:", editBtn.dataset.title);
      if (title === null) return;

      const content = prompt("Edit content:", editBtn.dataset.content);
      if (content === null) return;

      let notes = await getNotes();

      const note = notes.find((n) => String(n.id) === String(id));
      if (!note) return;

      note.title = title.trim() || "Untitled";
      note.content = content.trim();

      cachedNotes = notes;
      rebuildNotesCache(notes);

      await chrome.storage.local.set({ [STORAGE_KEY]: notes });

      loadPageNotes();
    }
  });
}

//
// ───────── HELPERS ─────────
//
async function getNotes() {
  const res = await chrome.storage.local.get(STORAGE_KEY);

  let notes = res[STORAGE_KEY] || [];

  if (typeof notes === "string") {
    try {
      notes = JSON.parse(notes);
    } catch {
      notes = [];
    }
  }

  return notes;
}

function rebuildNotesCache(notes) {
  notesByUrlCache = {};

  for (const n of notes) {
    if (!notesByUrlCache[n.url]) notesByUrlCache[n.url] = [];
    notesByUrlCache[n.url].push(n);
  }
}
const esc = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// ── AI: SUMMARIZE PAGE INTO NOTES ──
aiGenerateBtn.addEventListener("click", async () => {
  // ── STEP 1: Gate check ──
  const hasAccess = await ProMode.canAccessAI();
  if (!hasAccess) {
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const isYouTube = tab.url.includes("youtube.com/watch");

  // ── STEP 2: Lock UI ──
  aiGenerateBtn.disabled = true;
  aiGenerateBtn.style.display = "flex";
  aiNotesContainer.style.display = "none";
  aiNotesContainer.innerHTML = "";

  // ── STEP 3: Fetch content (YouTube transcript OR page text) ──
  let generatedNotes = null;

  if (isYouTube) {
    aiGenerateBtn.innerHTML = "⏳ Connecting to page...";

    // Step 1: Force inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (injectErr) {
      console.log("Inject note:", injectErr.message);
    }

    // Step 2: Wait longer for listener to register
    await new Promise((r) => setTimeout(r, 800));

    aiGenerateBtn.innerHTML = "⏳ Fetching transcript...";

    // Step 3: Send message WITH retry
    let transcriptResult;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (attempts < MAX_ATTEMPTS) {
      try {
        transcriptResult = await chrome.tabs.sendMessage(tab.id, {
          action: "GET_YOUTUBE_TRANSCRIPT",
        });
        break; // success — exit retry loop
      } catch (e) {
        attempts++;
        console.warn(`sendMessage attempt ${attempts} failed:`, e.message);

        if (attempts >= MAX_ATTEMPTS) {
          return resetBtn(
            "❌ Could not reach page. Reload the YouTube tab and try again.",
          );
        }

        // Wait before retrying
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    // Step 4: Handle specific error codes from content script
    if (!transcriptResult || transcriptResult.error) {
      const err = transcriptResult?.error || "";

      if (err === "NO_TRANSCRIPT") {
        return showNoTranscriptUI(tab);
      }
      if (err === "NO_MORE_BTN") {
        return resetBtn(
          "❌ Could not find video menu. Scroll down a bit and try again.",
        );
      }
      if (err === "NO_SEGMENTS") {
        return resetBtn(
          "❌ Transcript opened but text couldn't be read. Try again.",
        );
      }

      return resetBtn(`❌ ${err || "Unknown error fetching transcript."}`);
    }

    // ... rest of YouTube path unchanged

    aiGenerateBtn.innerHTML = "🤖 AI summarizing transcript...";

    try {
      generatedNotes = await AIService.generateNotesFromTranscript(
        transcriptResult.transcript,
        transcriptResult.title,
      );
    } catch (e) {
      console.error("Transcript AI error:", e);
      return resetBtn("❌ AI summarization failed.");
    }
  } else {
    aiGenerateBtn.innerHTML = "⏳ Reading page...";

    let pageText = "";
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.textContent,
      });
      pageText = results[0]?.result || "";
    } catch (e) {
      return resetBtn("❌ Extension lacks permission for this page.");
    }

    if (pageText.trim().length < 50) {
      return resetBtn("❌ Not enough text on this page to summarize.");
    }

    aiGenerateBtn.innerHTML = "✨ Generating notes...";

    try {
      generatedNotes = await AIService.generateNotesFromPage(pageText);
    } catch (e) {
      console.error("Page AI error:", e);
    }
  }

  // ── STEP 4: Validate AI response ──
  if (!Array.isArray(generatedNotes) || generatedNotes.length === 0) {
    return resetBtn("❌ AI returned no notes. Please try again.");
  }

  // ── STEP 5: Hide button, render review cards ──
  aiGenerateBtn.style.display = "none";
  aiNotesContainer.style.display = "block";

  const headerLabel = isYouTube
    ? "🎬 Video Notes Preview"
    : "✨ AI Generated Concepts";

  aiNotesContainer.innerHTML = `
    <div style="
      font-size: 13px;
      font-weight: bold;
      color: var(--acc, #4f46e5);
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <span>${headerLabel}</span>
      <button id="cancelAiBtn" style="
        background: none;
        border: none;
        color: var(--mut, #64748b);
        cursor: pointer;
        font-size: 12px;
        padding: 4px;
      ">Cancel</button>
    </div>
  `;

  // ── STEP 6: Render each note as a checkable card ──
  generatedNotes.forEach((n, idx) => {
    const safeTitle = n.title || "Untitled Concept";
    const safeContent = n.content || "No details provided.";

    const card = document.createElement("div");
    card.className = "ai-review-card";
    card.style.cssText = `
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      display: flex;
      gap: 10px;
      align-items: flex-start;
      cursor: pointer;
    `;

    card.innerHTML = `
      <input
        type="checkbox"
        id="ai-chk-${idx}"
        class="ai-checkbox"
        checked
        style="margin-top: 3px; cursor: pointer;"
      >
      <div style="flex: 1;">
        <label for="ai-chk-${idx}" style="
          font-weight: bold;
          font-size: 13px;
          color: #92400e;
          margin-bottom: 4px;
          display: block;
          cursor: pointer;
        ">${esc(safeTitle)}</label>
        <div style="font-size: 12px; color: #b45309; line-height: 1.4;">
          ${esc(safeContent)}
        </div>
      </div>
    `;

    // Clicking anywhere on the card (except label/checkbox itself) toggles checkbox
    card.addEventListener("click", (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "LABEL") {
        const chk = document.getElementById(`ai-chk-${idx}`);
        if (chk) chk.checked = !chk.checked;
      }
    });

    aiNotesContainer.appendChild(card);
  });

  // ── STEP 7: Save Selected button ──
  const saveAllBtn = document.createElement("button");
  saveAllBtn.style.cssText = `
    width: 100%;
    padding: 10px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: bold;
    margin-top: 4px;
    display: flex;
    justify-content: center;
    gap: 6px;
  `;
  saveAllBtn.innerHTML = "💾 Save Selected Notes";
  aiNotesContainer.appendChild(saveAllBtn);

  // ── STEP 8: Handle save ──
  saveAllBtn.addEventListener("click", async () => {
    saveAllBtn.disabled = true;
    saveAllBtn.innerHTML = "Saving...";

    const folderName = isYouTube ? "YouTube Notes" : null;

    const notesToSave = generatedNotes
      .filter((_, idx) => document.getElementById(`ai-chk-${idx}`)?.checked)
      .map((n, idx) => ({
        id: `${Date.now()}-${Math.floor(Math.random() * 10000)}-${idx}`,
        url: tab.url,
        domain: new URL(tab.url).hostname || "Unknown Domain",
        title: (isYouTube ? "🎬 " : "✨ ") + (n.title || "AI Note"),
        content: n.content || "",
        tags: n.tags || [],
        selection: "",
        pinned: false,
        folder: folderName,
        timestamp: null,
        image_data: "",
      }));

    if (notesToSave.length > 0) {
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
      cachedNotes = updatedNotes;
      rebuildNotesCache(updatedNotes);
      await chrome.storage.local.set({ [STORAGE_KEY]: updatedNotes });
    }

    aiNotesContainer.style.display = "none";
    aiNotesContainer.innerHTML = "";
    loadPageNotes();
  });

  // ── STEP 9: Handle cancel ──
  document.getElementById("cancelAiBtn").addEventListener("click", () => {
    aiNotesContainer.style.display = "none";
    aiNotesContainer.innerHTML = "";
    aiGenerateBtn.style.display = "flex";
    aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
    aiGenerateBtn.disabled = false;
  });

  // ── HELPER: reset button to idle state with an error message ──
  function resetBtn(msg) {
    aiGenerateBtn.innerHTML = msg;
    aiGenerateBtn.disabled = false;
    setTimeout(() => {
      aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
    }, 2500);
  }
});

function showNoTranscriptUI(tab) {
  aiGenerateBtn.style.display = "none";
  aiNotesContainer.style.display = "block";
  aiNotesContainer.innerHTML = `
    <div style="
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 10px;
      padding: 16px;
      font-size: 13px;
      line-height: 1.6;
      color: #7f1d1d;
    ">
      <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">
        ⚠️ No transcript available
      </div>
      <div style="color: #991b1b; margin-bottom: 12px;">
        This video doesn't have captions or a transcript enabled by the creator.
      </div>
      <div style="font-weight: bold; margin-bottom: 6px;">Try one of these instead:</div>
      <ul style="margin: 0; padding-left: 18px; color: #991b1b; display: flex; flex-direction: column; gap: 6px;">
        <li>
          <strong>Enable auto-captions</strong> — Go to the video's
          <em>Settings → Subtitles</em> and turn on auto-generated captions, then try again.
        </li>
        <li>
          <strong>Tactiq</strong> —
          <a href="https://tactiq.io" target="_blank" style="color: #4f46e5;">tactiq.io</a>
          generates transcripts for any YouTube video for free.
        </li>
        <li>
          <strong>Summarize page instead</strong> — Uses the video title,
          description and metadata to generate notes.
        </li>
      </ul>
      <button id="fallbackPageBtn" style="
        margin-top: 14px; width: 100%; padding: 9px;
        background: #4f46e5; color: white; border: none;
        border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px;
      ">📄 Summarize Page Description Instead</button>
      <button id="dismissNoTranscriptBtn" style="
        margin-top: 8px; width: 100%; padding: 8px;
        background: none; border: 1px solid #fca5a5;
        border-radius: 6px; cursor: pointer; color: #991b1b; font-size: 12px;
      ">Dismiss</button>
    </div>
  `;

  document
    .getElementById("fallbackPageBtn")
    .addEventListener("click", async () => {
      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      aiGenerateBtn.style.display = "flex";
      aiGenerateBtn.innerHTML = "⏳ Reading page description...";
      aiGenerateBtn.disabled = true;

      let pageText = "";
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.textContent,
        });
        pageText = results[0]?.result || "";
      } catch (e) {
        return resetBtn("❌ Could not read page.");
      }

      if (pageText.trim().length < 50)
        return resetBtn("❌ Not enough page text.");

      aiGenerateBtn.innerHTML = "✨ Generating notes...";
      let fallbackNotes = null;
      try {
        fallbackNotes = await AIService.generateNotesFromPage(pageText);
      } catch (e) {
        return resetBtn("❌ AI generation failed.");
      }

      if (!Array.isArray(fallbackNotes) || fallbackNotes.length === 0) {
        return resetBtn("❌ AI returned no notes.");
      }

      renderNoteCards(fallbackNotes, tab, false);
    });

  document
    .getElementById("dismissNoTranscriptBtn")
    .addEventListener("click", () => {
      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      aiGenerateBtn.style.display = "flex";
      aiGenerateBtn.innerHTML = "✨ Summarize Page to Notes";
      aiGenerateBtn.disabled = false;
    });
}
