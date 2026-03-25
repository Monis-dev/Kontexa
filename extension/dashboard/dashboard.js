const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";
const PRO_CACHE_KEY = "cn_is_pro_cached";
const THEME_KEY = "cn_theme";
const NAMES_KEY = "cn_source_names"; // custom display names for URLs
const API_BASE = "https://context-notes.onrender.com";

let mId = null;
let userFolders = [];
let sourceNames = {}; // { [url]: "custom name" }
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

// UI Toggles
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
E($("ovl"), "click", closeS);

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

// --- MODALS ---
E($("infoBtn"), "click", () => {
  $("proceedLoginBtn").style.display = "none";
  $("guideModal").classList.add("on");
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

// ---- Rate Limiting Functions ----- //
// function queueSync(notes) {
//   if (!isLoggedIn) return;

//   if (!Array.isArray(notes)) notes = [notes];

//   // Add to queue
//   syncQueue.push(...notes);

//   // Remove duplicates by id
//   const seen = new Set();
//   syncQueue = syncQueue.filter((n) => {
//     if (seen.has(n.id)) return false;
//     seen.add(n.id);
//     return true;
//   });

//   scheduleSync();
// }

// function updateSyncStatus(text) {
//   console.log("SYNC:", text);
// }

// function scheduleSync() {
//   if (syncTimer) clearTimeout(syncTimer);

//   const now = Date.now();

//   const timeSinceLastSync = now - lastSyncTime;

//   if (timeSinceLastSync > SYNC_MAX_INTERVAL) {
//     flushSyncQueue();
//     return;
//   }

//   syncTimer = setTimeout(flushSyncQueue, SYNC_DEBOUNCE);
// }

// async function flushSyncQueue() {
//   if (!navigator.onLine) {
//     console.warn("Offline — sync paused");
//     return;
//   }
//   window.addEventListener("online", () => {
//     if (syncQueue.length > 0) {
//       console.log("Back online — resuming sync");
//       flushSyncQueue();
//     }
//   });
//   if (!syncQueue.length) return;

//   const batch = syncQueue.splice(0, MAX_BATCH_SIZE);
//   updateSyncStatus("Syncing...");
//   try {
//     const res = await fetch(`${API_BASE}/api/sync`, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(batch),
//       credentials: "include",
//     });

//     if (!res.ok) {
//       throw new Error("Sync failed: " + res.status);
//     }

//     lastSyncTime = Date.now();
//     updateSyncStatus("Synced ✓");
//     console.log("Synced batch:", batch.length);
//   } catch (err) {
//     console.warn("Sync failed — retrying later");

//     syncQueue.unshift(...batch);

//     setTimeout(flushSyncQueue, retryDelay);

//     retryDelay = Math.min(retryDelay * 2, 30000);

//     return;
//   }
//   retryDelay = 2000;
//   // Continue syncing if more remain
//   if (syncQueue.length > 0) {
//     setTimeout(flushSyncQueue, 1500);
//   }

// }

// --- OPEN NOTE MODAL ---
function openNoteModal(noteId) {
  const n = notesById[noteId];
  if (!n) return;

  $("vTitle").textContent = n.title || "Untitled";

  const metaParts = [];
  if (n.pinned) {
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:3px 8px;border-radius:20px;">⭐ Pinned</span>`,
    );
  }
  if (n.folder) {
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:var(--acc-bg);color:var(--acc);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;">📁 ${esc(n.folder)}</span>`,
    );
  }
  if (n.timestamp) {
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe;padding:3px 8px;border-radius:20px;">⏱️ ${esc(n.timestamp)}</span>`,
    );
  }
  if (n.domain) {
    metaParts.push(
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;background:var(--bg);color:var(--mut);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;">🌐 ${esc(n.domain)}</span>`,
    );
  }
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

  if (n.url) {
    $("vMeta").innerHTML +=
      `<a href="${esc(n.url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;background:var(--bg);color:var(--acc);border:1px solid var(--bdr);padding:3px 8px;border-radius:20px;text-decoration:none;">↗ Visit Source</a>`;
  }

  $("viewModal").classList.add("on");
}

E($("closeView"), "click", () => $("viewModal").classList.remove("on"));
E($("viewModal"), "click", (e) => {
  if (e.target === $("viewModal")) $("viewModal").classList.remove("on");
});

// Opens an inline prompt to rename a URL source or folder
// --- RENAME SOURCE ---
function renameSource(url, currentName) {
  const newName = prompt(`Rename "${currentName}" to:`, currentName);
  const clean = newName?.trim();
  if (!clean || clean === currentName) return;

  sourceNames[url] = newName.trim();

  chrome.storage.local.set({ [NAMES_KEY]: sourceNames }, async () => {
    toast(`Renamed to "${newName.trim()}"`);
    loadLocalUI();

    // NEW: Sync the custom name to the server if logged in
    if (isLoggedIn) {
      try {
        await fetch(`${API_BASE}/api/websites/rename`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, custom_name: newName.trim() }),
          credentials: "include",
        });
      } catch (err) {
        console.error("Failed to sync rename to server", err);
      }
    }
  });
}

// Get the display name for a URL group — custom name if set, else cleaned URL
function getDisplayName(url) {
  if (sourceNames[url]) return sourceNames[url];
  let name = url.replace(/^https?:\/\/(www\.)?/, "");
  return name.length > 50 ? name.substring(0, 50) + "…" : name;
}

// --- CARD GENERATOR ---
const card = (n, dom) => {
  const title = n.title || "Untitled";
  const body = n.content || "";
  const sel = n.selection || n.text_selection || "";
  const searchStr = (title + " " + body).toLowerCase();

  const pinColor = n.pinned ? "#f59e0b" : "currentColor";
  const pinFill = n.pinned ? "#f59e0b" : "none";

  let mediaHtml = "";
  if (n.timestamp) {
    mediaHtml += `<div style="font-size:11px;background:#eef2ff;color:#4f46e5;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:6px;margin-right:4px;border:1px solid #c7d2fe;">⏱️ ${n.timestamp}</div>`;
  }
  if (n.image_data) {
    mediaHtml += `<div style="margin-top:8px;border-radius:6px;overflow:hidden;border:1px solid #e2e8f0;">
      <img loading="lazy" src="${n.image_data}" style="width:100%;height:auto;display:block;pointer-events:none;">
    </div>`;
  }

  return `<div class="card card-clickable" data-id="${n.id}" data-t="${esc(searchStr)}" data-open-note="${n.id}" title="Click to view note">
    <div class="ct">${esc(title)}</div>
    ${mediaHtml}
    ${sel ? `<div class="chi">"${esc(sel)}"</div>` : ""}
    ${body ? `<div class="cb">${esc(body)}</div>` : ""}
    <div class="card-footer">
      <div class="ctags">
      <span class="tag">${esc(dom.slice(0, 22))}</span>
      ${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}
    </div>
      <div class="ca">
        <button class="act btn-pin" title="Pin Note" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:${pinColor};fill:${pinFill};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <button class="act btn-move" title="Move to Folder" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="act btn-edit" title="Edit" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="act del btn-delete" title="Delete" data-id="${n.id}">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  </div>`;
};

// --- RENDER MAIN DASHBOARD ---
function render(urlGroups, folderGroups) {
  $("skel")?.remove();
  const total = allNotesFlat.length;

  $("smeta").textContent =
    `${urlGroups.length} page${urlGroups.length !== 1 ? "s" : ""} · ${total} notes`;

  // Sidebar nav uses the Safe ID (s.id)
  $("snav").innerHTML = urlGroups.length
    ? urlGroups
        .map((s, i) => {
          const displayName = sourceNames[s.url]
            ? sourceNames[s.url]
            : s.domain.replace(/^www\./, "");
          return `<a class="na${i === 0 ? " on" : ""}" href="#${s.id}" data-t="${s.id}" title="${esc(s.url)}">
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
          .map((n) => card(n, group.domain))
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
            <span class="sdom sdom-name" data-custom="${sourceNames[group.url] ? "true" : "false"}" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(group.url)}">${esc(displayName)}</span>
            <button class="btn-rename" data-url="${esc(group.url)}" data-name="${esc(displayName)}" title="Rename this source">
              <svg viewBox="0 0 24 24" style="width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <a href="${esc(group.url)}" target="_blank" rel="noopener" class="slink">Visit ↗</a>
            <span class="scnt">${group.notes.length} note${group.notes.length !== 1 ? "s" : ""}</span>
          </div>`;
        }

        // USE THE SAFE ID HERE!
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

// --- SCROLL FIX ---
function scrollMainToSection(sectionId) {
  const mainEl = $("main");
  const target = $(sectionId);
  if (!mainEl || !target) return;

  // Force main to be relative so offsetTop calculates perfectly
  mainEl.style.position = "relative";

  // Scroll exactly to the target, minus 28px for the top padding
  mainEl.scrollTo({ top: target.offsetTop - 28, behavior: "smooth" });
}
// --- BIND NAV ---
function bindNav() {
  const nas = document.querySelectorAll(".na[data-t]");
  nas.forEach((a) => {
    // Remove old listeners by cloning
    const fresh = a.cloneNode(true);
    a.parentNode.replaceChild(fresh, a);
    fresh.addEventListener("click", (e) => {
      e.preventDefault();
      // If singlePageView is open, close it first
      if ($("singlePageView").style.display === "block") {
        $("singlePageView").style.display = "none";
        $("main").style.display = "block";
      }
      // Use our fixed scroll function instead of scrollIntoView
      scrollMainToSection(fresh.dataset.t);
      document.querySelectorAll(".na").forEach((n) => n.classList.remove("on"));
      fresh.classList.add("on");
      if (mob()) closeS();
    });
  });
}

// --- GLOBAL EVENT DELEGATION ---
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".btn-edit");
  const delBtn = e.target.closest(".btn-delete");
  const pinBtn = e.target.closest(".btn-pin");
  const moveBtn = e.target.closest(".btn-move");
  const viewMoreBtn = e.target.closest(".btn-view-more");
  const logoutBtn = e.target.closest("#logoutBtn");
  const renameBtn = e.target.closest(".btn-rename");

  // Note card click → open detail modal
  const noteCard = e.target.closest("[data-open-note]");
  if (noteCard && !editBtn && !delBtn && !pinBtn && !moveBtn) {
    openNoteModal(noteCard.dataset.openNote);
    return;
  }

  // Rename source
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
    if (isProUserUI != true) {
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
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                pinned: allNotesFlat[idx].pinned,
              }),
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
    const cardEl = editBtn.closest(".card");
    $("etitle").value = cardEl.querySelector(".ct")?.textContent.trim() || "";
    $("eta").value = cardEl.querySelector(".cb")?.textContent.trim() || "";
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
        await fetch(`${API_BASE}/api/notes/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
      }
    });
  }
});

// Move notes
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
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              folder: selectedFolder || null,
            }),
          });
        } catch (err) {
          console.error("Move sync failed", err);
        }
      }
    });
  }
});

// Edit Save
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
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: titleVal,
              content: contentVal,
            }),
          });
        } catch (err) {
          console.error("Edit sync failed", err);
        }
      }
    });
  }
});

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

// --- LOAD & GROUP DATA ---
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
    }));
    notesById = Object.fromEntries(allNotesFlat.map((n) => [n.id, n]));
    sourceNames = res[NAMES_KEY] || {};

    notesByUrl = {};
    const groupedUrls = {};
    const groupedFolders = {};
    folderCounts = {};

    for (const n of allNotesFlat) {
      // URL grouping
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

      // Folder grouping
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
        .map((f) => {
          const count = folderCounts[f] || 0;
          const fid = getSafeId("folder_" + f); // <--- Safe ID
          return `<a class="na" href="#${fid}" data-t="${fid}"><div class="dot" style="border-radius:2px;background:var(--mut2);"></div><span class="nd">${esc(f)}</span><span class="bdg">${count}</span></a>`;
        })
        .join("")
    : '<p style="padding:12px;font-size:12px;color:var(--mut)">No folders yet.</p>';
  bindNav();
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

// Paywall Actions
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

// SYNC ENGINE
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
      chrome.storage.local.set({
        [PRO_CACHE_KEY]: user.is_pro,
      });
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
        if (localNotes.length > 0) {
          try {
            queueSync(localNotes);
          } catch (e) {}
        }
        const cloudRes = await fetch(`${API_BASE}/api/notes`, {
          credentials: "include",
        });
        if (cloudRes.ok) {
          const cloudData = await cloudRes.json();
          cloudData.forEach((site) => {
            if (site.custom_name) {
              sourceNames[site.url] = site.custom_name;
            }
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
              });
            }),
          );
          const mergedMap = new Map();

          // Create cloud ID set
          const cloudIds = new Set(flattenedCloudNotes.map((n) => n.id));

          // Add cloud notes first
          flattenedCloudNotes.forEach((n) => {
            mergedMap.set(n.id, n);
          });

          // Detect notes deleted on other devices
          const deletedElsewhere = [];

          localNotes.forEach((n) => {
            if (!cloudIds.has(n.id)) {
              deletedElsewhere.push(n);
            } else {
              mergedMap.set(n.id, n);
            }
          });
          for (const note of deletedElsewhere) {
            const shouldDelete = confirm(
              `⚠ This note was deleted on another device:\n\n"${note.title}"\n\nDelete it here too?`,
            );

            if (shouldDelete) {
              // Remove locally
              mergedMap.delete(note.id);
            } else {
              // Restore to cloud
              try {
                await fetch(`${API_BASE}/api/sync`, {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify([note]),
                });
              } catch (err) {
                console.error("Restore failed", err);
              }

              mergedMap.set(note.id, note);
            }
          }

          const mergedNotes = Array.from(mergedMap.values());

          chrome.storage.local.set({ [STORAGE_KEY]: mergedNotes }, loadLocalUI);
        }
      });
    } else {
      $("uStatus").textContent = "Local Mode Only";
      loadLocalUI();
    }
  } catch (e) {
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
  if (!isLoggedIn && now - lastAuthCheck > 15000) {
    lastAuthCheck = now;
    checkAuthAndSync();
  }
});
window.onload = () => {
  chrome.storage.local.get(PRO_CACHE_KEY, (res) => {
    isProUserUI = res[PRO_CACHE_KEY] === true;
    loadLocalUI(); // render UI immediately using cache
  });

  checkAuthAndSync(); // verify in background
};

// --- ADD NOTE MODAL ---
// Opens the add-note modal pre-filled with context (url/folder).
// context = { type: "page", url, domain, displayName }
//         | { type: "folder", folderName }
function openAddNoteModal(context) {
  const modal = $("addNoteModal");

  // Reset fields
  $("anTitle").value = "";
  $("anContent").value = "";
  $("anUrl").value = context.type === "page" ? context.url || "" : "";

  // Show/hide the URL field depending on context
  const urlRow = $("anUrlRow");
  if (context.type === "folder") {
    // Folder notes don't have a forced URL — show the field so user can optionally add one
    urlRow.style.display = "block";
    $("anUrlLabel").textContent = "Source URL (optional)";
  } else {
    // Page notes already know their URL — show it but let user edit
    urlRow.style.display = "block";
    $("anUrlLabel").textContent = "Source URL";
  }

  // Store context on the modal for use when saving
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

  // Build the note object — mirrors the shape used by the extension
  const newNote = {
    id: "dash_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    title: titleVal,
    content: contentVal,
    selection: "",
    url:
      urlVal || (context.type === "page" ? context.url : "dashboard://manual"),
    domain:
      context.type === "page"
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
    allNotesFlat = latestNotes; // Update global state

    chrome.storage.local.set({ [STORAGE_KEY]: allNotesFlat }, async () => {
      closeAddNoteModal();
      toast("Note added ✓");

      // Refresh the current view
      if (context.type === "page") {
        openSpecificPage(newNote.url);
      } else {
        openSpecificFolder(context.folderName);
      }

      // Sync to server if logged in
      if (isLoggedIn) {
        try {
          await fetch(`${API_BASE}/api/sync`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
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
// Allow Ctrl/Cmd+Enter to save from the textarea
E($("anContent"), "keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    saveNewNote();
  }
});

// --- PAGE / FOLDER DETAIL VIEWS ---
function openSpecificPage(targetUrl) {
  $("main").style.display = "none";
  $("singlePageView").style.display = "block";

  const siteNotes = notesByUrl[targetUrl] || [];
  siteNotes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const displayName = getDisplayName(targetUrl);
  // Extract domain from the URL for use in new notes
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
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle;margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Note
        </button>
      </div>
    </div>
    <div class="grid wrap" id="pageNoteGrid">
      ${
        siteNotes.length
          ? siteNotes.map((n) => card(n, pageDomain)).join("")
          : `<p style="color:var(--mut);font-size:13px;" id="emptyMsg">No notes for this page yet.</p>`
      }
    </div>
  `;

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
    const lines = [];
    lines.push(`# Notes — ${displayName}`);
    lines.push(
      `*Exported from ContextNote on ${new Date().toLocaleDateString()}*`,
    );
    lines.push(`*Source: ${targetUrl}*`);
    lines.push("");
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
    const filename = displayName.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
    a.href = URL.createObjectURL(blob);
    a.download = `contextnote_${filename}.md`;
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
    <div class="globe" style="background:var(--hbg);">
              <svg viewBox="0 0 24 24" style="width:25px;height:25px;stroke:var(--hbdr);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>  
    <div class="mh">${esc(folderName)}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn" id="downloadMdBtn" title="Download notes as Markdown">⬇ .md</button>
        <button class="btn" id="addNoteBtn">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle;margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Note
        </button>
      </div>
    </div>
    <div class="grid wrap" id="pageNoteGrid">
      ${
        folderNotes.length
          ? folderNotes.map((n) => card(n, n.domain || folderName)).join("")
          : `<p style="color:var(--mut);font-size:13px;" id="emptyMsg">No notes in this folder yet.</p>`
      }
    </div>
  `;

  E($("backToDash"), "click", () => {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
    loadLocalUI();
  });
  E($("addNoteBtn"), "click", () => {
    openAddNoteModal({ type: "folder", folderName });
  });
  E($("downloadMdBtn"), "click", () => {
    const lines = [];
    lines.push(`# Folder — ${folderName}`);
    lines.push(
      `*Exported from ContextNote on ${new Date().toLocaleDateString()}*`,
    );
    lines.push("");
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
    const filename = folderName.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
    a.href = URL.createObjectURL(blob);
    a.download = `contextnote_folder_${filename}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Downloaded ✓");
  });
}

// --- MARKDOWN RENDERER ---
// Converts AI markdown responses to clean HTML for display in the chat box.
function renderMarkdown(text) {
  return (
    text
      // Escape HTML first for safety
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Bold + italic combo (must come before bold and italic individually)
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(
        /`([^`]+)`/g,
        '<code style="background:var(--bg);border:1px solid var(--bdr);padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace">$1</code>',
      )
      // H3
      .replace(
        /^### (.+)$/gm,
        '<h4 style="margin:10px 0 4px;font-size:13px;font-weight:600;color:var(--ink)">$1</h4>',
      )
      // H2
      .replace(
        /^## (.+)$/gm,
        '<h3 style="margin:12px 0 4px;font-size:14px;font-weight:600;color:var(--ink)">$1</h3>',
      )
      // H1
      .replace(
        /^# (.+)$/gm,
        '<h2 style="margin:14px 0 6px;font-size:15px;font-weight:700;color:var(--ink)">$1</h2>',
      )
      // Unordered list items
      .replace(
        /^\s*[-*•] (.+)$/gm,
        '<li style="margin:3px 0;padding-left:4px">$1</li>',
      )
      // Numbered list items
      .replace(
        /^\s*\d+\. (.+)$/gm,
        '<li style="margin:3px 0;padding-left:4px;list-style-type:decimal">$1</li>',
      )
      // Wrap consecutive <li> elements in a <ul>
      .replace(
        /((?:<li[^>]*>[\s\S]*?<\/li>\s*)+)/g,
        '<ul style="margin:6px 0;padding-left:18px">$1</ul>',
      )
      // Horizontal rule
      .replace(
        /^---$/gm,
        '<hr style="border:none;border-top:1px solid var(--bdr);margin:10px 0">',
      )
      // Double newline → paragraph break
      .replace(/\n\n/g, '</p><p style="margin:6px 0">')
      // Single newline → line break
      .replace(/\n/g, "<br>")
      // Wrap entire output in a paragraph
      .replace(/^/, '<p style="margin:0">')
      .replace(/$/, "</p>")
  );
}

// AI logic
E($("aiBtn"), "click", () => {
  $("aiChatBox").innerHTML =
    '<div class="chat-msg chat-ai">Ask me anything about your saved notes.</div>';

  $("aiModal").dataset.context = JSON.stringify(allNotesFlat);
  $("aiModal").classList.add("on");
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

      // fallback if no match
      if (domainFiltered.length > 0) {
        scopedNotes = domainFiltered;
      }
    }

    const filteredNotes = smartFilterNotes(scopedNotes, q);

    const result = await AIService.chat(q, filteredNotes);

    const aiAnswer = result?.answer || "⚠️ No answer received.";
    const aiTags = result?.tags || {};

    console.log(
      "Filtered Notes:",
      filteredNotes.map((n) => n.id),
    );
    console.log("AI TAGS:", aiTags);

    const res = await new Promise((resolve) => {
      chrome.storage.local.get("context_notes_data", resolve);
    });

    let allNotes = res.context_notes_data || [];

    const updated = allNotes.map((note) => {
      const newTags = aiTags[note.id];
      if (newTags && newTags.length > 0) {
        const existingTags = note.tags || [];
        const merged = [...new Set([...existingTags, ...newTags])]; // merge, no duplicates
        return { ...note, tags: merged };
      }
      return note;
    });

    await new Promise((resolve) => {
      chrome.storage.local.set({ context_notes_data: updated }, resolve);
    });

    const tagUpdates = Object.entries(aiTags)
      .filter(([id, tags]) => tags && tags.length > 0)
      .map(([id, tags]) => ({ id, tags }));

    if (tagUpdates.length > 0) {
      try {
        const resp = await fetch(`${API_BASE}/api/notes/tags`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tagUpdates),
        });
        console.log("Tags synced:", await resp.json());
      } catch (e) {
        console.warn("Tag sync failed", e);
      }
    }

    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai" style="line-height:1.6">
        ${renderMarkdown(aiAnswer)}
      </div>`,
    );
  } catch (e) {
    console.error("AI ERROR:", e);

    chatBox.insertAdjacentHTML(
      "beforeend",
      `<div class="chat-msg chat-ai">
        Error: Could not connect to AI.
      </div>`,
    );
  }

  // 🔓 unlock UI
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

// API Key logic
E($("closeApiSettingsBtn"), "click", () =>
  $("apiSettingsModal").classList.remove("on"),
);
E($("apiSettingsBtn"), "click", () => {
  chrome.storage.local.get(["gemini_key"], (res) => {
    $("apiKeyInput").value = res.gemini_key || "";
    $("apiSettingsModal").classList.add("on");
  });
});
E($("saveApiKey"), "click", () => {
  const key = $("apiKeyInput").value.trim();
  chrome.storage.local.set({ gemini_key: key }, () => {
    toast("API Key saved securely.");
    $("apiSettingsModal").classList.remove("on");
  });
});

// Theme Engine
const panel = document.getElementById("themeGrid");
// Dynamically build the theme menu based on CN_THEMES
function buildThemeMenu() {
  const grid = document.querySelector(".palette-grid");
  if (!grid || typeof CN_THEMES === "undefined") return;

  grid.innerHTML = "";

  Object.keys(CN_THEMES).forEach((themeKey) => {
    const theme = CN_THEMES[themeKey];

    const swatch = document.createElement("div");
    swatch.className = "palette-swatch";
    swatch.dataset.theme = themeKey;

    swatch.innerHTML = `
      <div class="swatch-circle" style="background:${theme.swatch}"></div>
      <span class="swatch-label">${theme.emoji} ${theme.label}</span>
    `;

    swatch.addEventListener("click", () => {
      applyTheme(themeKey);
      $("themePanel").classList.remove("on");
    });

    grid.appendChild(swatch);
  });
}

// Apply Theme Function
function applyTheme(theme) {
  // 1. Check if CN_THEMES exists and fallback to "nova" if missing
  if (typeof CN_THEMES === "undefined" || !CN_THEMES[theme]) {
    theme = "nova";
  }

  // 2. Set HTML data attribute
  document.documentElement.setAttribute("data-theme", theme);

  // 3. Inject CSS Variables into the page
  if (typeof CN_THEMES !== "undefined" && CN_THEMES[theme]) {
    const themeData = CN_THEMES[theme];
    for (const [key, value] of Object.entries(themeData.vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }

  // 4. Update the active checkmark/highlight in the UI menu
  document.querySelectorAll(".palette-swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.theme === theme);
  });

  // 5. Save to Chrome storage
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.set({ [THEME_KEY]: theme });
  }
}

// Initialize Menu
buildThemeMenu();

// Load Saved Theme
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get([THEME_KEY], (res) => {
    applyTheme(res[THEME_KEY] || "nova"); // Default is now nova
  });
} else {
  applyTheme("nova");
}

// Panel Toggle Events (Opening and closing the menu)
if ($("themeBtn")) {
  E($("themeBtn"), "click", (e) => {
    e.stopPropagation();
    $("themePanel").classList.toggle("on");
  });
}

document.addEventListener("click", (e) => {
  if (
    $("themePanel") &&
    !$("themePanel").contains(e.target) &&
    $("themeBtn") &&
    e.target !== $("themeBtn") &&
    !$("themeBtn").contains(e.target)
  ) {
    $("themePanel").classList.remove("on");
  }
});

window.addEventListener("beforeunload", () => {
  if (syncQueue.length > 0) {
    navigator.sendBeacon(
      `${API_BASE}/api/sync`,
      new Blob([JSON.stringify(syncQueue)], { type: "application/json" }),
    );
  }
});
