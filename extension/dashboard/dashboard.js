const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const PRO_CACHE_KEY = "cn_is_pro_cached";
const THEME_KEY = "cn_theme";
const NAMES_KEY = "cn_source_names";
const API_BASE = "https://www.kontexa.online";

// Client-side field length limits — mirrors backend constants
const MAX_TITLE_LEN = 255;
const MAX_CONTENT_LEN = 100_000;
const MAX_FOLDER_LEN = 100;
const MAX_TAG_LEN = 50;

let mId = null;
let userFolders = [];
let sourceNames = {};
let currentUiMode = "talk";
let isProUserUI = false;

let notesById = {};
let notesByUrl = {};
let sectionCache = [];
let folderCounts = {};
let pendingAiSaveIndex = null;

// ─── Sync queue — debounced, batched ──────────────────────────────────────────
const SYNC_DEBOUNCE = 4000;
const SYNC_MAX_INTERVAL = 30000;
const MAX_BATCH_SIZE = 25;

let _syncQueue = [];
let _syncTimer = null;
let _lastFlush = 0;

function showSidebarSkeleton() {
  const skeletonItem = `
    <div class="na-skeleton">
      <div class="sk-dot"></div>
      <div class="sk-label"></div>
      <div class="sk-badge"></div>
    </div>`;
  $("snav").innerHTML = skeletonItem.repeat(4);
  $("fnav").innerHTML = skeletonItem.repeat(2);
}

function queueSync(notes) {
  if (!isLoggedIn || !isProUserUI) return;
  if (!Array.isArray(notes)) notes = [notes];

  const queueMap = new Map(_syncQueue.map((n) => [n.id, n]));
  notes.forEach((n) => queueMap.set(n.id, n));
  _syncQueue = Array.from(queueMap.values());

  const now = Date.now();
  const overdue = now - _lastFlush >= SYNC_MAX_INTERVAL;

  clearTimeout(_syncTimer);

  if (overdue) {
    _flushSync();
  } else {
    _syncTimer = setTimeout(_flushSync, SYNC_DEBOUNCE);
  }
}

async function _flushSync() {
  if (!_syncQueue.length) return;
  clearTimeout(_syncTimer);
  _lastFlush = Date.now();

  const toSend = _syncQueue.splice(0, MAX_BATCH_SIZE);

  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSend),
    });
    if (res.ok) {
      chrome.storage.local.get(STORAGE_KEY, (localRes) => {
        let stored = localRes[STORAGE_KEY] || [];
        const syncedIds = new Set(toSend.map((n) => n.id));
        stored = stored.map((n) =>
          syncedIds.has(n.id) ? { ...n, _synced: true } : n,
        );
        chrome.storage.local.set({ [STORAGE_KEY]: stored });
      });
      if (_syncQueue.length) _syncTimer = setTimeout(_flushSync, SYNC_DEBOUNCE);
    }
  } catch (err) {
    console.warn("Sync flush failed:", err);
    _syncQueue = [...toSend, ..._syncQueue];
  }
}

function generateNoteId(prefix = "note") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

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

// ═══════════════════════════════════════
//  IMAGE GUARD
//  FIX: Notes sometimes arrive from the server with image_data = "" or a
//  partial/broken base64 string (happens when the screenshot capture fails
//  mid-flight in the extension). A simple truthy check renders a broken <img>.
//  This helper rejects anything that isn't a genuine data-URL or https URL.
// ═══════════════════════════════════════
function hasValidImage(img) {
  if (!img || typeof img !== "string") return false;
  const t = img.trim();
  if (!t) return false;
  return t.startsWith("data:image/") || t.startsWith("https://");
}

/* ═══════════════════════════════════════
   SIDEBAR TOGGLE
═══════════════════════════════════════ */
const mob = () => window.innerWidth <= 768;
const openS = () => {};
const closeS = () => {};

$("side").classList.remove("closed");
E($("ovl"), "click", () => {
  closeS();
  closeSettingsPanel();
  $("aiModal")?.classList.remove("on");
  $("guideModal")?.classList.remove("on");
});

/* ═══════════════════════════════════════
   RIGHT SETTINGS PANEL
═══════════════════════════════════════ */
let _ovlUsers = new Set();
function openSettingsPanel() {
  $("settingsPanel").classList.add("open");
  _ovlUsers.add("settings");
  $("ovl").classList.add("on");
}
function closeSettingsPanel() {
  $("settingsPanel").classList.remove("open");
  _ovlUsers.delete("settings");
  if (_ovlUsers.size === 0) $("ovl").classList.remove("on");
}

E($("settingsPanelBtn"), "click", (e) => {
  e.stopPropagation();
  const isOpen = $("settingsPanel").classList.contains("open");
  if (isOpen) closeSettingsPanel();
  else openSettingsPanel();
});
E($("settingsPanelClose"), "click", closeSettingsPanel);
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

E($("closeLoginModalBtn"), "click", () =>
  $("loginModal").classList.remove("on"),
);
E($("loginModal"), "click", (e) => {
  if (e.target === $("loginModal")) $("loginModal").classList.remove("on");
});
E($("confirmLoginBtn"), "click", () => {
  $("loginModal").classList.remove("on");
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
  closeSettingsPanel();
  const modal = $("aiModal");
  if (!modal) return;
  modal.dataset.context = JSON.stringify(allNotesFlat || []);
  modal.classList.add("on");
});
E($("closeAiBtn"), "click", () => $("aiModal")?.classList.remove("on"));
E($("aiModal"), "click", (e) => {
  if (e.target.id === "aiModal") $("aiModal").classList.remove("on");
});

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
    selEl.style.whiteSpace = "pre-wrap";
  } else {
    selEl.style.display = "none";
  }

  const contentEl = $("vContent");
  if (n.content) {
    contentEl.textContent = n.content;
    contentEl.style.display = "block";
    contentEl.style.whiteSpace = "pre-wrap";
  } else {
    contentEl.style.display = "none";
  }

  // FIX: use hasValidImage() instead of bare truthy check
  const imgWrap = $("vImageWrap");
  const imgEl = $("vImage");
  if (hasValidImage(n.image_data)) {
    imgEl.src = n.image_data;
    imgWrap.style.display = "block";
  } else {
    imgWrap.style.display = "none";
    imgEl.src = "";
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
  if (clean.length > MAX_FOLDER_LEN) {
    toast(`Name too long (max ${MAX_FOLDER_LEN} characters).`);
    return;
  }
  sourceNames[url] = clean;
  chrome.storage.local.set({ [NAMES_KEY]: sourceNames }, async () => {
    toast(`Renamed to "${clean}"`);
    loadLocalUI();
    if (isLoggedIn) {
      try {
        await fetch(`${API_BASE}/api/websites/rename`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, custom_name: clean }),
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
   CARD GENERATOR
═══════════════════════════════════════ */
const card = (n, dom, index = 0) => {
  const title = n.title || "Untitled";
  const body = n.content || "";
  const sel = n.selection || n.text_selection || "";
  const searchStr = (title + " " + body).toLowerCase();
  const pinColor = n.pinned ? "#f59e0b" : "currentColor";
  const pinFill = n.pinned ? "#f59e0b" : "none";
  // FIX: validate before rendering — prevents broken <img> from empty/partial
  // image_data that the extension sometimes writes when capture fails mid-flight
  const validImg = hasValidImage(n.image_data);

  let contentPieces = "";
  const isYouTube =
    n.url && (n.url.includes("youtube.com") || n.url.includes("youtu.be"));
  if (n.timestamp && isYouTube)
    contentPieces += `<div class="c-timestamp">⏱️ ${esc(n.timestamp)}</div>`;
  if (sel)
    contentPieces += `<div class="chi" style="white-space:pre-wrap;word-break:break-word;">"${esc(sel)}"</div>`;
  if (body)
    contentPieces += `<div class="cb" style="white-space:pre-wrap;word-break:break-word;">${esc(body)}</div>`;
  // FIX: use validImg in the "no content" fallback check too
  if (!sel && !body && !validImg && !n.timestamp)
    contentPieces += `<div class="card-empty-hint">No description added.</div>`;

  // FIX: only render <img> when the data URL is actually valid
  const imageHtml = validImg
    ? `<img class="card-img" loading="lazy" src="${n.image_data}" alt="Screenshot"/>`
    : "";

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
          <div class="folder-actions" style="display:flex;flex-direction:row;align-items:center;gap:6px;">
            <button class="act btn-rename-folder" data-folder="${esc(displayName)}" title="Rename Folder">
              <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
            </button>
            <button class="act del btn-delete-folder" data-folder="${esc(displayName)}" title="Delete Folder">
              <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
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
          <button class="act btn-rename" data-url="${esc(group.url)}" data-name="${esc(displayName)}" title="Rename Source">
            <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;pointer-events:none;">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
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
      const selectEl = document.querySelector(
        `.ai-folder-select[data-index="${idx}"]`,
      );
      let selectedFolder = selectEl ? selectEl.value : null;
      if (selectedFolder === "__CREATE_NEW__") {
        pendingAiSaveIndex = idx;
        $("newFolderNameInput").value = "";
        $("createFolderModal").classList.add("on");
        setTimeout(() => $("newFolderNameInput").focus(), 50);
        return;
      }
      saveAINote(note, selectedFolder || null);
      saveBtn.textContent = "Saved ✓";
      saveBtn.disabled = true;
      if (selectEl) selectEl.disabled = true;
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

  if (e.target.closest("#createFolderBtn")) {
    pendingAiSaveIndex = null;
    $("newFolderNameInput").value = "";
    $("createFolderModal").classList.add("on");
    setTimeout(() => $("newFolderNameInput").focus(), 50);
    return;
  }

  if (pinBtn) {
    const id = pinBtn.dataset.id;
    const idx = allNotesFlat.findIndex((n) => String(n.id) === String(id));
    if (idx > -1) {
      allNotesFlat[idx].pinned = !allNotesFlat[idx].pinned;
      const newPinned = allNotesFlat[idx].pinned;
      const pinUrl = allNotesFlat[idx].url;
      chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
        if ($("singlePageView").style.display === "block")
          openSpecificPage(pinUrl);
        else loadLocalUI();
        if (isLoggedIn && isProUserUI) {
          try {
            await fetch(`${API_BASE}/api/notes/${id}`, {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pinned: newPinned }),
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

  if (deleteFolderBtn) {
    const folder = deleteFolderBtn.dataset.folder;
    if (!confirm(`Delete folder "${folder}"?\nNotes will remain.`)) return;
    deleteFolder(folder);
    return;
  }

  if (renameFolderBtn) {
    const oldName = renameFolderBtn.dataset.folder;
    const newName = prompt("Rename folder:", oldName);
    if (!newName || newName.trim() === oldName) return;
    if (newName.trim().length > MAX_FOLDER_LEN) {
      toast(`Folder name too long (max ${MAX_FOLDER_LEN} characters).`);
      return;
    }
    renameFolder(oldName, newName.trim());
  }
});

function closeCreateFolderModal() {
  $("createFolderModal").classList.remove("on");
  if (pendingAiSaveIndex !== null) {
    const selectEl = document.querySelector(
      `.ai-folder-select[data-index="${pendingAiSaveIndex}"]`,
    );
    if (selectEl) selectEl.value = "";
    pendingAiSaveIndex = null;
  }
}

E($("closeRenewalBtn"), "click", () =>
  $("renewalModal").classList.remove("on"),
);
E($("renewBtn"), "click", () => {
  window.open(`${API_BASE}/pricing`, "_blank");
  $("renewalModal").classList.remove("on");
});

E($("cancelCreateFolder"), "click", closeCreateFolderModal);
E($("createFolderModal"), "click", (e) => {
  if (e.target === $("createFolderModal")) closeCreateFolderModal();
});
E($("newFolderNameInput"), "keydown", (e) => {
  if (e.key === "Enter") $("confirmCreateFolder").click();
});

E($("confirmCreateFolder"), "click", () => {
  const name = $("newFolderNameInput").value.trim();
  if (!name) return;
  if (name.length > MAX_FOLDER_LEN) {
    toast(`Folder name too long (max ${MAX_FOLDER_LEN} characters).`);
    return;
  }

  if (!userFolders.includes(name)) {
    userFolders.push(name);
    chrome.storage.local.set({ [FOLDERS_KEY]: userFolders }, () => {
      renderFoldersSidebar();
      loadLocalUI();
      toast(`Folder "${name}" created!`);
    });
  } else {
    toast(`Using existing folder: ${name}`);
  }

  if (pendingAiSaveIndex !== null) {
    const note = window.aiGeneratedNotes[pendingAiSaveIndex];
    const selectEl = document.querySelector(
      `.ai-folder-select[data-index="${pendingAiSaveIndex}"]`,
    );
    const saveBtnEl = document.querySelector(
      `.btn-save-domain[data-index="${pendingAiSaveIndex}"]`,
    );

    document.querySelectorAll(".ai-folder-select").forEach((sel) => {
      if (![...sel.options].some((opt) => opt.value === name)) {
        const createOpt = sel.querySelector('option[value="__CREATE_NEW__"]');
        const newOpt = new Option(name, name);
        if (createOpt) sel.insertBefore(newOpt, createOpt);
        else sel.add(newOpt);
      }
    });

    if (selectEl) selectEl.value = name;
    if (note) saveAINote(note, name);
    if (saveBtnEl) {
      saveBtnEl.textContent = "Saved ✓";
      saveBtnEl.disabled = true;
    }
    if (selectEl) selectEl.disabled = true;
    pendingAiSaveIndex = null;
  }

  $("createFolderModal").classList.remove("on");
});

function saveAINote(note, folderName = null) {
  const newNote = {
    id: generateNoteId("ai"),
    title: note.title,
    content: note.content,
    tags: note.tags || [],
    url: note.sourceUrl || "general://notes",
    domain: note.sourceDomain || "general",
    folder: folderName,
    pinned: false,
    timestamp: null,
    image_data: null,
    createdAt: new Date().toISOString(),
    _synced: false,
  };

  chrome.storage.local.get(["context_notes_data"], (res) => {
    let notes = res.context_notes_data || [];
    notes.push(newNote);
    allNotesFlat = notes;
    chrome.storage.local.set({ context_notes_data: notes }, () => {
      toast("Note saved ✓");
      loadLocalUI();
      // FIX: sync the new AI note to server immediately after auth is confirmed.
      // Previously this was missing entirely from saveAINote, so AI-generated
      // notes were never pushed to the cloud and wouldn't appear in other browsers.
      if (isLoggedIn && isProUserUI) {
        queueSync([newNote]);
      }
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
  const savedMoveId = mId;
  const rawSelected = $("folderSelect").value;
  const selectedFolder =
    !rawSelected || rawSelected === "None" || rawSelected === "none"
      ? null
      : rawSelected;
  const idx = allNotesFlat.findIndex((n) => n.id === savedMoveId);
  if (idx > -1) {
    allNotesFlat[idx].folder = selectedFolder || null;
    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      $("moveModal").classList.remove("on");
      mId = null;
      toast("Note moved ✓");
      loadLocalUI();
      if (isLoggedIn && isProUserUI) {
        try {
          await fetch(`${API_BASE}/api/notes/${savedMoveId}`, {
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

  if (titleVal.length > MAX_TITLE_LEN) {
    toast(`Title too long (max ${MAX_TITLE_LEN} characters).`);
    return;
  }
  if (contentVal.length > MAX_CONTENT_LEN) {
    toast(
      `Content too long (max ${MAX_CONTENT_LEN.toLocaleString()} characters).`,
    );
    return;
  }

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
      if (isLoggedIn && isProUserUI) {
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

/* ═══════════════════════════════════════
   FOLDER FUNCTIONS
═══════════════════════════════════════ */
async function deleteFolder(folderName) {
  userFolders = userFolders.filter((f) => f !== folderName);
  allNotesFlat = allNotesFlat.map((n) =>
    n.folder === folderName ? { ...n, folder: null } : n,
  );
  chrome.storage.local.set({
    [FOLDERS_KEY]: userFolders,
    [STORAGE_KEY]: allNotesFlat,
  });
  loadLocalUI();
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
  userFolders = userFolders.map((f) => (f === oldName ? newName : f));
  allNotesFlat = allNotesFlat.map((n) =>
    n.folder === oldName ? { ...n, folder: newName } : n,
  );
  chrome.storage.local.set({
    [FOLDERS_KEY]: userFolders,
    [STORAGE_KEY]: allNotesFlat,
  });
  renderFoldersSidebar();
  loadLocalUI();
  if (isLoggedIn) {
    try {
      await fetch(`${API_BASE}/api/folders/rename`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_name: oldName, new_name: newName }),
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
   FIX: Notes with a folder assignment AND a real URL (e.g. saved from a
   webpage then moved to a folder) were only appearing in the URL group.
   Now they are correctly added to BOTH groupedUrls AND groupedFolders so
   the folder view is never empty when notes exist in it.
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
    allNotesFlat = (stored || []).map((n) => ({
      ...n,
      tags: n.tags || [],
      folder:
        !n.folder ||
        n.folder === "None" ||
        n.folder === "none" ||
        n.folder.trim() === ""
          ? null
          : n.folder,
    }));
    notesById = Object.fromEntries(allNotesFlat.map((n) => [n.id, n]));
    sourceNames = res[NAMES_KEY] || {};

    notesByUrl = {};
    const groupedUrls = {};
    const groupedFolders = {};
    folderCounts = {};

    for (const n of allNotesFlat) {
      // URL groups: only real web pages, not special protocol notes
      if (n.domain === "error" || n.folder === "error" || n.url === "error" || (n.url && n.url.startsWith("chrome-error"))) {
          continue; 
      }
      if (n.url && n.url !== "general://notes" && n.url !== "folder://notes") {
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

      const safeFolder =
        !n.folder || n.folder === "None" || n.folder === "none"
          ? null
          : n.folder;
      if (safeFolder) {
        n.folder = safeFolder; // normalize in place
        folderCounts[safeFolder] = (folderCounts[safeFolder] || 0) + 1;
        if (!groupedFolders[safeFolder]) {
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
    userFolders = userFolders.filter(
      (f) =>
        f !== "General Notes" &&
        f !== "None" &&
        f !== "none" &&
        f.trim() !== "",
    );

    if (JSON.stringify(persistedFolders) !== JSON.stringify(userFolders)) {
      chrome.storage.local.set({ [FOLDERS_KEY]: userFolders });
    }

    // Ensure every known folder has a group entry even if currently empty
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

    render(
      Object.values(groupedUrls),
      Object.values(groupedFolders).filter((g) => g.notes.length > 0),
    );
    renderFoldersSidebar();
  });
}

function renderFoldersSidebar() {
  // FIX: show folders optimistically from local storage even before the server
  // confirms Pro status. The paywall only blocks the create-folder action, not
  // the display of folders that already exist.  This prevents a race where the
  // sidebar showed "Upgrade to Pro" for several seconds in a fresh browser
  // because isProUserUI was still false while checkAuthAndSync() was in-flight.
  const knownFolders = userFolders.length > 0;
  if (!isProUserUI && !knownFolders) {
    $("fnav").innerHTML =
      '<p style="padding:12px;font-size:12px;color:var(--mut)">Upgrade to Pro to create custom folders.</p>';
    return;
  }
  $("fnav").innerHTML = userFolders.length
    ? userFolders
        .map((f, i) => {
          const count = folderCounts[f] || 0;
          const fid = getSafeId("folder_" + f);
          return `<a class="na" href="#${fid}" data-t="${fid}" style="animation-delay:${i * 40}ms;">
          <div class="dot" style="border-radius:2px;background:var(--mut2);"></div>
          <span class="nd">${esc(f)}</span>
          <span class="bdg">${count}</span>
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
      `<div class="chat-msg chat-ai">No notes found and couldn't generate suggestions. Try rephrasing your question.</div>`,
    );
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  window.aiGeneratedNotes = notes;
  const cardsHtml = notes
    .map((n, i) => {
      let folderOptions = `<option value="">[ No Folder ]</option>`;
      userFolders.forEach((f) => {
        const isSelected = n.suggested_folder === f ? "selected" : "";
        folderOptions += `<option value="${esc(f)}" ${isSelected}>${esc(f)}</option>`;
      });
      folderOptions += `<option value="__CREATE_NEW__">+ Create New Folder</option>`;

      return `
      <div style="background:var(--bg);border:1px solid var(--bdr);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
        <div style="font-weight:600;font-size:13px;color:var(--ink);line-height:1.4;">${esc(n.title)}</div>
        <div style="font-size:12px;color:var(--mut);line-height:1.6;">${esc(n.content)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:2px;">
          ${(n.tags || [])
            .map(
              (t) =>
                `<span style="font-size:11px;padding:2px 8px;background:var(--acc-bg);color:var(--acc);border-radius:20px;border:1px solid var(--bdr);">#${esc(t)}</span>`,
            )
            .join("")}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;align-items:center;">
          <div class="ai-folder-select-wrap">
            <select class="ai-folder-select" data-index="${i}">${folderOptions}</select>
            <svg class="ai-folder-select-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <button class="btn-save-domain" data-index="${i}" style="font-size:12px;font-weight:500;padding:7px 14px;border-radius:8px;border:1px solid var(--acc);background:var(--acc);color:#fff;cursor:pointer;transition:opacity 0.15s;white-space:nowrap;">+ Save</button>
        </div>
      </div>`;
    })
    .join("");

  chatBox.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-msg chat-ai" style="padding:0;background:none;border:none;box-shadow:none;">
      <div style="font-size:12px;color:var(--mut);margin-bottom:10px;padding:0 2px;"> You have no notes on this topic. Here are some suggested notes you can save:</div>
      <div style="display:flex;flex-direction:column;gap:10px;">${cardsHtml}</div>
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
  isProUserUI = false;
  $("paywallModal").classList.remove("on");
  $("uStatus").textContent = "Local Mode Only";
  const logoutBtnEl = $("logoutBtn");
  if (logoutBtnEl) {
    logoutBtnEl.outerHTML = `<div class="sitem" id="loginBtn">Sync via Google</div>`;
    E($("loginBtn"), "click", () => {
      $("synmenu").classList.remove("on");
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

      // First 100 users celebration
      if (user.is_pro) {
        chrome.storage.local.get(["cn_pro_celebrated"], async (res) => {
          if (!res.cn_pro_celebrated) {
            try {
              const countRes = await fetch(`${API_BASE}/api/user-count`, {
                credentials: "include",
              });
              const { count } = await countRes.json();
              if (count <= 100) {
                chrome.storage.local.set({ cn_pro_celebrated: true });
                setTimeout(() => {
                  if (!window.CN_Celebrate) return;
                  window.CN_Celebrate.confetti();
                  const pill = document.createElement("div");
                  pill.className = "cn-celebrate-pill";
                  pill.innerHTML = `
              <div class="cn-pill-icon"></div>
              <div class="cn-pill-text">
                <span class="cn-pill-main">You're a founding member!</span>
                <span class="cn-pill-sub">First 100 users get Pro free forever 🚀</span>
              </div>
            `;
                  document.body.appendChild(pill);
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                      pill.classList.add("cn-pill-in"),
                    ),
                  );
                  setTimeout(() => {
                    pill.classList.remove("cn-pill-in");
                    pill.classList.add("cn-pill-out");
                    setTimeout(() => pill.remove(), 600);
                  }, 5500);
                }, 1500);
              }
            } catch (e) {
              console.warn("Could not fetch user count", e);
            }
          }
        });
      }

      const wasPro = await new Promise((r) =>
        chrome.storage.local.get(PRO_CACHE_KEY, (res) => r(res[PRO_CACHE_KEY])),
      );
      chrome.storage.local.set({ [PRO_CACHE_KEY]: user.is_pro });

      if (user.is_pro && wasPro == false) {
        launchProCelebration();
        return;
      }
      if (isProUserUI) {
        $("createFolderBtn").style.display = "flex";
        $("proBadge").style.display = "inline";
        $("feedbackSection").style.display = "block";
        // FIX: re-render the sidebar now that we know the user is Pro —
        // the initial loadLocalUI() call in window.onload ran before
        // isProUserUI was set, so the sidebar may have shown the upgrade prompt.
        renderFoldersSidebar();
      }

      const planName = user.is_pro ? "Pro Plan" : "Free Plan";
      const statusColor = user.is_pro ? "#4f46e5" : "#64748b";
      $("uStatus").innerHTML =
        `<span style="color:${statusColor};font-weight:bold;">${planName}</span> • ${user.email}`;
      if ($("loginBtn"))
        $("loginBtn").outerHTML =
          `<div class="sitem danger" id="logoutBtn">🚪 Logout</div>`;

      if (!user.is_pro) {
        chrome.storage.local.get(["cn_guide_shown"], (r) => {
          if (!r.cn_guide_shown) {
            chrome.storage.local.set({ cn_guide_shown: true });
            $("proceedLoginBtn").style.display = "none";
            $("guideModal").classList.add("on");
          }
        });
        $("paywallModal")?.classList.add("on");
        loadLocalUI();
        return;
      }
      $("paywallModal")?.classList.remove("on");

      if (
        user.is_pro &&
        user.plan_type === "monthly" &&
        user.days_left !== null &&
        user.days_left <= 3
      ) {
        if (!sessionStorage.getItem("renewal_warned")) {
          $("daysLeftText").textContent = user.days_left;
          $("renewalModal").classList.add("on");
          sessionStorage.setItem("renewal_warned", "true");
        }
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
              const rawFolder = n.folder || localForFolderLookup[n.id] || null;
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
                folder:
                  !rawFolder ||
                  rawFolder === "None" ||
                  rawFolder === "none" ||
                  rawFolder.trim() === ""
                    ? null
                    : rawFolder,
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
  $("loginModal").classList.add("on");
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
  if (!mob()) openS();
  showSidebarSkeleton();
  cleanupNoneFolders(); 
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
  if (titleVal.length > MAX_TITLE_LEN) {
    toast(`Title too long (max ${MAX_TITLE_LEN} characters).`);
    return;
  }
  if (contentVal.length > MAX_CONTENT_LEN) {
    toast(
      `Content too long (max ${MAX_CONTENT_LEN.toLocaleString()} characters).`,
    );
    return;
  }

  const context = JSON.parse($("addNoteModal").dataset.context || "{}");
  const isGeneralNote = context.type === "folder";

  const newNote = {
    id: generateNoteId("dash"),
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
      if (isLoggedIn && isProUserUI) {
        queueSync([newNote]);
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
      `*Exported from Kontexa on ${new Date().toLocaleDateString()}*`,
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
      `*Exported from Kontexa on ${new Date().toLocaleDateString()}*`,
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
let aiMode = "talk";
let isAiProcessing = false;

const aiBtn = $("aiBtn");
const closeAiBtn = $("closeAiBtn");
const btnTalk = $("modeTalk");
const btnResearch = $("modeResearch");

if (aiBtn) {
  aiBtn.onclick = () => {
    $("aiChatBox").innerHTML =
      '<div class="chat-msg chat-ai">Ask me anything about your saved notes.</div>';
    $("aiModal").dataset.context = JSON.stringify(allNotesFlat || []);
    $("aiModal").classList.add("on");

    aiMode = "talk";
    if (btnTalk && btnResearch) {
      btnTalk.style.cssText =
        "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:600;border:1px solid var(--acc);background:var(--acc-bg);color:var(--acc);";
      btnResearch.style.cssText =
        "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:500;border:1px solid transparent;background:transparent;color:var(--mut);";
    }
  };
}

if (closeAiBtn) {
  closeAiBtn.onclick = () => $("aiModal").classList.remove("on");
}

if (btnTalk && btnResearch) {
  btnTalk.onclick = () => {
    aiMode = "talk";
    btnTalk.style.cssText =
      "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:600;border:1px solid var(--acc);background:var(--acc-bg);color:var(--acc);";
    btnResearch.style.cssText =
      "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:500;border:1px solid transparent;background:transparent;color:var(--mut);";
    $("aiChatBox").insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai" style="font-size:12px;opacity:0.8;padding:8px;"><em>Switched to <strong>Talk Mode</strong>. Searching saved notes.</em></div>`,
    );
    $("aiChatBox").scrollTop = $("aiChatBox").scrollHeight;
  };

  btnResearch.onclick = () => {
    aiMode = "research";
    btnResearch.style.cssText =
      "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:600;border:1px solid var(--acc);background:var(--acc-bg);color:var(--acc);";
    btnTalk.style.cssText =
      "flex:1;padding:8px;border-radius:6px;cursor:pointer;font-weight:500;border:1px solid transparent;background:transparent;color:var(--mut);";
    $("aiChatBox").insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai" style="font-size:12px;opacity:0.8;padding:8px;"><em>Switched to <strong>Research Mode</strong>. Asking AI directly.</em></div>`,
    );
    $("aiChatBox").scrollTop = $("aiChatBox").scrollHeight;
  };
}

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
    if (aiMode === "research") {
      chatBox.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-msg chat-ai" id="ai-loading">Generating research notes…</div>`,
      );
      chatBox.scrollTop = chatBox.scrollHeight;

      const suggestions = await AIService.generateNotesFromQuestion(q);
      document.getElementById("ai-loading")?.remove();
      renderNoNotesSuggestion(q, suggestions);
    } else {
      const contextNotes = allNotesFlat || [];
      const filteredNotes = smartFilterNotes(contextNotes, q);

      if (!Array.isArray(filteredNotes) || filteredNotes.length === 0) {
        chatBox.insertAdjacentHTML(
          "beforeend",
          `<div class="chat-msg chat-ai">No saved notes found. Try Research Mode.</div>`,
        );
      } else {
        const result = await AIService.chat(q, filteredNotes);
        const aiAnswer = result?.answer || "No answer received.";
        chatBox.insertAdjacentHTML(
          "beforeend",
          `<div class="chat-msg chat-ai" style="line-height:1.6">${renderMarkdown(aiAnswer)}</div>`,
        );
      }
    }
  } catch (e) {
    document.getElementById("ai-loading")?.remove();
    let message = "⚠️ Error: Could not connect to AI.";

    if (e.message === "API_KEY_MISSING")
      message = `<div><strong>No Gemini API key found.</strong></div> Check your API Key settings.`;
    else if (e.message === "RATE_LIMIT_EXCEEDED")
      message = `<strong>Rate limit hit.</strong> Wait 60 seconds and try again.`;
    else if (e.message === "GEMINI_UNAVAILABLE")
      message = `<strong>Gemini is overloaded.</strong> The servers are busy. Wait a few seconds and try again.`;
    else if (e.message === "API_KEY_INVALID")
      message = `<strong>Invalid API Key.</strong> Check your key in Settings.`;

    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai">${message}</div>`,
    );
  } finally {
    input.value = "";
    input.disabled = false;
    sendBtn.disabled = false;
    isAiProcessing = false;
    chatBox.scrollTop = chatBox.scrollHeight;
    setTimeout(() => input.focus(), 10);
  }
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
    swatch.addEventListener("click", () => applyTheme(themeKey));
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
      singleView.style.display = "none";
      singleView.innerHTML = "";
      mainEl.style.display = "block";
      if (typeof loadLocalUI === "function") loadLocalUI();
      mainEl.scrollTop = 0;
    },
    true,
  );
});

/* ═══════════════════════════════════════
   SERVER HEALTH CHECK
═══════════════════════════════════════ */
(async function checkServerHealth() {
  if (!isLoggedIn || !isProUserUI) return;
  try {
    const res = await fetch(`${API_BASE}/weakUp`, {
      method: "GET",
      credentials: "include",
    });
    if (res.status >= 500) {
      document.getElementById("maintenanceModal").classList.add("on");
    }
  } catch (e) {
    console.warn("Health check failed (likely cold start):", e.message);
  }
})();

document
  .getElementById("maintenanceOkBtn")
  .addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {}
    window.location.reload();
  });

/* ═══════════════════════════════════════
   FEEDBACK
═══════════════════════════════════════ */
let selectedFeedbackType = "feature";

document.querySelectorAll(".fb-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document
      .querySelectorAll(".fb-chip")
      .forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    selectedFeedbackType = chip.dataset.val;
  });
});

E($("feedbackBtn"), "click", () => {
  $("fbSubject").value = "";
  $("fbMessage").value = "";
  selectedFeedbackType = "feature";
  document
    .querySelectorAll(".fb-chip")
    .forEach((c, i) => c.classList.toggle("active", i === 0));
  $("feedbackModal").classList.add("on");
});
E($("cancelFeedback"), "click", () =>
  $("feedbackModal").classList.remove("on"),
);
E($("feedbackModal"), "click", (e) => {
  if (e.target === $("feedbackModal"))
    $("feedbackModal").classList.remove("on");
});

E($("submitFeedback"), "click", async () => {
  const message = $("fbMessage").value.trim();
  if (!message) {
    $("fbMessage").style.borderColor = "#ef4444";
    setTimeout(() => ($("fbMessage").style.borderColor = ""), 1200);
    return;
  }
  const btn = $("submitFeedback");
  btn.textContent = "Sending…";
  btn.disabled = true;
  try {
    await fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: selectedFeedbackType,
        subject: $("fbSubject").value.trim(),
        message,
      }),
    });
    $("feedbackModal").classList.remove("on");
    toast("Feedback sent — thank you! 🙏");
  } catch (e) {
    toast("Failed to send. Please try again.");
  }
  btn.textContent = "Send Feedback";
  btn.disabled = false;
});

/* ═══════════════════════════════════════
   PRO CELEBRATION
═══════════════════════════════════════ */
function launchProCelebration() {
  $("paywallModal")?.classList.remove("on");
  const modal = $("proCelebrationModal");
  const canvas = $("proCelebCanvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  modal.classList.add("on");

  const COLORS = [
    "#534AB7",
    "#7F77DD",
    "#CECBF6",
    "#1D9E75",
    "#5DCAA5",
    "#9FE1CB",
    "#EF9F27",
    "#FAC775",
    "#D4537E",
  ];
  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 300,
    w: 6 + Math.random() * 9,
    h: 4 + Math.random() * 6,
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    rs: (Math.random() - 0.5) * 0.18,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    alpha: 1,
    shape: Math.random() > 0.4 ? "rect" : "circle",
  }));

  let raf,
    frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rs;
      p.vy += 0.07;
      p.vx *= 0.994;
      if (p.y > canvas.height * 0.75) p.alpha -= 0.02;
      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.w * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
    });
    frame++;
    if (alive || frame < 50) raf = requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
}

E($("closeCelebrationBtn"), "click", () => {
  $("proCelebrationModal").classList.remove("on");
  window.location.reload();
});

/* ═══════════════════════════════════════
   SYNC NOW BUTTON
═══════════════════════════════════════ */
E($("syncNowBtn"), "click", async () => {
  if (!isLoggedIn || !isProUserUI) {
    toast("Sign in with a Pro account to sync your notes.");
    return;
  }
  const btn = $("syncNowBtn");
  const desc = $("syncStatusDesc");
  const icon = btn.querySelector(".sp-item-icon svg");

  desc.textContent = "Syncing…";
  icon.style.animation = "spin 0.8s linear infinite";

  try {
    const unsynced = allNotesFlat.filter((n) => !n._synced);
    if (unsynced.length === 0) {
      desc.textContent = "Everything is up to date";
      toast("Already in sync ✓");
    } else {
      _syncQueue = [...unsynced, ..._syncQueue];
      await _flushSync();
      desc.textContent = `Synced ${unsynced.length} note${unsynced.length !== 1 ? "s" : ""} ✓`;
      toast(
        `Synced ${unsynced.length} note${unsynced.length !== 1 ? "s" : ""} ✓`,
      );
    }
  } catch (e) {
    desc.textContent = "Sync failed — try again";
    toast("Sync failed.");
  }

  icon.style.animation = "";
  setTimeout(() => {
    desc.textContent = "Push local changes to cloud";
  }, 3000);
});

E($("pwaLinkBtn"), "click", () => {
  window.open(`${API_BASE}`, "_blank");
});

E($("manageSubBtn"), "click", () => {
  if (!isLoggedIn) {
    $("proceedLoginBtn").style.display = "block";
    $("guideModal").classList.add("on");
    closeSettingsPanel();
    return;
  }
  window.open(`${API_BASE}/pricing`, "_blank");
  closeSettingsPanel();
});

/* ═══════════════════════════════════════
   GUIDE MODAL — lazy video slider
═══════════════════════════════════════ */
(function () {
  // 1. REPLACE THESE WITH YOUR SUPABASE PUBLIC URLS
  const GUIDE_VIDEOS = [
    {
      src: "https://jjxbgapyvewdnkrwtper.supabase.co/storage/v1/object/sign/Video_files/Highlight-save.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8zZWEwZWYwNy00MjQ5LTQ4OTQtYTdhYi0xM2I5M2UwNzM2NWUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJWaWRlb19maWxlcy9IaWdobGlnaHQtc2F2ZS5tcDQiLCJpYXQiOjE3NzY3NjA2NDUsImV4cCI6ODgxNzY2NzQyNDV9.TAFO2YDAZBdbwq0aNUB1jWs_xpe6eI5fwG5W94f_atY",
      poster: "",
    },
    {
      src: "https://jjxbgapyvewdnkrwtper.supabase.co/storage/v1/object/sign/Video_files/dashboard-open.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8zZWEwZWYwNy00MjQ5LTQ4OTQtYTdhYi0xM2I5M2UwNzM2NWUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJWaWRlb19maWxlcy9kYXNoYm9hcmQtb3Blbi5tcDQiLCJpYXQiOjE3NzY3NjA3NjEsImV4cCI6ODgxNzY2NzQzNjF9.GEp2fvpN0sV3Zbv_COWnFfVnfW5n7_myNAMDTxAvFCQ",
      poster: "",
    },
    {
      src: "https://jjxbgapyvewdnkrwtper.supabase.co/storage/v1/object/sign/Video_files/Video-Stamp.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8zZWEwZWYwNy00MjQ5LTQ4OTQtYTdhYi0xM2I5M2UwNzM2NWUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJWaWRlb19maWxlcy9WaWRlby1TdGFtcC5tcDQiLCJpYXQiOjE3NzY3NjA0NDcsImV4cCI6ODgxNzY2NzQwNDd9.pyELqluFShwlyWxWctLqBrn7AIGgNogjEmeCgBD0NsI",
      poster: "",
    },
  ];

  let currentSlide = 0;
  const totalSlides = GUIDE_VIDEOS.length;
  let videosLoaded = Array(totalSlides).fill(false);
  let isFetching = Array(totalSlides).fill(false); // Prevents double-downloading if user swipes fast

  function getSlides() {
    return document.querySelectorAll(".guide-slide");
  }
  function getDots() {
    return document.querySelectorAll(".guide-dot");
  }
  function getVideos() {
    return document.querySelectorAll(".guide-slide video");
  }
  function getSlideEl(i) {
    return getSlides()[i];
  }

  // --- THE MAGIC: CACHE API ---
  // This downloads the video from Supabase ONCE and saves it locally forever
  async function getCachedVideoUrl(url) {
    const cacheName = "extension-guide-videos-v1";
    const cache = await caches.open(cacheName);

    // 1. Check if we already downloaded it
    let response = await cache.match(url);

    // 2. If not, download it from Supabase and save it to Cache
    if (!response) {
      console.log("Downloading video from Supabase...");
      response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response.clone());
      } else {
        throw new Error("Failed to fetch video");
      }
    } else {
      console.log("Loaded video from Local Cache!");
    }

    // 3. Convert the downloaded file into a local Object URL for the <video> tag
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async function loadVideoForSlide(i) {
    if (videosLoaded[i] || isFetching[i]) return;
    isFetching[i] = true;

    const placeholder = getSlideEl(i)?.querySelector(
      ".guide-video-placeholder",
    );
    if (!placeholder) return;

    const cfg = GUIDE_VIDEOS[i];

    try {
      // Fetch from Supabase or Local Cache
      const localUrl = await getCachedVideoUrl(cfg.src);

      const vid = document.createElement("video");
      vid.src = localUrl; // Use the local cached blob URL
      vid.loop = true;
      vid.muted = true;
      vid.autoplay = false;
      vid.playsinline = true;
      vid.controls = false;
      if (cfg.poster) vid.poster = cfg.poster;
      vid.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;";

      placeholder.replaceWith(vid);
      videosLoaded[i] = true;

      // If this is the currently active slide, play it once loaded
      if (currentSlide === i) {
        vid.play().catch(() => {});
      }
    } catch (err) {
      console.error("Error loading video:", err);
      // Optional: Add a fallback UI here if the user has no internet on first load
    } finally {
      isFetching[i] = false;
    }
  }

  function goToSlide(i) {
    const leaving = getSlideEl(currentSlide)?.querySelector("video");
    if (leaving) leaving.pause();

    currentSlide = i;
    const slidesEl = document.getElementById("guideSlides");
    if (slidesEl) slidesEl.style.transform = `translateX(-${i * 100}%)`;

    getDots().forEach((d) => {
      const isActive = parseInt(d.dataset.dot) === i;
      d.style.background = isActive
        ? "rgba(255,255,255,0.9)"
        : "rgba(255,255,255,0.35)";
    });

    const prev = document.getElementById("guidePrev");
    const next = document.getElementById("guideNext");
    if (prev) {
      prev.style.opacity = i === 0 ? "0" : "1";
      prev.style.pointerEvents = i === 0 ? "none" : "auto";
    }
    if (next) {
      next.style.opacity = i === totalSlides - 1 ? "0" : "1";
      next.style.pointerEvents = i === totalSlides - 1 ? "none" : "auto";
    }

    // Attempt to load/play
    loadVideoForSlide(i);
    const arriving = getSlideEl(i)?.querySelector("video");
    if (arriving) arriving.play().catch(() => {});
  }

  function onGuideOpen() {
    goToSlide(0);
  }

  function onGuideClose() {
    getVideos().forEach((v) => v.pause());
  }

  // Event Listeners
  const closeBtn = document.getElementById("closeGuideBtn");
  if (closeBtn) closeBtn.addEventListener("click", onGuideClose);
  const overlay = document.getElementById("guideModal");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) onGuideClose();
    });
  }
  const infoBtn = document.getElementById("infoBtn");
  if (infoBtn) {
    infoBtn.addEventListener("click", onGuideOpen);
  }
  const proceedBtn = document.getElementById("proceedLoginBtn");
  if (proceedBtn) {
    proceedBtn.addEventListener("click", onGuideClose);
  }

  document.getElementById("guidePrev")?.addEventListener("click", () => {
    if (currentSlide > 0) goToSlide(currentSlide - 1);
  });
  document.getElementById("guideNext")?.addEventListener("click", () => {
    if (currentSlide < totalSlides - 1) goToSlide(currentSlide + 1);
  });
  document.querySelectorAll(".guide-dot").forEach((dot) => {
    dot.addEventListener("click", () => goToSlide(parseInt(dot.dataset.dot)));
  });

  let touchStartX = 0;
  const sliderEl = document.getElementById("guideSlider");
  if (sliderEl) {
    sliderEl.addEventListener(
      "touchstart",
      (e) => {
        touchStartX = e.touches[0].clientX;
      },
      { passive: true },
    );
    sliderEl.addEventListener(
      "touchend",
      (e) => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) {
          if (diff > 0 && currentSlide < totalSlides - 1)
            goToSlide(currentSlide + 1);
          if (diff < 0 && currentSlide > 0) goToSlide(currentSlide - 1);
        }
      },
      { passive: true },
    );
  }
})();

// Add this function near the top of dashboard.js
function cleanupNoneFolders() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    let stored = res[STORAGE_KEY] || [];
    let changed = false;
    stored = stored.map((n) => {
      if (n.folder === "None" || n.folder === "none" || n.folder === "") {
        changed = true;
        return { ...n, folder: null };
      }
      return n;
    });
    if (changed) {
      chrome.storage.local.set({ [STORAGE_KEY]: stored });
      toast("Cleaned up folder assignments ✓");
    }
  });
}