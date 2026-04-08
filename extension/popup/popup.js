const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const SETTINGS_KEY = "cn_show_highlights";
const THEME_KEY = "cn_theme";
const API_BASE = "https://www.kontexa.online";

// Client-side field limits — mirrors backend constants
const MAX_TITLE_LEN = 255;
const MAX_CONTENT_LEN = 100_000;

let cachedNotes = null;
let notesByUrlCache = null;

/* ═══════════════════════════════════════
   THEME ENGINE
═══════════════════════════════════════ */
function applyThemeToPopup(theme) {
  if (typeof CN_THEMES === "undefined" || !CN_THEMES[theme]) theme = "nova";
  document.documentElement.setAttribute("data-theme", theme);
  if (typeof CN_THEMES !== "undefined" && CN_THEMES[theme]) {
    const themeData = CN_THEMES[theme];
    for (const [key, value] of Object.entries(themeData.vars)) {
      document.documentElement.style.setProperty(key, value);
    }
    if (themeData.fontBody) document.body.style.fontFamily = themeData.fontBody;
  }
}

chrome.storage.local.get([THEME_KEY], (res) => {
  applyThemeToPopup(res[THEME_KEY] || "nova");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[THEME_KEY]) applyThemeToPopup(changes[THEME_KEY].newValue);
  if (changes[FOLDERS_KEY]) loadFolderDropdown();
});

/* ═══════════════════════════════════════
   UNIQUE NOTE ID — standardised, collision-safe
   FIX: was just Date.now().toString() with no random suffix,
   meaning two saves in the same millisecond get the same id.
═══════════════════════════════════════ */
function generateNoteId(prefix = "note") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ═══════════════════════════════════════
   FOLDER DROPDOWN
═══════════════════════════════════════ */
function loadFolderDropdown() {
  const select = document.getElementById("folderSelect");
  if (!select) return;

  chrome.storage.local.get([FOLDERS_KEY], (res) => {
    const folders = res[FOLDERS_KEY] || [];
    const row = document.getElementById("folderRow");
    if (row) row.style.display = "flex";

    if (folders.length === 0) {
      chrome.storage.local.set({ [FOLDERS_KEY]: ["General Notes"] });
      select.innerHTML = `
        <option value="">No folder</option>
        <option value="General Notes">General Notes</option>`;
      return;
    }

    select.innerHTML =
      `<option value="">No folder</option>` +
      folders
        .map((f) => `<option value="${esc(f)}">${esc(f)}</option>`)
        .join("");
  });
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", initPopup);

async function initPopup() {
  loadFolderDropdown();
  setupHighlightToggle();
  setupDashboardLink();
  setupGeneralNoteToggle();
  setupSaveButton();
  setupEditDeleteHandler();
  await loadPageNotes();
}

/* ═══════════════════════════════════════
   GENERAL NOTE TOGGLE
═══════════════════════════════════════ */
function setupGeneralNoteToggle() {
  const row = document.getElementById("generalToggleRow");
  const switchEl = document.getElementById("generalToggleSwitch");
  const thumbEl = document.getElementById("generalToggleThumb");
  const folderRow = document.getElementById("folderRow");
  const folderSelect = document.getElementById("folderSelect");
  if (!row) return;

  row.style.display = "flex";
  if (folderRow) folderRow.style.display = "none";

  let isGeneral = false;

  row.addEventListener("click", () => {
    isGeneral = !isGeneral;
    switchEl.style.background = isGeneral ? "var(--acc)" : "var(--bdr)";
    thumbEl.style.left = isGeneral ? "15px" : "2px";
    if (folderRow) folderRow.style.display = isGeneral ? "flex" : "none";
    if (isGeneral && folderSelect) {
      const first = [...folderSelect.options].find((o) => o.value !== "");
      if (first) folderSelect.value = first.value;
    }
    row.dataset.isGeneral = isGeneral;
  });
}

/* ═══════════════════════════════════════
   HIGHLIGHT TOGGLE
═══════════════════════════════════════ */
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

/* ═══════════════════════════════════════
   DASHBOARD LINK
═══════════════════════════════════════ */
function setupDashboardLink() {
  const dashBtn = document.getElementById("openDashboard");
  if (dashBtn) {
    dashBtn.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard/dashboard.html"),
      });
    });
  }
}

/* ═══════════════════════════════════════
   SAVE NOTE
═══════════════════════════════════════ */
function setupSaveButton() {
  const saveBtn = document.getElementById("saveBtn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;

    const titleInput = document.getElementById("noteTitle");
    const contentInput = document.getElementById("noteInput");
    const folderSelect = document.getElementById("folderSelect");
    const toggleRow = document.getElementById("generalToggleRow");

    const title = titleInput.value.trim() || "Untitled";
    const content = contentInput.value.trim();
    const folder = folderSelect?.value || null;

    if (!content && title === "Untitled") {
      saveBtn.disabled = false;
      return;
    }

    // FIX: client-side length validation before writing to storage / syncing
    if (title.length > MAX_TITLE_LEN) {
      alert(`Title too long (max ${MAX_TITLE_LEN} characters).`);
      saveBtn.disabled = false;
      return;
    }
    if (content.length > MAX_CONTENT_LEN) {
      alert(
        `Content too long (max ${MAX_CONTENT_LEN.toLocaleString()} characters).`,
      );
      saveBtn.disabled = false;
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) {
      alert("Cannot save note on this page.");
      saveBtn.disabled = false;
      return;
    }

    const isGeneral = toggleRow?.dataset.isGeneral === "true";

    let finalFolder = folder;
    if (isGeneral && !finalFolder) {
      finalFolder = "General Notes";
      chrome.storage.local.get([FOLDERS_KEY], (res) => {
        const folders = res[FOLDERS_KEY] || [];
        if (!folders.includes("General Notes")) {
          chrome.storage.local.set({
            [FOLDERS_KEY]: [...folders, "General Notes"],
          });
        }
      });
    }

    const noteUrl = isGeneral || finalFolder ? "folder://notes" : tab.url;
    const noteDomain =
      isGeneral || finalFolder
        ? "folder"
        : new URL(tab.url).hostname || "Unknown";

    const note = {
      // FIX: was Date.now().toString() — no entropy, collision risk on rapid save.
      // Now uses the same standardised generator as dashboard.js.
      id: generateNoteId("popup"),
      url: noteUrl,
      domain: noteDomain,
      title,
      content,
      selection: "",
      pinned: false,
      folder: finalFolder,
      _synced: false,
    };

    let notes = await getNotes();
    notes.push(note);
    cachedNotes = notes;
    await chrome.storage.local.set({ [STORAGE_KEY]: notes });

    saveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" style="stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Saved!`;
    setTimeout(() => {
      saveBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" style="stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        Save Note`;
      saveBtn.disabled = false;
    }, 1200);

    titleInput.value = "";
    contentInput.value = "";
    if (folderSelect) folderSelect.value = "";

    rebuildNotesCache(notes);
    loadPageNotes();
  });
}

/* ═══════════════════════════════════════
   LOAD PAGE NOTES
═══════════════════════════════════════ */
async function loadPageNotes() {
  const notesList = document.getElementById("notesList");
  const label = document.getElementById("notesLabel");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    notesList.innerHTML = emptyState("Cannot read notes on this page.");
    return;
  }

  if (!cachedNotes) {
    cachedNotes = await getNotes();
    rebuildNotesCache(cachedNotes);
  }

  const pageNotes = (notesByUrlCache[tab.url] || []).filter(
    (n) => n.url !== "general://notes",
  );

  if (label) {
    const domain = tab.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const short = domain.length > 28 ? domain.slice(0, 28) + "…" : domain;
    label.textContent =
      pageNotes.length > 0
        ? `${short} · ${pageNotes.length} note${pageNotes.length !== 1 ? "s" : ""}`
        : short;
  }

  if (!pageNotes.length) {
    notesList.innerHTML = emptyState("No notes for this page yet.");
    return;
  }

  notesList.innerHTML = "";
  pageNotes
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .slice(0, 20)
    .forEach((n, i) => {
      const card = document.createElement("div");
      card.className = "note-card";
      card.style.animationDelay = `${i * 45}ms`;

      const hasFooter = n.pinned || n.folder;
      card.innerHTML = `
        <div class="note-card-top">
          <div class="note-title-row">
            <div class="note-title">${esc(n.title)}</div>
            <div class="note-actions">
              <button class="btn-edit"
                data-id="${n.id}"
                data-title="${esc(n.title)}"
                data-content="${esc(n.content)}"
                title="Edit">
                <svg viewBox="0 0 24 24" width="10" height="10" style="stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="btn-delete" data-id="${n.id}" title="Delete">
                <svg viewBox="0 0 24 24" width="10" height="10" style="stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          ${n.selection ? `<div class="note-selection" style="white-space:pre-wrap;word-break:break-word;">"${esc(n.selection)}"</div>` : ""}
          ${n.content ? `<div class="note-content"   style="white-space:pre-wrap;word-break:break-word;">${esc(n.content)}</div>` : ""}
        </div>
        ${
          hasFooter
            ? `
        <div class="note-card-footer">
          ${n.pinned ? `<span class="note-pinned-tag">⭐ Pinned</span>` : ""}
          ${n.folder ? `<span class="note-folder-tag">📁 ${esc(n.folder)}</span>` : ""}
        </div>`
            : ""
        }
      `;

      notesList.appendChild(card);
    });
}

function emptyState(msg) {
  return `<div class="empty-state"><div class="empty-state-icon">📝</div><div>${msg}</div></div>`;
}

/* ═══════════════════════════════════════
   EDIT / DELETE
═══════════════════════════════════════ */
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

      // FIX: validate prompt input length before writing back to storage.
      // Previously there was no length check — a very long title or content
      // would be stored and then silently truncated by the backend on sync.
      const title = prompt("Edit title:", editBtn.dataset.title);
      if (title === null) return;
      if (title.trim().length > MAX_TITLE_LEN) {
        alert(`Title too long (max ${MAX_TITLE_LEN} characters).`);
        return;
      }

      const content = prompt("Edit content:", editBtn.dataset.content);
      if (content === null) return;
      if (content.trim().length > MAX_CONTENT_LEN) {
        alert(
          `Content too long (max ${MAX_CONTENT_LEN.toLocaleString()} characters).`,
        );
        return;
      }

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

/* ═══════════════════════════════════════
   AI: SUMMARIZE PAGE
═══════════════════════════════════════ */
const aiGenerateBtn = document.getElementById("aiGenerateBtn");
const aiNotesContainer = document.getElementById("aiNotesContainer");

if (aiGenerateBtn) {
  aiGenerateBtn.addEventListener("click", async () => {
    const hasAccess = await ProMode.canAccessAI();
    if (!hasAccess) {
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard/dashboard.html"),
      });
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return;

    const isYouTube = tab.url.includes("youtube.com");

    aiGenerateBtn.disabled = true;
    aiNotesContainer.style.display = "none";
    aiNotesContainer.innerHTML = "";

    let generatedNotes = null;

    if (isYouTube) {
      setAiBtnState("⏳ Connecting to page…");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch (e) {
        console.log("Inject note:", e.message);
      }

      await delay(800);
      setAiBtnState("⏳ Fetching transcript…");

      let transcriptResult;
      let attempts = 0;
      while (attempts < 3) {
        try {
          transcriptResult = await chrome.tabs.sendMessage(tab.id, {
            action: "GET_YOUTUBE_TRANSCRIPT",
          });
          break;
        } catch (e) {
          attempts++;
          if (attempts >= 3)
            return resetAiBtn(
              "❌ Could not reach page. Reload the YouTube tab and try again.",
            );
          await delay(600);
        }
      }

      if (!transcriptResult || transcriptResult.error) {
        const err = transcriptResult?.error || "";
        if (err === "NO_TRANSCRIPT") return showNoTranscriptUI(tab);
        if (err === "NO_MORE_BTN")
          return resetAiBtn(
            "❌ Could not find video menu. Scroll down and try again.",
          );
        if (err === "NO_SEGMENTS")
          return resetAiBtn("❌ Transcript opened but text couldn't be read.");
        return resetAiBtn(`❌ ${err || "Unknown error."}`);
      }

      setAiBtnState("🤖 Summarizing transcript…");
      try {
        generatedNotes = await AIService.generateNotesFromTranscript(
          transcriptResult.transcript,
          transcriptResult.title,
        );
      } catch (e) {
        return resetAiBtn("❌ AI summarization failed.");
      }
    } else {
      setAiBtnState("⏳ Reading page…");
      let pageText = "";
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.textContent,
        });
        pageText = results[0]?.result || "";
      } catch (e) {
        return resetAiBtn("❌ Extension lacks permission for this page.");
      }

      if (pageText.trim().length < 50)
        return resetAiBtn("❌ Not enough text on this page.");
      setAiBtnState("✨ Generating notes…");
      try {
        generatedNotes = await AIService.generateNotesFromPage(pageText);
      } catch (e) {
        console.error("Page AI error:", e);
      }
    }

    if (!Array.isArray(generatedNotes) || generatedNotes.length === 0) {
      return resetAiBtn("❌ AI returned no notes. Please try again.");
    }

    aiGenerateBtn.style.display = "none";
    aiNotesContainer.style.display = "block";

    const label = isYouTube
      ? "🎬 Video Notes Preview"
      : "✨ AI Generated Concepts";

    const headerEl = document.createElement("div");
    headerEl.className = "ai-preview-header";
    headerEl.innerHTML = `
      <span class="ai-preview-label">${label}</span>
      <button class="ai-cancel-btn" id="cancelAiBtn">Cancel</button>`;
    aiNotesContainer.appendChild(headerEl);

    generatedNotes.forEach((n, idx) => {
      const card = document.createElement("div");
      card.className = "ai-review-card";
      card.style.animationDelay = `${idx * 50}ms`;
      card.innerHTML = `
        <input type="checkbox" id="ai-chk-${idx}" class="ai-checkbox" checked>
        <div class="ai-review-card-body">
          <label for="ai-chk-${idx}" class="ai-review-title">${esc(n.title || "Untitled Concept")}</label>
          <div class="ai-review-content">${esc(n.content || "")}</div>
        </div>`;
      card.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT" && e.target.tagName !== "LABEL") {
          const chk = document.getElementById(`ai-chk-${idx}`);
          if (chk) chk.checked = !chk.checked;
        }
      });
      aiNotesContainer.appendChild(card);
    });

    const saveBtnEl = document.createElement("button");
    saveBtnEl.className = "ai-save-btn";
    saveBtnEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" style="stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save Selected Notes`;
    aiNotesContainer.appendChild(saveBtnEl);

    saveBtnEl.addEventListener("click", async () => {
      saveBtnEl.disabled = true;
      saveBtnEl.innerHTML = "Saving…";
      const folderName = isYouTube ? "YouTube Notes" : null;

      const notesToSave = generatedNotes
        .filter((_, idx) => document.getElementById(`ai-chk-${idx}`)?.checked)
        .map((n, idx) => ({
          // FIX: standardised ID with entropy — was Date.now()-idx which still
          // risks collision and produces non-unique IDs across sessions.
          id: generateNoteId("ai"),
          url: tab.url,
          domain: new URL(tab.url).hostname || "Unknown",
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
        let current = storage[STORAGE_KEY] || [];
        if (typeof current === "string") {
          try {
            current = JSON.parse(current);
          } catch {
            current = [];
          }
        }
        const updated = [...current, ...notesToSave];
        cachedNotes = updated;
        rebuildNotesCache(updated);
        await chrome.storage.local.set({ [STORAGE_KEY]: updated });
      }

      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      aiGenerateBtn.style.display = "flex";
      aiGenerateBtn.disabled = false;
      resetAiBtn(null);
      loadPageNotes();
    });

    document.getElementById("cancelAiBtn").addEventListener("click", () => {
      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      aiGenerateBtn.style.display = "flex";
      aiGenerateBtn.disabled = false;
    });
  });
}

function setAiBtnState(text) {
  const title = aiGenerateBtn?.querySelector(".ai-strip-title");
  if (title) title.textContent = text;
}

function resetAiBtn(msg) {
  if (aiGenerateBtn) {
    aiGenerateBtn.disabled = false;
    aiGenerateBtn.style.display = "flex";
  }
  const title = aiGenerateBtn?.querySelector(".ai-strip-title");
  const sub = aiGenerateBtn?.querySelector(".ai-strip-sub");
  if (msg && title) {
    title.textContent = msg;
    setTimeout(() => {
      if (title) title.textContent = "✨ Summarize Page to Notes";
      if (sub) sub.textContent = "AI generates key concepts from this page";
    }, 2800);
  } else if (title) {
    title.textContent = "✨ Summarize Page to Notes";
    if (sub) sub.textContent = "AI generates key concepts from this page";
  }
}

function showNoTranscriptUI(tab) {
  if (aiGenerateBtn) aiGenerateBtn.style.display = "none";
  aiNotesContainer.style.display = "block";
  aiNotesContainer.innerHTML = `
    <div class="ai-error-card">
      <strong>⚠️ No transcript available</strong>
      This video doesn't have captions enabled by the creator.
      <div style="font-weight:600;margin-top:8px;margin-bottom:4px;">Try instead:</div>
      <ul>
        <li><strong>Enable auto-captions</strong> — Settings → Subtitles → Auto-generated</li>
        <li><strong>Tactiq</strong> — <a href="https://tactiq.io" target="_blank" style="color:var(--acc);">tactiq.io</a> generates transcripts free</li>
        <li>Summarize the page description instead (button below)</li>
      </ul>
      <button class="ai-error-btn-primary" id="fallbackPageBtn">📄 Summarize Page Description</button>
      <button class="ai-error-btn-dismiss" id="dismissNoTranscriptBtn">Dismiss</button>
    </div>`;

  document
    .getElementById("fallbackPageBtn")
    .addEventListener("click", async () => {
      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      if (aiGenerateBtn) {
        aiGenerateBtn.style.display = "flex";
        aiGenerateBtn.disabled = true;
      }
      setAiBtnState("⏳ Reading page description…");

      let pageText = "";
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.textContent,
        });
        pageText = results[0]?.result || "";
      } catch (e) {
        return resetAiBtn("❌ Could not read page.");
      }

      if (pageText.trim().length < 50)
        return resetAiBtn("❌ Not enough page text.");
      setAiBtnState("✨ Generating notes…");

      let fallbackNotes = null;
      try {
        fallbackNotes = await AIService.generateNotesFromPage(pageText);
      } catch (e) {
        return resetAiBtn("❌ AI generation failed.");
      }

      if (!Array.isArray(fallbackNotes) || fallbackNotes.length === 0)
        return resetAiBtn("❌ AI returned no notes.");

      resetAiBtn(null);
    });

  document
    .getElementById("dismissNoTranscriptBtn")
    .addEventListener("click", () => {
      aiNotesContainer.style.display = "none";
      aiNotesContainer.innerHTML = "";
      if (aiGenerateBtn) {
        aiGenerateBtn.style.display = "flex";
        aiGenerateBtn.disabled = false;
      }
    });
}

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
