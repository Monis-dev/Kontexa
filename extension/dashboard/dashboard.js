const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const PRO_CACHE_KEY = "cn_is_pro_cached";
const THEME_KEY = "cn_theme";
const NAMES_KEY = "cn_source_names";
const API_BASE = "https://context-notes.onrender.com";

let mId = null;
let userFolders = [];
let sourceNames = {};
let isProUserUI = false;
let notesById = {};
let notesByUrl = {};
let sectionCache = [];
let folderCounts = {};

let syncQueue = [];
let syncTimer = null;
let lastSyncTime = 0;
let retryDelay = 2000;

const SYNC_DEBOUNCE = 4000;
const SYNC_MAX_INTERVAL = 30000;
const MAX_BATCH_SIZE = 25;

const $ = (id) => document.getElementById(id);
const E = (el, ev, fn) => {
  if (el) el.addEventListener(ev, fn);
};
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let eId = null,
  tT = null,
  allNotesFlat = [];
let isLoggedIn = false;

const getSafeId = (str) => "sec_" + str.replace(/[^a-zA-Z0-9]/g, "_");

const toast = (m, ms = 2600) => {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("on");
  clearTimeout(tT);
  tT = setTimeout(() => t.classList.remove("on"), ms);
};

/* ═══════════════════════════════════════
   SIDEBAR TOGGLE
═══════════════════════════════════════ */
const mob = () => window.innerWidth <= 768;
const openS = () => {
  $("side").classList.remove("closed");
  $("hbtn").classList.add("open");
  if (mob()) $("ovl").classList.add("on");
};
const closeS = () => {
  $("side").classList.add("closed");
  $("hbtn").classList.remove("open");
  $("ovl").classList.remove("on");
};
E($("hbtn"), "click", () =>
  $("side").classList.contains("closed") ? openS() : closeS(),
);
E($("ovl"), "click", () => {
  closeS();
  closeSettingsPanel();

  // Also close modals
  $("aiModal")?.classList.remove("on");
  $("guideModal")?.classList.remove("on");
});

/* ═══════════════════════════════════════
   RIGHT SETTINGS PANEL
═══════════════════════════════════════ */
function openSettingsPanel() {
  $("settingsPanel").classList.add("open");
  $("ovl").classList.add("on");
}
function closeSettingsPanel() {
  $("settingsPanel").classList.remove("open");
  // Only remove overlay if sidebar is also closed
  if ($("side").classList.contains("closed")) {
    $("ovl").classList.remove("on");
  }
}

E($("settingsPanelBtn"), "click", (e) => {
  e.stopPropagation();
  const isOpen = $("settingsPanel").classList.contains("open");
  if (isOpen) closeSettingsPanel();
  else openSettingsPanel();
});
E($("settingsPanelClose"), "click", closeSettingsPanel);

// Close panel when clicking overlay
E($("ovl"), "click", closeSettingsPanel);

/* ═══════════════════════════════════════
   SYNC MENU
═══════════════════════════════════════ */
E($("synbtn"), "click", (e) => {
  e.stopPropagation();
  $("synmenu").classList.toggle("on");
});
E(document, "click", (e) => {
  if (
    $("synmenu") &&
    !$("synmenu").contains(e.target) &&
    e.target !== $("synbtn")
  )
    $("synmenu").classList.remove("on");
});

/* ═══════════════════════════════════════
   MODALS
═══════════════════════════════════════ */
E($("infoBtn"), "click", () => {
  $("proceedLoginBtn").style.display = "none";
  $("guideModal").classList.add("on");
  closeSettingsPanel();
});
E($("closeGuideBtn"), "click", () => $("guideModal").classList.remove("on"));
E($("proceedLoginBtn"), "click", () => {
  $("guideModal").classList.remove("on");
  window.open(`${API_BASE}/login`, "_blank");
});

E($("cancelLogout"), "click", () => $("logoutModal").classList.remove("on"));
E($("logoutKeepBtn"), "click", async () => {
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {}
  window.location.reload();
});
E($("logoutWipeBtn"), "click", async () => {
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {}
  chrome.storage.local.clear(() => window.location.reload());
});

/* ═══════════════════════════════════════
   AI CHAT MODAL
═══════════════════════════════════════ */
E($("aiBtn"), "click", () => {
  // Close settings panel first
  closeSettingsPanel();

  const modal = $("aiModal");

  if (!modal) return;

  modal.dataset.context = JSON.stringify(allNotesFlat || []);

  modal.classList.add("on");
});

E($("closeAiBtn"), "click", () => {
  $("aiModal")?.classList.remove("on");
});

// Close when clicking background
E($("aiModal"), "click", (e) => {
  if (e.target.id === "aiModal") {
    $("aiModal").classList.remove("on");
  }
});

/* ═══════════════════════════════════════
   SYNC
═══════════════════════════════════════ */
function queueSync(notes) {
  if (!isLoggedIn) return;
  if (!Array.isArray(notes)) notes = [notes];
  fetch(`${API_BASE}/api/sync`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notes),
  })
    .then((res) => {
      if (res.ok) {
        chrome.storage.local.get(STORAGE_KEY, (localRes) => {
          let stored = localRes[STORAGE_KEY] || [];
          const syncedIds = new Set(notes.map((n) => n.id));
          stored = stored.map((n) =>
            syncedIds.has(n.id) ? { ...n, _synced: true } : n,
          );
          chrome.storage.local.set({ [STORAGE_KEY]: stored });
        });
      }
    })
    .catch((err) => console.warn("Sync failed:", err));
}

/* ═══════════════════════════════════════
   VIEW NOTE MODAL
═══════════════════════════════════════ */
function openNoteModal(noteId) {
  const n = notesById[noteId];
  if (!n) return;

  $("vTitle").textContent = n.title || "Untitled";

  const metaParts = [];
  if (n.pinned)
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:3px 8px;border-radius:20px;">⭐ Pinned</span>`,
    );
  if (n.folder)
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:var(--acc-bg);color:var(--acc);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;">📁 ${esc(n.folder)}</span>`,
    );
  if (n.timestamp)
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe;padding:3px 8px;border-radius:20px;">⏱️ ${esc(n.timestamp)}</span>`,
    );
  if (n.domain)
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;background:var(--bg);color:var(--mut);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;">🌐 ${esc(n.domain)}</span>`,
    );
  if (n.url)
    metaParts.push(
      `<a href="${esc(n.url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;background:var(--bg);color:var(--acc);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;text-decoration:none;">↗ Visit Source</a>`,
    );
  $("vMeta").innerHTML = metaParts.join("");

  const selEl = $("vSelection");
  if (n.selection || n.text_selection) {
    selEl.textContent = `"${n.selection || n.text_selection}"`;
    selEl.style.display = "block";
  } else {
    selEl.style.display = "none";
  }

  const contentEl = $("vContent");
  if (n.content) {
    contentEl.textContent = n.content;
    contentEl.style.display = "block";
  } else {
    contentEl.style.display = "none";
  }

  const imgWrap = $("vImageWrap");
  const img = $("vImage");
  if (n.image_data) {
    img.src = n.image_data;
    imgWrap.style.display = "block";
  } else {
    imgWrap.style.display = "none";
    img.src = "";
  }

  $("viewModal").classList.add("on");
}

E($("closeView"), "click", () => $("viewModal").classList.remove("on"));
E($("viewModal"), "click", (e) => {
  if (e.target === $("viewModal")) $("viewModal").classList.remove("on");
});

/* ═══════════════════════════════════════
   RENAME SOURCE
═══════════════════════════════════════ */
function renameSource(url, currentName) {
  const newName = prompt(`Rename "${currentName}" to:`, currentName);
  const clean = newName?.trim();
  if (!clean || clean === currentName) return;
  sourceNames[url] = newName.trim();
  chrome.storage.local.set({ [NAMES_KEY]: sourceNames }, async () => {
    toast(`Renamed to "${newName.trim()}"`);
    loadLocalUI();
    if (isLoggedIn) {
      try {
        await fetch(`${API_BASE}/api/websites/rename`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, custom_name: newName.trim() }),
          credentials: "include",
        });
      } catch (err) {
        console.error("Failed to sync rename", err);
      }
    }
  });
}

function getDisplayName(url) {
  if (sourceNames[url]) return sourceNames[url];
  let name = url.replace(/^https?:\/\/(www\.)?/, "");
  return name.length > 50 ? name.substring(0, 50) + "…" : name;
}

/* ═══════════════════════════════════════
   CARD GENERATOR — redesigned
   Heights are natural/auto; no forced equal sizes.
═══════════════════════════════════════ */
const card = (n, dom, index = 0) => {
  const title = n.title || "Untitled";
  const body = n.content || "";
  const sel = n.selection || n.text_selection || "";
  const searchStr = (title + " " + body).toLowerCase();
  const pinColor = n.pinned ? "#f59e0b" : "currentColor";
  const pinFill = n.pinned ? "#f59e0b" : "none";

  /* ── Build inner content pieces ── */
  let contentPieces = "";

  // Timestamp chip (small, inline)
  if (n.timestamp) {
    contentPieces += `<div class="c-timestamp">⏱️ ${esc(n.timestamp)}</div>`;
  }

  // Highlighted quote
  if (sel) {
    contentPieces += `<div class="chi">"${esc(sel)}"</div>`;
  }

  // Note body text
  if (body) {
    contentPieces += `<div class="cb">${esc(body)}</div>`;
  }

  // If nothing at all — show a subtle empty hint so card doesn't look broken
  if (!sel && !body && !n.image_data && !n.timestamp) {
    contentPieces += `<div class="card-empty-hint">No description added.</div>`;
  }

  /* ── Image — only if present, full-bleed below content ── */
  const imageHtml = n.image_data
    ? `<img class="card-img" loading="lazy" src="${n.image_data}" alt="Screenshot"/>`
    : "";

  /* ── Tags ── */
  const tagsHtml = `
    <div class="ctags">
      <span class="tag">${esc(dom.slice(0, 22))}</span>
      ${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}
    </div>`;

  return `
  <div class="card card-clickable"
       data-id="${n.id}"
       data-t="${esc(searchStr)}"
       data-open-note="${n.id}"
       style="--i:${index};"
       title="Click to view note">

    <div class="card-top">
      <div class="ct">${esc(title)}</div>
      ${contentPieces}
    </div>

    ${imageHtml}

    <div class="card-footer">
      ${tagsHtml}
      <div class="ca">
        <button class="act btn-pin" title="${n.pinned ? "Unpin" : "Pin"}" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:${pinColor};fill:${pinFill};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="act btn-move" title="Move to Folder" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="act btn-edit" title="Edit" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="act del btn-delete" title="Delete" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>`;
};

/* ═══════════════════════════════════════
   FOLDER HELPERS
═══════════════════════════════════════ */
function ensureFolder(folderName) {
  chrome.storage.local.get([FOLDERS_KEY], (res) => {
    const folders = res[FOLDERS_KEY] || [];
    if (!folders.includes(folderName)) {
      const updated = [...folders, folderName];
      chrome.storage.local.set({ [FOLDERS_KEY]: updated });
      userFolders = updated;
    }
  });
}

/* ═══════════════════════════════════════
   RENDER DASHBOARD
═══════════════════════════════════════ */
function render(urlGroups, folderGroups) {
  $("skel")?.remove();
  const total = allNotesFlat.length;
  $("smeta").textContent =
    `${urlGroups.length} page${urlGroups.length !== 1 ? "s" : ""} · ${total} notes`;

  $("snav").innerHTML = urlGroups.length
    ? urlGroups
        .map((s, i) => {
          const displayName = sourceNames[s.url]
            ? sourceNames[s.url]
            : s.domain.replace(/^www\./, "");
          return `<a class="na${i === 0 ? " on" : ""}" href="#${s.id}" data-t="${s.id}" title="${esc(s.url)}" style="animation-delay:${i * 40}ms;">
          <div class="dot"></div>
          <span class="nd">${esc(displayName)}</span>
          <span class="bdg">${s.notes.length}</span>
        </a>`;
        })
        .join("")
    : '<p style="padding:12px;font-size:13px;color:var(--mut)">No sources yet.</p>';

  const allGroups = [...folderGroups, ...urlGroups];
  const mainEl = $("main");

  if (!allGroups.length) {
    mainEl.innerHTML = `<div class="empty"><span>📝</span><h3>No notes yet</h3><p>Use the extension to highlight and save notes!</p></div>`;
    return;
  }

  mainEl.innerHTML =
    `<div class="mh">Your Notes</div>
     <div class="ms"><strong id="nc">${total}</strong> notes found</div>
     <div class="nores" id="nores"><h3>No notes match "<span id="noresq"></span>"</h3></div>` +
    allGroups
      .map((group, i) => {
        const isFolderGroup = group.type === "folder";
        const pinnedNotes = group.notes.filter((n) => n.pinned);
        const unpinnedNotes = group.notes.filter((n) => !n.pinned);
        let displayNotes = [];
        let hiddenCount = 0;
        if (pinnedNotes.length > 0) {
          displayNotes = pinnedNotes.slice(0, 3);
          hiddenCount = group.notes.length - displayNotes.length;
        } else {
          displayNotes = unpinnedNotes.slice(0, 3);
          hiddenCount = Math.max(0, group.notes.length - 3);
        }

        const gridHTML = displayNotes
          .map((n, idx) => card(n, group.domain, idx))
          .join("");
        const viewAllLabel =
          hiddenCount > 0
            ? `View All ${group.notes.length} Notes ➔`
            : `View Notes & Export ➔`;
        const viewAllTarget = isFolderGroup
          ? `folder:${group.domain}`
          : group.url;
        const displayName = isFolderGroup
          ? group.domain
          : getDisplayName(group.url);

        let headerHtml = "";
        if (isFolderGroup) {
          headerHtml = `
        <div class="sech">
          <div class="globe" style="background:var(--hbg);">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--hbdr);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span class="sdom">${esc(displayName)}</span>
          <div class="folder-actions"
              style="display:flex;flex-direction:row;align-items:center;gap:6px;">

            <!-- Rename Folder -->
            <button
              class="act btn-rename-folder"
              data-folder="${esc(displayName)}"
              title="Rename Folder"
            >
              <svg viewBox="0 0 24 24"
                  style="width:13px;height:13px;stroke:currentColor;fill:none;
                          stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
                          pointer-events:none;">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
            </button>

            <!-- Delete Folder -->
            <button
              class="act del btn-delete-folder"
              data-folder="${esc(displayName)}"
              title="Delete Folder"
            >
              <svg viewBox="0 0 24 24"
                  style="width:13px;height:13px;stroke:currentColor;fill:none;
                          stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
                          pointer-events:none;">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>

          </div>
          <span class="scnt">${group.notes.length} note${group.notes.length !== 1 ? "s" : ""}</span>
          
        </div>`;
        } else {
          headerHtml = `
        <div class="sech">
          <div class="globe">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <span class="sdom sdom-name" data-custom="${sourceNames[group.url] ? "true" : "false"}"
                style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title="${esc(group.url)}">${esc(displayName)}</span>
          <button
            class="act btn-rename"
            data-url="${esc(group.url)}"
            data-name="${esc(displayName)}"
            title="Rename Source"
          >
            <svg viewBox="0 0 24 24"
                style="width:13px;height:13px;
                        stroke:currentColor;
                        fill:none;
                        stroke-width:2;
                        pointer-events:none;">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121
                      2.121 0 0 1 3 3
                      L7 19l-4 1
                      1-4 12.5-12.5z"/>
            </svg>
          </button>
          <a href="${esc(group.url)}" target="_blank" rel="noopener" class="slink">Visit ↗</a>
          <span class="scnt">${group.notes.length} note${group.notes.length !== 1 ? "s" : ""}</span>
        </div>`;
        }

        return `
      <div class="sec" id="${group.id}">
        ${headerHtml}
        <div class="grid">${gridHTML}</div>
        <div style="margin-top:12px;">
          <button class="btn-view-more" data-url="${esc(viewAllTarget)}">${viewAllLabel}</button>
        </div>
        ${i < allGroups.length - 1 ? '<div class="divider"></div>' : ""}
      </div>`;
      })
      .join("");

  sectionCache = [...document.querySelectorAll(".sec")];
  bindNav();
}

/* ═══════════════════════════════════════
   SCROLL / NAV
═══════════════════════════════════════ */
function scrollMainToSection(sectionId) {
  const mainEl = $("main");
  const target = $(sectionId);
  if (!mainEl || !target) return;
  mainEl.style.position = "relative";
  mainEl.scrollTo({ top: target.offsetTop - 28, behavior: "smooth" });
}

function bindNav() {
  const nas = document.querySelectorAll(".na[data-t]");
  nas.forEach((a) => {
    const fresh = a.cloneNode(true);
    a.parentNode.replaceChild(fresh, a);
    fresh.addEventListener("click", (e) => {
      e.preventDefault();
      if ($("singlePageView").style.display === "block") {
        $("singlePageView").style.display = "none";
        $("main").style.display = "block";
      }
      scrollMainToSection(fresh.dataset.t);
      document.querySelectorAll(".na").forEach((n) => n.classList.remove("on"));
      fresh.classList.add("on");
      if (mob()) closeS();
    });
  });
}

/* ═══════════════════════════════════════
   GLOBAL EVENT DELEGATION
═══════════════════════════════════════ */
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".btn-edit");
  const delBtn = e.target.closest(".btn-delete");
  const pinBtn = e.target.closest(".btn-pin");
  const moveBtn = e.target.closest(".btn-move");
  const viewMoreBtn = e.target.closest(".btn-view-more");
  const logoutBtn = e.target.closest("#logoutBtn");
  const renameFolderBtn = e.target.closest(".btn-rename-folder");
  const deleteFolderBtn = e.target.closest(".btn-delete-folder");
  const renameBtn = e.target.closest(".btn-rename");
  const noteCard = e.target.closest("[data-open-note]");

  const saveBtn = e.target.closest(".btn-save-domain");
  if (saveBtn) {
    const idx = parseInt(saveBtn.dataset.index, 10);
    const note = (window.aiGeneratedNotes || [])[idx];
    if (note) {
      saveAINote(note);
      saveBtn.textContent = "Saved ✓";
      saveBtn.disabled = true;
    }
    return;
  }
  if (noteCard && !editBtn && !delBtn && !pinBtn && !moveBtn) {
    openNoteModal(noteCard.dataset.openNote);
    return;
  }
  if (renameBtn) {
    renameSource(renameBtn.dataset.url, renameBtn.dataset.name);
    return;
  }

  if (viewMoreBtn) {
    const url = viewMoreBtn.dataset.url;
    if (url.startsWith("folder:"))
      openSpecificFolder(url.replace("folder:", ""));
    else openSpecificPage(url);
    return;
  }

  if (logoutBtn) {
    $("synmenu").classList.remove("on");
    $("logoutModal").classList.add("on");
  }

  if (moveBtn) {
    if (!isProUserUI) {
      if ($("paywallModal")) $("paywallModal").classList.add("on");
      return;
    }
    mId = moveBtn.dataset.id;
    const currentFolder = allNotesFlat.find((n) => n.id === mId)?.folder || "";
    const select = $("folderSelect");
    select.innerHTML =
      `<option value="">[ Remove from Folder ]</option>` +
      userFolders
        .map(
          (f) =>
            `<option value="${esc(f)}" ${f === currentFolder ? "selected" : ""}>${esc(f)}</option>`,
        )
        .join("");
    $("moveModal").classList.add("on");
  }

  if (e.target.id === "createFolderBtn") {
    const name = prompt("Enter new folder name:");
    if (name && name.trim()) {
      const newName = name.trim();
      if (!userFolders.includes(newName)) {
        userFolders.push(newName);
        chrome.storage.local.set({ [FOLDERS_KEY]: userFolders }, () => {
          renderFoldersSidebar();
          loadLocalUI();
          toast(`Folder "${newName}" created!`);
        });
      } else {
        toast("A folder with that name already exists.");
      }
    }
  }

  if (pinBtn) {
    const id = pinBtn.dataset.id;
    const idx = allNotesFlat.findIndex((n) => String(n.id) === String(id));
    if (idx > -1) {
      allNotesFlat[idx].pinned = !allNotesFlat[idx].pinned;
      chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
        if ($("singlePageView").style.display === "block")
          openSpecificPage(allNotesFlat[idx].url);
        else loadLocalUI();
        if (isLoggedIn) {
          try {
            await fetch(`${API_BASE}/api/notes/${id}`, {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pinned: allNotesFlat[idx].pinned }),
            });
          } catch (err) {
            console.error("Pin sync failed", err);
          }
        }
      });
    }
  }

  if (editBtn) {
    eId = editBtn.dataset.id;
    const n = notesById[eId] || {};
    $("etitle").value = n.title || "";
    $("eta").value = n.content || "";
    $("modal").classList.add("on");
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    if (!confirm("Delete this note?")) return;
    const url = allNotesFlat.find((n) => n.id === id)?.url;
    allNotesFlat = allNotesFlat.filter((n) => String(n.id) !== String(id));
    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      toast("Note deleted");
      if ($("singlePageView").style.display === "block" && url)
        openSpecificPage(url);
      else loadLocalUI();
      if (isLoggedIn) {
        try {
          await fetch(`${API_BASE}/api/notes/${id}`, {
            method: "DELETE",
            credentials: "include",
          });
        } catch (err) {
          console.error("Server delete failed:", err);
        }
      }
    });
  }
  // Delet folder
  if (deleteFolderBtn) {
    const folder = deleteFolderBtn.dataset.folder;

    if (!confirm(`Delete folder "${folder}"?\nNotes will remain.`)) return;

    deleteFolder(folder);

    return;
  }

  // Rename
  if (renameFolderBtn) {
    const oldName = renameFolderBtn.dataset.folder;

    const newName = prompt("Rename folder:", oldName);

    if (!newName || newName === oldName) return;

    renameFolder(oldName, newName);
  }
});

function saveAINote(note) {
  const newNote = {
    id: "ai_" + Date.now(),
    title: note.title,
    content: note.content,
    tags: note.tags || [],
    url: "ai://generated", // safe placeholder — no fake domain
    domain: "ai-generated",
    folder: null,
    pinned: false,
    timestamp: null,
    image_data: null,
    createdAt: new Date().toISOString(),
    _synced: false,
  };

  chrome.storage.local.get(["context_notes_data"], (res) => {
    let notes = res.context_notes_data || [];
    notes.push(newNote);
    chrome.storage.local.set({ context_notes_data: notes }, () => {
      toast("Note saved ✓");
      loadLocalUI();
    });
  });
}

/* ═══════════════════════════════════════
   MOVE / EDIT
═══════════════════════════════════════ */
E($("cancelMove"), "click", () => {
  $("moveModal").classList.remove("on");
  mId = null;
});
E($("saveMove"), "click", async () => {
  const selectedFolder = $("folderSelect").value;
  const idx = allNotesFlat.findIndex((n) => n.id === mId);
  if (idx > -1) {
    allNotesFlat[idx].folder = selectedFolder || null;
    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      $("moveModal").classList.remove("on");
      mId = null;
      toast("Note moved ✓");
      loadLocalUI();
      if (isLoggedIn) {
        try {
          await fetch(`${API_BASE}/api/notes/${mId}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: selectedFolder || null }),
          });
        } catch (err) {
          console.error("Move sync failed", err);
        }
      }
    });
  }
});

function closeEdit() {
  $("modal").classList.remove("on");
  eId = null;
}
E($("cancelEdit"), "click", closeEdit);
E($("modal"), "click", (e) => {
  if (e.target === $("modal")) closeEdit();
});
E($("saveEdit"), "click", async () => {
  const titleVal = $("etitle").value.trim() || "Untitled";
  const contentVal = $("eta").value.trim();
  const idx = allNotesFlat.findIndex((n) => n.id === eId);
  if (idx > -1) {
    allNotesFlat[idx].title = titleVal;
    allNotesFlat[idx].content = contentVal;
    const savedId = eId;
    const url = allNotesFlat[idx].url;
    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      closeEdit();
      toast("Saved ✓");
      if ($("singlePageView").style.display === "block") openSpecificPage(url);
      else loadLocalUI();
      if (isLoggedIn) {
        try {
          await fetch(`${API_BASE}/api/notes/${savedId}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: titleVal, content: contentVal }),
          });
        } catch (err) {
          console.error("Edit sync failed", err);
        }
      }
    });
  }
});

// Folder Funtions
// Delete\
async function deleteFolder(folderName) {
  // Remove locally
  userFolders = userFolders.filter((f) => f !== folderName);

  allNotesFlat = allNotesFlat.map((n) =>
    n.folder === folderName ? { ...n, folder: null } : n,
  );

  chrome.storage.local.set({
    [FOLDERS_KEY]: userFolders,
    [STORAGE_KEY]: allNotesFlat,
  });

  loadLocalUI();

  // Sync backend
  if (isLoggedIn) {
    try {
      await fetch(`${API_BASE}/api/folders/${encodeURIComponent(folderName)}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch (err) {
      console.error("Folder delete failed", err);
    }
  }

  toast(`Folder "${folderName}" deleted`);
}

async function renameFolder(oldName, newName) {
  // Update folder list
  userFolders = userFolders.map((f) => (f === oldName ? newName : f));

  // Update notes
  allNotesFlat = allNotesFlat.map((n) =>
    n.folder === oldName ? { ...n, folder: newName } : n,
  );

  // Save locally
  chrome.storage.local.set({
    [FOLDERS_KEY]: userFolders,
    [STORAGE_KEY]: allNotesFlat,
  });

  // Refresh ALL UI
  renderFoldersSidebar();
  loadLocalUI();

  // Sync backend
  if (isLoggedIn) {
    try {
      await fetch(`${API_BASE}/api/folders/rename`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          old_name: oldName,
          new_name: newName,
        }),
      });
    } catch (err) {
      console.error("Rename folder failed", err);
    }
  }
}
/* ═══════════════════════════════════════
   SEARCH
═══════════════════════════════════════ */
E($("search"), "input", () => {
  if ($("singlePageView").style.display === "block") {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
  }
  const q = $("search").value.trim().toLowerCase();
  $("sc").classList.toggle("on", q.length > 0);
  let vis = 0;
  sectionCache.forEach((sec) => {
    const cards = [...sec.querySelectorAll(".card")];
    const matches = cards.filter((c) => !q || (c.dataset.t || "").includes(q));
    cards.forEach((c) => {
      c.style.display = !q || c.dataset.t.includes(q) ? "flex" : "none";
    });
    sec.style.display = matches.length > 0 ? "" : "none";
    vis += matches.length;
  });
  $("nores")?.classList.toggle("on", vis === 0 && q.length > 0);
});

E($("sc"), "click", () => {
  $("search").value = "";
  $("sc").classList.remove("on");
  $("search").dispatchEvent(new Event("input"));
  $("search").focus();
});

/* ═══════════════════════════════════════
   LOAD & GROUP DATA
═══════════════════════════════════════ */
function loadLocalUI() {
  chrome.storage.local.get([STORAGE_KEY, FOLDERS_KEY, NAMES_KEY], (res) => {
    let stored = res[STORAGE_KEY];
    if (typeof stored === "string") {
      try {
        stored = JSON.parse(stored);
      } catch (e) {
        stored = [];
      }
    }
    allNotesFlat = (stored || []).map((n) => ({ ...n, tags: n.tags || [] }));
    notesById = Object.fromEntries(allNotesFlat.map((n) => [n.id, n]));
    sourceNames = res[NAMES_KEY] || {};

    notesByUrl = {};
    const groupedUrls = {};
    const groupedFolders = {};
    folderCounts = {};

    for (const n of allNotesFlat) {
      if (n.url !== "general://notes" && n.url !== "folder://notes") {
        if (!notesByUrl[n.url]) notesByUrl[n.url] = [];
        notesByUrl[n.url].push(n);
        if (!groupedUrls[n.url]) {
          groupedUrls[n.url] = {
            id: getSafeId(n.url),
            domain: n.domain,
            url: n.url,
            notes: [],
            type: "url",
          };
        }
        groupedUrls[n.url].notes.push(n);
      }
      if (n.folder) {
        folderCounts[n.folder] = (folderCounts[n.folder] || 0) + 1;
        if (!groupedFolders[n.folder]) {
          groupedFolders[n.folder] = {
            id: getSafeId("folder_" + n.folder),
            domain: n.folder,
            url: `folder-${n.folder}`,
            notes: [],
            type: "folder",
          };
        }
        groupedFolders[n.folder].notes.push(n);
      }
    }

    const persistedFolders = res[FOLDERS_KEY] || [];
    const foldersFromNotes = allNotesFlat.map((n) => n.folder).filter(Boolean);
    userFolders = [...new Set([...persistedFolders, ...foldersFromNotes])];
    if (JSON.stringify(persistedFolders) !== JSON.stringify(userFolders)) {
      chrome.storage.local.set({ [FOLDERS_KEY]: userFolders });
    }
    userFolders.forEach((f) => {
      if (!groupedFolders[f]) {
        groupedFolders[f] = {
          id: getSafeId("folder_" + f),
          domain: f,
          url: `folder-${f}`,
          notes: [],
          type: "folder",
        };
      }
    });

    render(Object.values(groupedUrls), Object.values(groupedFolders));
    renderFoldersSidebar();
  });
}

function renderFoldersSidebar() {
  if (!isProUserUI) {
    $("fnav").innerHTML =
      '<p style="padding:12px;font-size:12px;color:var(--mut)">Upgrade to Pro to create custom folders.</p>';
    return;
  }
  $("fnav").innerHTML = userFolders.length
    ? userFolders
        .map((f, i) => {
          const count = folderCounts[f] || 0;
          const fid = getSafeId("folder_" + f);
          return `
            <a class="na"
              href="#${fid}"
              data-t="${fid}"
              style="animation-delay:${i * 40}ms;">
              <div class="dot"
                  style="border-radius:2px;background:var(--mut2);">
              </div>
              <span class="nd">
                ${esc(f)}
              </span>
              <span class="bdg">
                ${count}
              </span>
            </a>`;
        })
        .join("")
    : '<p style="padding:12px;font-size:12px;color:var(--mut)">No folders yet.</p>';
  bindNav();
}

function renderNoNotesSuggestion(question, notes) {
  const chatBox = $("aiChatBox");

  if (!notes || !Array.isArray(notes) || notes.length === 0) {
    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai">
        ⚠️ No notes found and couldn't generate suggestions. Try rephrasing your question.
      </div>`,
    );
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  window.aiGeneratedNotes = notes;

  const cardsHtml = notes
    .map(
      (n, i) => `
    <div style="
      background: var(--bg, #fff);
      border: 1px solid var(--bdr, #e2e8f0);
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    ">
      <div style="font-weight: 600; font-size: 13px; color: var(--ink, #0f172a); line-height: 1.4;">
        ${esc(n.title)}
      </div>
      <div style="font-size: 12px; color: var(--mut, #64748b); line-height: 1.6;">
        ${esc(n.content)}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px;">
        ${(n.tags || [])
          .map(
            (t) =>
              `<span style="font-size: 11px; padding: 2px 8px; background: var(--acc-bg, #eff6ff); color: var(--acc, #3b82f6); border-radius: 20px; border: 1px solid var(--bdr, #e2e8f0);">#${esc(t)}</span>`,
          )
          .join("")}
      </div>
      <button
        class="btn-save-domain"
        data-index="${i}"
        style="
          margin-top: 4px;
          align-self: flex-start;
          font-size: 12px;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid var(--acc, #3b82f6);
          background: var(--acc, #3b82f6);
          color: #fff;
          cursor: pointer;
          transition: opacity 0.15s;
        "
        onmouseover="this.style.opacity='0.85'"
        onmouseout="this.style.opacity='1'"
      >+ Save Note</button>
    </div>
  `,
    )
    .join("");

  chatBox.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-msg chat-ai" style="padding: 0; background: none; border: none; box-shadow: none;">
      <div style="font-size: 12px; color: var(--mut, #64748b); margin-bottom: 10px; padding: 0 2px;">
        ⚠️ You have no notes on this topic. Here are some suggested notes you can save:
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${cardsHtml}
      </div>
    </div>`,
  );

  chatBox.scrollTop = chatBox.scrollHeight;
}

if (typeof chrome !== "undefined" && chrome.storage) {
  let reloadTimer = null;
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes[STORAGE_KEY] && !document.hidden) {
      if (
        !$("modal").classList.contains("on") &&
        $("singlePageView").style.display !== "block"
      ) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadLocalUI, 120);
      }
    }
  });
}

/* ═══════════════════════════════════════
   PAYWALL ACTIONS
═══════════════════════════════════════ */
E($("paywallLogoutBtn"), "click", async () => {
  const btn = $("paywallLogoutBtn");
  btn.textContent = "Disconnecting...";
  btn.disabled = true;
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {}
  isLoggedIn = false;
  $("paywallModal").classList.remove("on");
  $("uStatus").textContent = "Local Mode Only";
  const logoutBtnEl = $("logoutBtn");
  if (logoutBtnEl) {
    logoutBtnEl.outerHTML = `<div class="sitem" id="loginBtn">🔑 Sync via Google</div>`;
    E($("loginBtn"), "click", () => {
      $("synmenu").classList.remove("on");
      $("proceedLoginBtn").style.display = "block";
      $("guideModal").classList.add("on");
    });
  }
  toast("Disconnected. Your notes are safe locally.");
  btn.textContent = "No thanks, Log me out";
  btn.disabled = false;
});

E($("upgradeBtn"), "click", async () => {
  const btn = $("upgradeBtn");
  btn.textContent = "Opening Secure Checkout...";
  window.open(`${API_BASE}/pricing`, "_blank");
  setTimeout(() => {
    btn.textContent = "Upgrade Now ($5/mo)";
  }, 2000);
});

/* ═══════════════════════════════════════
   AUTH & SYNC
═══════════════════════════════════════ */
let isCheckingAuth = false;

async function checkAuthAndSync() {
  if (isCheckingAuth) return;
  isCheckingAuth = true;
  try {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
    if (res.ok) {
      const user = await res.json();
      isLoggedIn = true;
      isProUserUI = user.is_pro;
      chrome.storage.local.set({ [PRO_CACHE_KEY]: user.is_pro });
      if (isProUserUI) {
        $("createFolderBtn").style.display = "flex";
        $("proBadge").style.display = "inline";
      }
      const planName = user.is_pro ? "Pro Plan" : "Free Plan";
      const statusColor = user.is_pro ? "#4f46e5" : "#64748b";
      $("uStatus").innerHTML =
        `<span style="color:${statusColor};font-weight:bold;">${planName}</span> • ${user.email}`;
      if ($("loginBtn"))
        $("loginBtn").outerHTML =
          `<div class="sitem danger" id="logoutBtn">🚪 Logout</div>`;

      if (!user.is_pro) {
        if ($("paywallModal")) $("paywallModal").classList.add("on");
        loadLocalUI();
        return;
      }

      chrome.storage.local.get(STORAGE_KEY, async (localRes) => {
        let localNotes = localRes[STORAGE_KEY] || [];
        if (typeof localNotes === "string") {
          try {
            localNotes = JSON.parse(localNotes);
          } catch (e) {
            localNotes = [];
          }
        }
        const notesToPush = localNotes.filter((n) => !n._synced);
        if (notesToPush.length > 0) queueSync(notesToPush);

        const [cloudRes, generalRes] = await Promise.all([
          fetch(`${API_BASE}/api/notes`, { credentials: "include" }),
          fetch(`${API_BASE}/api/general-notes`, { credentials: "include" }),
        ]);

        if (cloudRes.ok) {
          const cloudData = await cloudRes.json();
          const generalNotes = generalRes.ok ? await generalRes.json() : [];

          cloudData.forEach((site) => {
            if (site.custom_name) sourceNames[site.url] = site.custom_name;
          });
          chrome.storage.local.set({ [NAMES_KEY]: sourceNames });

          const localForFolderLookup = localNotes.reduce((acc, n) => {
            if (n.folder) acc[n.id] = n.folder;
            return acc;
          }, {});

          let flattenedCloudNotes = [];
          cloudData.forEach((site) =>
            site.notes.forEach((n) => {
              flattenedCloudNotes.push({
                id: n.id,
                url: site.url,
                domain: site.domain,
                title: n.title,
                content: n.content,
                selection: n.selection,
                pinned: n.pinned,
                timestamp: n.timestamp,
                image_data: n.image_data,
                folder: n.folder || localForFolderLookup[n.id] || null,
                deleted: n.deleted || false,
                _synced: true,
              });
            }),
          );
          generalNotes.forEach((n) =>
            flattenedCloudNotes.push({ ...n, _synced: true }),
          );

          const cloudIdSet = new Set(flattenedCloudNotes.map((n) => n.id));
          const localOnlyNotes = localNotes.filter(
            (n) => !cloudIdSet.has(n.id),
          );
          const trulyNewNotes =
            cloudIdSet.size === 0
              ? localOnlyNotes
              : localOnlyNotes.filter((n) => !n._synced);

          const mergedMap = new Map();
          flattenedCloudNotes.forEach((n) => mergedMap.set(n.id, n));
          trulyNewNotes.forEach((n) => mergedMap.set(n.id, n));
          localNotes.forEach((n) => {
            if (mergedMap.has(n.id))
              mergedMap.set(n.id, { ...mergedMap.get(n.id), ...n });
          });

          const mergedNotes = Array.from(mergedMap.values());
          chrome.storage.local.set({ [STORAGE_KEY]: mergedNotes }, () => {
            loadLocalUI();
            if (trulyNewNotes.length > 0) queueSync(trulyNewNotes);
          });
        }
      });
    } else {
      $("uStatus").textContent = "Local Mode Only";
      loadLocalUI();
    }
  } catch (e) {
    console.error("SYNC ERROR:", e);
    $("uStatus").textContent = "Offline / Server Unreachable";
    loadLocalUI();
  } finally {
    setTimeout(() => {
      isCheckingAuth = false;
    }, 4000);
  }
}

E($("loginBtn"), "click", () => {
  $("synmenu").classList.remove("on");
  $("proceedLoginBtn").style.display = "block";
  $("guideModal").classList.add("on");
});

let lastAuthCheck = 0;
window.addEventListener("focus", () => {
  const now = Date.now();
  if (now - lastAuthCheck > 15000) {
    lastAuthCheck = now;
    checkAuthAndSync();
  }
});

window.onload = () => {
  chrome.storage.local.get(PRO_CACHE_KEY, (res) => {
    isProUserUI = res[PRO_CACHE_KEY] === true;
    loadLocalUI();
  });
  checkAuthAndSync();
};

/* ═══════════════════════════════════════
   ADD NOTE MODAL
═══════════════════════════════════════ */
function openAddNoteModal(context) {
  const modal = $("addNoteModal");
  $("anTitle").value = "";
  $("anContent").value = "";
  $("anUrl").value = context.type === "page" ? context.url || "" : "";
  const urlRow = $("anUrlRow");
  if (context.type === "folder") {
    urlRow.style.display = "block";
    $("anUrlLabel").textContent = "Source URL (optional)";
  } else {
    urlRow.style.display = "block";
    $("anUrlLabel").textContent = "Source URL";
  }
  modal.dataset.context = JSON.stringify(context);
  modal.classList.add("on");
  setTimeout(() => $("anTitle").focus(), 80);
}

function closeAddNoteModal() {
  $("addNoteModal").classList.remove("on");
}

async function saveNewNote() {
  const titleVal = $("anTitle").value.trim();
  const contentVal = $("anContent").value.trim();
  const urlVal = $("anUrl").value.trim();

  if (!titleVal) {
    $("anTitle").focus();
    $("anTitle").style.borderColor = "#ef4444";
    setTimeout(() => ($("anTitle").style.borderColor = ""), 1200);
    return;
  }

  const context = JSON.parse($("addNoteModal").dataset.context || "{}");
  const isGeneralNote = context.type === "folder";

  const newNote = {
    id: "dash_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    title: titleVal,
    content: contentVal,
    selection: "",
    url: isGeneralNote
      ? "general://notes"
      : urlVal ||
        (context.type === "page" ? context.url : "dashboard://manual"),
    domain: isGeneralNote
      ? "general"
      : context.type === "page"
        ? context.domain ||
          urlVal.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ||
          "manual"
        : urlVal
          ? urlVal.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
          : "manual",
    folder: context.type === "folder" ? context.folderName : null,
    pinned: false,
    timestamp: null,
    image_data: null,
    createdAt: new Date().toISOString(),
    _synced: false,
  };

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    let latestNotes = res[STORAGE_KEY] || [];
    if (typeof latestNotes === "string") {
      try {
        latestNotes = JSON.parse(latestNotes);
      } catch (e) {
        latestNotes = [];
      }
    }
    latestNotes.push(newNote);
    allNotesFlat = latestNotes;

    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      closeAddNoteModal();
      toast("Note added ✓");
      if (context.type === "page") openSpecificPage(newNote.url);
      else openSpecificFolder(context.folderName);
      if (isLoggedIn) {
        try {
          await fetch(`${API_BASE}/api/sync`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([newNote]),
          });
        } catch (err) {
          console.error("Add sync failed", err);
        }
      }
    });
  });
}

E($("cancelAddNote"), "click", closeAddNoteModal);
E($("addNoteModal"), "click", (e) => {
  if (e.target === $("addNoteModal")) closeAddNoteModal();
});
E($("saveAddNote"), "click", saveNewNote);
E($("anContent"), "keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    saveNewNote();
  }
});

/* ═══════════════════════════════════════
   PAGE / FOLDER DETAIL VIEWS
═══════════════════════════════════════ */
function openSpecificPage(targetUrl) {
  $("main").style.display = "none";
  $("singlePageView").style.display = "block";

  const siteNotes = (notesByUrl[targetUrl] || []).filter(
    (n) => n.url !== "general://notes",
  );
  siteNotes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const displayName = getDisplayName(targetUrl);
  const pageDomain = targetUrl
    .replace(/^https?:\/\/(www\.)?/, "")
    .split("/")[0];

  $("singlePageView").innerHTML = `
    <button class="back-btn" id="backToDash">← Back to Dashboard</button>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:24px;">
      <div class="mh" style="word-break:break-all;">${esc(displayName)}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn" id="downloadMdBtn" title="Download notes as Markdown">⬇ .md</button>
        <button class="btn" id="addNoteBtn">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle;margin-right:4px;">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>Add Note
        </button>
      </div>
    </div>
    <div class="grid wrap" id="pageNoteGrid">
      ${
        siteNotes.length
          ? siteNotes.map((n, i) => card(n, pageDomain, i)).join("")
          : `<p style="color:var(--mut);font-size:13px;">No notes for this page yet.</p>`
      }
    </div>`;

  E($("backToDash"), "click", () => {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
    loadLocalUI();
  });
  E($("addNoteBtn"), "click", () => {
    openAddNoteModal({
      type: "page",
      url: targetUrl,
      domain: pageDomain,
      displayName,
    });
  });
  E($("downloadMdBtn"), "click", () => {
    const lines = [
      `# Notes — ${displayName}`,
      `*Exported from ContextNote on ${new Date().toLocaleDateString()}*`,
      `*Source: ${targetUrl}*`,
      "",
    ];
    siteNotes.forEach((n, i) => {
      lines.push(`## ${i + 1}. ${n.title || "Untitled"}`);
      const meta = [];
      if (n.pinned) meta.push("⭐ Pinned");
      if (n.folder) meta.push(`📁 ${n.folder}`);
      if (n.timestamp) meta.push(`⏱️ ${n.timestamp}`);
      if (meta.length) lines.push(`*${meta.join(" · ")}*`);
      if (n.selection) {
        lines.push("");
        lines.push(`> ${n.selection}`);
      }
      if (n.content) {
        lines.push("");
        lines.push(n.content);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contextnote_${displayName.replace(/[^a-z0-9]/gi, "_").slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Downloaded ✓");
  });
}

function openSpecificFolder(folderName) {
  $("main").style.display = "none";
  $("singlePageView").style.display = "block";

  const folderNotes = allNotesFlat.filter((n) => n.folder === folderName);
  folderNotes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  $("singlePageView").innerHTML = `
    <button class="back-btn" id="backToDash">← Back to Dashboard</button>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="globe" style="background:var(--hbg);">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--hbdr);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="mh">${esc(folderName)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn" id="downloadMdBtn" title="Download notes as Markdown">⬇ .md</button>
        <button class="btn" id="addNoteBtn">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle;margin-right:4px;">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>Add Note
        </button>
      </div>
    </div>
    <div class="grid wrap" id="pageNoteGrid">
      ${
        folderNotes.length
          ? folderNotes
              .map((n, i) => card(n, n.domain || folderName, i))
              .join("")
          : `<p style="color:var(--mut);font-size:13px;">No notes in this folder yet.</p>`
      }
    </div>`;

  E($("backToDash"), "click", () => {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
    loadLocalUI();
  });
  E($("addNoteBtn"), "click", () => {
    openAddNoteModal({ type: "folder", folderName });
  });
  E($("downloadMdBtn"), "click", () => {
    const lines = [
      `# Folder — ${folderName}`,
      `*Exported from ContextNote on ${new Date().toLocaleDateString()}*`,
      "",
    ];
    folderNotes.forEach((n, i) => {
      lines.push(`## ${i + 1}. ${n.title || "Untitled"}`);
      const meta = [];
      if (n.pinned) meta.push("⭐ Pinned");
      if (n.timestamp) meta.push(`⏱️ ${n.timestamp}`);
      if (n.url) meta.push(`🔗 ${n.url}`);
      if (meta.length) lines.push(`*${meta.join(" · ")}*`);
      if (n.selection) {
        lines.push("");
        lines.push(`> ${n.selection}`);
      }
      if (n.content) {
        lines.push("");
        lines.push(n.content);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contextnote_folder_${folderName.replace(/[^a-z0-9]/gi, "_").slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Downloaded ✓");
  });
}

/* ═══════════════════════════════════════
   MARKDOWN RENDERER (for AI chat)
═══════════════════════════════════════ */
function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /`([^`]+)`/g,
      '<code style="background:var(--bg);border:1px solid var(--bdr);padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace">$1</code>',
    )
    .replace(
      /^### (.+)$/gm,
      '<h4 style="margin:10px 0 4px;font-size:13px;font-weight:600;color:var(--ink)">$1</h4>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h3 style="margin:12px 0 4px;font-size:14px;font-weight:600;color:var(--ink)">$1</h3>',
    )
    .replace(
      /^# (.+)$/gm,
      '<h2 style="margin:14px 0 6px;font-size:15px;font-weight:700;color:var(--ink)">$1</h2>',
    )
    .replace(
      /^\s*[-*•] (.+)$/gm,
      '<li style="margin:3px 0;padding-left:4px">$1</li>',
    )
    .replace(
      /^\s*\d+\. (.+)$/gm,
      '<li style="margin:3px 0;padding-left:4px;list-style-type:decimal">$1</li>',
    )
    .replace(
      /((?:<li[^>]*>[\s\S]*?<\/li>\s*)+)/g,
      '<ul style="margin:6px 0;padding-left:18px">$1</ul>',
    )
    .replace(
      /^---$/gm,
      '<hr style="border:none;border-top:1px solid var(--bdr);margin:10px 0">',
    )
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    .replace(/\n/g, "<br>")
    .replace(/^/, '<p style="margin:0">')
    .replace(/$/, "</p>");
}

/* ═══════════════════════════════════════
   AI CHAT
═══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const aiBtn = $("aiBtn");
  const closeAiBtn = $("closeAiBtn");

  if (aiBtn) {
    aiBtn.addEventListener("click", () => {
      $("aiChatBox").innerHTML =
        '<div class="chat-msg chat-ai">Ask me anything about your saved notes.</div>';

      $("aiModal").dataset.context = JSON.stringify(allNotesFlat || []);

      $("aiModal").classList.add("on");
    });
  }

  if (closeAiBtn) {
    closeAiBtn.addEventListener("click", () => {
      $("aiModal").classList.remove("on");
    });
  }
});

E($("closeAiBtn"), "click", () => $("aiModal").classList.remove("on"));

let isAiProcessing = false;
async function handleAiSubmit() {
  if (isAiProcessing) return;
  const input = $("aiInput");
  const sendBtn = $("aiSendBtn");
  const chatBox = $("aiChatBox");
  const q = input.value.trim();
  if (!q || q === "Thinking..." || q === "Checking permissions...") return;

  isAiProcessing = true;
  sendBtn.disabled = true;
  input.disabled = true;
  const tempMsgId = "msg-" + Date.now();
  chatBox.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-msg chat-user" id="${tempMsgId}">${esc(q)}</div>`,
  );
  chatBox.scrollTop = chatBox.scrollHeight;
  input.value = "Checking permissions...";

  const hasAccess = await ProMode.canAccessAI();
  if (!hasAccess) {
    document.getElementById(tempMsgId)?.remove();
    input.value = q;
    input.disabled = false;
    sendBtn.disabled = false;
    isAiProcessing = false;
    return;
  }
  input.value = "Thinking...";

  try {
    const contextNotes = JSON.parse($("aiModal").dataset.context || "[]");
    const domain = detectDomain(q);
    let scopedNotes = contextNotes;
    if (domain) {
      const domainFiltered = contextNotes.filter((n) =>
        (n.tags || []).some((tag) => tag.includes(domain)),
      );
      if (domainFiltered.length > 0) scopedNotes = domainFiltered;
    }
    const filteredNotes = smartFilterNotes(scopedNotes, q);
    if (!Array.isArray(filteredNotes) || filteredNotes.length === 0) {
      chatBox.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-msg chat-ai">Generating suggestions…</div>`,
      );
      chatBox.scrollTop = chatBox.scrollHeight;
      const suggestions = await AIService.generateNotesFromQuestion(q);
      chatBox.lastElementChild.remove();
      renderNoNotesSuggestion(q, suggestions);
      input.value = "";
      input.disabled = false;
      sendBtn.disabled = false;
      isAiProcessing = false;
      chatBox.scrollTop = chatBox.scrollHeight;
      return;
    }

    const result = await AIService.chat(q, filteredNotes);
    const aiAnswer = result?.answer || "⚠️ No answer received.";
    const aiTags = result?.tags || {};

    const res = await new Promise((resolve) => {
      chrome.storage.local.get("context_notes_data", resolve);
    });
    let allNotes = res.context_notes_data || [];
    const updated = allNotes.map((note) => {
      const newTags = aiTags[note.id];
      if (newTags && newTags.length > 0) {
        const merged = [...new Set([...(note.tags || []), ...newTags])];
        return { ...note, tags: merged };
      }
      return note;
    });
    await new Promise((resolve) => {
      chrome.storage.local.set({ context_notes_data: updated }, resolve);
    });

    const tagUpdates = Object.entries(aiTags)
      .filter(([, tags]) => tags?.length > 0)
      .map(([id, tags]) => ({ id, tags }));
    if (tagUpdates.length > 0) {
      try {
        await fetch(`${API_BASE}/api/notes/tags`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tagUpdates),
        });
      } catch (e) {
        console.warn("Tag sync failed", e);
      }
    }

    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai" style="line-height:1.6">${renderMarkdown(aiAnswer)}</div>`,
    );
  } catch (e) {
    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai">Error: Could not connect to AI.</div>`,
    );
  }
  input.value = "";
  input.disabled = false;
  sendBtn.disabled = false;
  isAiProcessing = false;
  chatBox.scrollTop = chatBox.scrollHeight;
  setTimeout(() => input.focus(), 10);
}

E($("aiSendBtn"), "click", handleAiSubmit);
E($("aiInput"), "keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleAiSubmit();
  }
});

/* ═══════════════════════════════════════
   API KEY SETTINGS
═══════════════════════════════════════ */
E($("closeApiSettingsBtn"), "click", () =>
  $("apiSettingsModal").classList.remove("on"),
);
E($("apiSettingsBtn"), "click", () => {
  chrome.storage.local.get(["gemini_key"], (res) => {
    $("apiKeyInput").value = res.gemini_key || "";
    $("apiSettingsModal").classList.add("on");
    closeSettingsPanel();
  });
});
E($("saveApiKey"), "click", () => {
  const key = $("apiKeyInput").value.trim();
  chrome.storage.local.set({ gemini_key: key }, () => {
    toast("API Key saved securely.");
    $("apiSettingsModal").classList.remove("on");
  });
});

/* ═══════════════════════════════════════
   THEME ENGINE
═══════════════════════════════════════ */
function buildThemeMenu() {
  const grid = document.getElementById("themeGrid");
  if (!grid || typeof CN_THEMES === "undefined") return;
  grid.innerHTML = "";
  Object.keys(CN_THEMES).forEach((themeKey) => {
    const theme = CN_THEMES[themeKey];
    const swatch = document.createElement("div");
    swatch.className = "palette-swatch";
    swatch.dataset.theme = themeKey;
    swatch.innerHTML = `
      <div class="swatch-circle" style="background:${theme.swatch}"></div>
      <span class="swatch-label">${theme.emoji} ${theme.label}</span>`;
    swatch.addEventListener("click", () => {
      applyTheme(themeKey);
    });
    grid.appendChild(swatch);
  });
}

function applyTheme(theme) {
  if (typeof CN_THEMES === "undefined" || !CN_THEMES[theme]) theme = "nova";
  document.documentElement.setAttribute("data-theme", theme);
  if (typeof CN_THEMES !== "undefined" && CN_THEMES[theme]) {
    const themeData = CN_THEMES[theme];
    for (const [key, value] of Object.entries(themeData.vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }
  document.querySelectorAll(".palette-swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.theme === theme);
  });
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.set({ [THEME_KEY]: theme });
  }
}

buildThemeMenu();

if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get([THEME_KEY], (res) => {
    applyTheme(res[THEME_KEY] || "nova");
  });
} else {
  applyTheme("nova");
}

window.addEventListener("load", function () {
  document.addEventListener(
    "click",
    function (e) {
      const backBtn = e.target.closest("#backToDash");

      if (!backBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const singleView = document.getElementById("singlePageView");

      const mainEl = document.getElementById("main");

      if (!singleView || !mainEl) return;

      // Hide detail view
      singleView.style.display = "none";
      singleView.innerHTML = "";

      // Show dashboard
      mainEl.style.display = "block";

      // Reload UI
      if (typeof loadLocalUI === "function") {
        loadLocalUI();
      }

      // Reset scroll
      mainEl.scrollTop = 0;
    },
    true,
  );
});

window.addEventListener("focus", () => {
  const now = Date.now();
  if (now - lastAuthCheck > 15000) {
    lastAuthCheck = now;
    checkAuthAndSync();
  }
});
