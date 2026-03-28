importScripts("ai_service.js");

const STORAGE_KEY = "context_notes_data";
const FOLDERS_KEY = "cn_user_folders";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-highlight",
    title: "Save Highlight to ContextNote",
    contexts: ["selection", "page", "video"],
  });
});

// --- HELPER: Extract Video Time ---
function getPageMediaData() {
  const video = document.querySelector("video");
  if (video && !Number.isNaN(video.duration)) {
    const totalSeconds = Math.floor(video.currentTime);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const timeStr =
      h > 0
        ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
        : `${m}:${s.toString().padStart(2, "0")}`;
    return { timestamp: timeStr, hasVideo: true };
  }
  return { timestamp: null, hasVideo: false };
}

// --- THEME VARS MAP ---
// This lives in the background worker so it can be passed into injected func: scripts.
// Keep this in sync with themes.js whenever you add/edit a theme.
const CN_THEME_VARS = {
  nova: {
    "--bg": "#f6f7f9",
    "--sur": "#ffffff",
    "--bdr": "#e4e7ec",
    "--bdrs": "#d0d5dd",
    "--ink": "#101828",
    "--ink2": "#344054",
    "--mut": "#667085",
    "--mut2": "#98a2b3",
    "--acc": "#4f46e5",
    "--acc-bg": "#eef2ff",
    "--acc-h": "#4338ca",
    "--hbg": "#fffbeb",
    "--hbdr": "#f59e0b",
    "--logo1": "#6366f1",
    "--logo2": "#4f46e5",
    "--cr": "12px",
    "--cs": "0 2px 8px rgba(79, 70, 229, 0.07)",
    "--cbl": "none",
    "--bgd": "none",
    "--nav": "#ffffff",
  },
  midnight: {
    "--bg": "#080f1a",
    "--sur": "#111827",
    "--bdr": "#1f2d3d",
    "--bdrs": "#2d3f52",
    "--ink": "#e2e8f0",
    "--ink2": "#94a3b8",
    "--mut": "#475569",
    "--mut2": "#334155",
    "--acc": "#22d3ee",
    "--acc-bg": "#0c2233",
    "--acc-h": "#06b6d4",
    "--hbg": "#1a2535",
    "--hbdr": "#22d3ee",
    "--logo1": "#38bdf8",
    "--logo2": "#22d3ee",
    "--cr": "10px",
    "--cs": "0 0 0 1px #1f2d3d, 0 4px 24px rgba(0,0,0,0.4)",
    "--cbl": "none",
    "--bgd":
      "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(34,211,238,0.06) 0%, transparent 70%)",
    "--nav": "#0d1520",
  },
  aurora: {
    "--bg": "#0d0d1a",
    "--sur": "#13132a",
    "--bdr": "#2a1f4a",
    "--bdrs": "#3d2b6e",
    "--ink": "#f0e6ff",
    "--ink2": "#c4b5fd",
    "--mut": "#7c6fcd",
    "--mut2": "#4c3d8a",
    "--acc": "#a855f7",
    "--acc-bg": "#1e0a3c",
    "--acc-h": "#9333ea",
    "--hbg": "#1a0a2e",
    "--hbdr": "#ec4899",
    "--logo1": "#a855f7",
    "--logo2": "#ec4899",
    "--cr": "14px",
    "--cs": "0 4px 30px rgba(168,85,247,0.15)",
    "--cbl": "none",
    "--bgd":
      "radial-gradient(ellipse 100% 80% at 0% 100%, rgba(236,72,153,0.08) 0%, transparent 50%), radial-gradient(ellipse 80% 60% at 100% 0%, rgba(168,85,247,0.1) 0%, transparent 50%)",
    "--nav": "#0f0f22",
  },
  forest: {
    "--bg": "#f0faf4",
    "--sur": "#ffffff",
    "--bdr": "#bbf7d0",
    "--bdrs": "#86efac",
    "--ink": "#14532d",
    "--ink2": "#166534",
    "--mut": "#4ade80",
    "--mut2": "#86efac",
    "--acc": "#16a34a",
    "--acc-bg": "#dcfce7",
    "--acc-h": "#15803d",
    "--hbg": "#fefce8",
    "--hbdr": "#a3e635",
    "--logo1": "#4ade80",
    "--logo2": "#16a34a",
    "--cr": "14px",
    "--cs": "0 2px 12px rgba(22,163,74,0.08)",
    "--cbl": "4px solid #4ade80",
    "--bgd": "none",
    "--nav": "#f0fdf4",
  },
  parchment: {
    "--bg": "#fdf6e3",
    "--sur": "#fef9ed",
    "--bdr": "#e8d5a3",
    "--bdrs": "#d4b483",
    "--ink": "#3b2a1a",
    "--ink2": "#5c3d1e",
    "--mut": "#a07850",
    "--mut2": "#c4a46b",
    "--acc": "#c2410c",
    "--acc-bg": "#fff7ed",
    "--acc-h": "#9a3412",
    "--hbg": "#fef3c7",
    "--hbdr": "#d97706",
    "--logo1": "#d97706",
    "--logo2": "#c2410c",
    "--cr": "4px",
    "--cs":
      "2px 3px 8px rgba(59,42,26,0.12), inset 0 0 0 1px rgba(59,42,26,0.06)",
    "--cbl": "none",
    "--bgd": "none",
    "--nav": "#fdf0d5",
  },
  slate: {
    "--bg": "#f8fafc",
    "--sur": "#ffffff",
    "--bdr": "#e2e8f0",
    "--bdrs": "#cbd5e1",
    "--ink": "#0f172a",
    "--ink2": "#1e293b",
    "--mut": "#64748b",
    "--mut2": "#94a3b8",
    "--acc": "#0f172a",
    "--acc-bg": "#f1f5f9",
    "--acc-h": "#1e293b",
    "--hbg": "#f8fafc",
    "--hbdr": "#475569",
    "--logo1": "#334155",
    "--logo2": "#0f172a",
    "--cr": "8px",
    "--cs": "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
    "--cbl": "none",
    "--bgd": "none",
    "--nav": "#f8fafc",
  },
  sunset: {
    "--bg": "#fff7f3",
    "--sur": "#ffffff",
    "--bdr": "#fed7aa",
    "--bdrs": "#fdba74",
    "--ink": "#431407",
    "--ink2": "#7c2d12",
    "--mut": "#ea580c",
    "--mut2": "#fb923c",
    "--acc": "#ea580c",
    "--acc-bg": "#fff1e6",
    "--acc-h": "#c2410c",
    "--hbg": "#fef3c7",
    "--hbdr": "#f59e0b",
    "--logo1": "#f97316",
    "--logo2": "#e11d48",
    "--cr": "12px",
    "--cs": "0 4px 16px rgba(234,88,12,0.1)",
    "--cbl": "none",
    "--bgd":
      "radial-gradient(ellipse 70% 50% at 100% 0%, rgba(249,115,22,0.06) 0%, transparent 60%)",
    "--nav": "#fff3ee",
  },
  arctic: {
    "--bg": "#f0f9ff",
    "--sur": "#ffffff",
    "--bdr": "#bae6fd",
    "--bdrs": "#7dd3fc",
    "--ink": "#0c2340",
    "--ink2": "#0e3a5c",
    "--mut": "#38bdf8",
    "--mut2": "#7dd3fc",
    "--acc": "#0284c7",
    "--acc-bg": "#e0f2fe",
    "--acc-h": "#0369a1",
    "--hbg": "#f0f9ff",
    "--hbdr": "#38bdf8",
    "--logo1": "#7dd3fc",
    "--logo2": "#0284c7",
    "--cr": "16px",
    "--cs": "0 4px 20px rgba(2,132,199,0.08)",
    "--cbl": "none",
    "--bgd":
      "radial-gradient(ellipse 90% 60% at 50% -20%, rgba(125,211,252,0.15) 0%, transparent 60%)",
    "--nav": "#e0f2fe",
  },
};

// --- MAIN LOGIC ---
async function executeContextNoteFlow(tab, explicitSelection = null) {
  const API_BASE = "https://context-notes.onrender.com";

  // 1. Check Auth
  let isPro = false;
  try {
    const authRes = await fetch(`${API_BASE}/api/me`, {
      credentials: "include",
    });
    if (authRes.ok) {
      const user = await authRes.json();
      isPro = user.is_pro === true;
    }
  } catch (e) {
    console.warn("Server offline, assuming Free tier.");
  }

  // 2. Get Video Data
  let mediaData = { timestamp: null, hasVideo: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageMediaData,
    });
    if (results && results[0]) mediaData = results[0].result;
  } catch (e) {}

  // 3. Get User Folders
  const storageRes = await chrome.storage.local.get([FOLDERS_KEY]);
  const userFolders = storageRes[FOLDERS_KEY] || [];

  // 4. Get Theme — read here in the background worker, pass as arg
  const themeRes = await chrome.storage.local.get(["cn_theme"]);
  const activeTheme = themeRes.cn_theme || "nova";
  const themeVars = CN_THEME_VARS[activeTheme] || CN_THEME_VARS.nova;

  // 5. Inject Dialog — pass themeVars as an argument, no file injection needed
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    // ─── ALL args passed in here, nothing read from storage inside func ───
    args: [explicitSelection, mediaData, isPro, userFolders, themeVars],
    func: (passedSelection, media, isProUser, folders, tVars) => {
      if (document.getElementById("cn-ext-dialog")) return;

      let selectionText =
        passedSelection || window.getSelection().toString().trim();

      if (!isProUser) media.timestamp = null;

      if (!selectionText && media.timestamp) {
        selectionText = `Saved at timestamp ${media.timestamp}`;
      } 

      // ── Build dialog ──
      const dialog = document.createElement("dialog");
      dialog.id = "cn-ext-dialog";

      // Apply theme CSS variables directly to the dialog element.
      // This is the ONLY reliable way — setting on document.documentElement
      // from an injected script is overridden by host page styles.
      Object.entries(tVars).forEach(([k, v]) => dialog.style.setProperty(k, v));

      dialog.style.cssText += `
        padding: 20px;
        border-radius: 12px;
        border: 1px solid var(--bdr);
        font-family: system-ui, -apple-system, sans-serif;
        width: 340px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.25);
        background: var(--bg);
        color: var(--ink);
        z-index: 2147483647;
        position: fixed;
        top: 20px;
        right: 20px;
        margin: 0;
        box-sizing: border-box;
      `;

      // ── Meta HTML ──
      let metaHtml = "";
      if (media.hasVideo) {
        if (isProUser && media.timestamp) {
          metaHtml = `<span style="background:#eef2ff;color:#4f46e5;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;display:inline-flex;align-items:center;gap:4px;border:1px solid #c7d2fe;">⏱️ ${media.timestamp}</span>`;
        } else {
          metaHtml = `<span onclick="alert('👑 Unlock YouTube Timestamps with ContextNote Pro!')" style="background:#fff1f2;color:#e11d48;padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;display:inline-flex;align-items:center;border:1px solid #fecdd3;cursor:pointer;">👑 Pro Timestamp</span>`;
        }
      }

      // ── Folder HTML ──
      const generalToggleHtml = `
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;color:var(--mut);cursor:pointer;">
          <input type="checkbox" id="cn-general-toggle" />
          Save as General Note
        </label>
      `;

      const selectionBoxHtml = selectionText
        ? `<div style="font-size:12px;font-style:italic;color:#92400e;background:#fffbeb;padding:10px;border-left:3px solid #f59e0b;margin-bottom:12px;border-radius:4px;max-height:80px;overflow-y:auto;line-height:1.4;">"${selectionText}"</div>`
        : "";


      let folderHtml = "";
      if (isProUser && folders.length > 0) {
        folderHtml = `
          <select id="cn-folder" style="width:100%;padding:8px;margin-bottom:12px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;background:var(--sur);color:var(--ink);outline:none;">
            <option value="">No Folder (Default)</option>
            ${folders.map((f) => `<option value="${f}">${f}</option>`).join("")}
          </select>
        `;
      } else if (!isProUser) {
        folderHtml = `<div style="font-size:11px;color:var(--mut);margin-bottom:12px;text-align:right;">👑 Pro: Save to Folders</div>`;
      }

      dialog.innerHTML = `
        <h3 style="margin:0 0 12px 0;font-size:16px;color:var(--acc);display:flex;justify-content:space-between;align-items:center;">
          <span>New Note</span>
          ${metaHtml}
        </h3>

        ${selectionBoxHtml}

        <input type="text" id="cn-title" placeholder="Note Heading..." style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:8px;border:1px solid var(--bdr);border-radius:6px;font-size:13px;outline:none;background:var(--sur);color:var(--ink);" />
        <textarea id="cn-desc" placeholder="Add a description..." style="width:100%;box-sizing:border-box;padding:10px;height:70px;margin-bottom:8px;border:1px solid var(--bdr);border-radius:6px;resize:none;font-size:13px;font-family:inherit;outline:none;background:var(--sur);color:var(--ink);"></textarea>

        ${generalToggleHtml}
        ${folderHtml}

        <div id="cn-img-preview" style="display:none;margin-bottom:12px;position:relative;">
          <img id="cn-img-tag" style="width:100%;height:auto;border-radius:6px;border:1px solid var(--bdr);max-height:150px;object-fit:cover;">
          <button id="cn-remove-img" style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:10px;">✕</button>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <button id="cn-snap" style="background:var(--acc-bg);color:var(--acc);border:1px solid var(--bdr);padding:8px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
            📸 <span id="cn-snap-text">Screenshot</span>
          </button>
          <div style="display:flex;gap:8px;">
            <button id="cn-cancel" style="padding:8px 12px;border:none;background:var(--acc-bg);color:var(--mut);border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">Cancel</button>
            <button id="cn-save" style="padding:8px 14px;border:none;background:var(--acc);color:#fff;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">Save</button>
          </div>
        </div>
      `;

      // Re-apply theme vars after innerHTML (innerHTML resets inline styles on children,
      // but the dialog element's own style is preserved — this is just a safety net)
      Object.entries(tVars).forEach(([k, v]) => dialog.style.setProperty(k, v));

      const style = document.createElement("style");
      style.textContent = `#cn-ext-dialog::backdrop { background: rgba(0,0,0,0.35); }`;
      document.head.appendChild(style);

      document.body.appendChild(dialog);
      dialog.showModal();

      let currentImage = null;

      document.getElementById("cn-cancel").onclick = () => dialog.remove();

      // ── Screenshot ──
      document.getElementById("cn-snap").onclick = () => {
        const snapBtn = document.getElementById("cn-snap");
        const snapText = document.getElementById("cn-snap-text");
        const prevText = snapText.innerText;
        snapBtn.disabled = true;
        snapText.innerText = "...";
        dialog.style.opacity = "0";

        setTimeout(() => {
          chrome.runtime.sendMessage(
            { action: "capture_screenshot" },
            (response) => {
              dialog.style.opacity = "1";
              snapBtn.disabled = false;
              snapText.innerText = prevText;
              if (response && response.data) {
                currentImage = response.data;
                document.getElementById("cn-img-tag").src = currentImage;
                document.getElementById("cn-img-preview").style.display =
                  "block";
                document.getElementById("cn-snap").style.display = "none";
              }
            },
          );
        }, 200);
      };

      document.getElementById("cn-remove-img").onclick = () => {
        currentImage = null;
        document.getElementById("cn-img-preview").style.display = "none";
        document.getElementById("cn-snap").style.display = "flex";
      };

      // ── Save Logic ──
      document.getElementById("cn-save").onclick = () => {
        const title =
          document.getElementById("cn-title").value.trim() || "Untitled Note";
        const desc = document.getElementById("cn-desc").value.trim();

        // Read folder — treat empty string as "no folder selected"
        const folderEl = document.getElementById("cn-folder");
        const rawFolder = folderEl ? folderEl.value.trim() : "";
        const selectedFolder = rawFolder !== "" ? rawFolder : null;

        // Read general toggle
        const isGeneral =
          document.getElementById("cn-general-toggle")?.checked === true;

        // ── Domain fix ──
        // A note should NOT create a domain entry when:
        //   (a) a folder is explicitly selected, OR
        //   (b) the "Save as General Note" toggle is on
        let noteUrl;
        let noteDomain;

        if (isGeneral || selectedFolder !== null) {
          noteUrl = "folder://notes";
          noteDomain = "folder";
        } else {
          noteUrl = window.location.href;
          noteDomain = window.location.hostname;
        }

        chrome.runtime.sendMessage({
          action: "save_highlight_data",
          data: {
            id: Date.now().toString(),
            url: noteUrl,
            domain: noteDomain,
            title: title,
            content: desc,
            selection: selectionText.replace(/\s+/g, " ").trim(),
            timestamp: media.timestamp,
            image_data: currentImage || null,
            pinned: false,
            folder: selectedFolder,
          },
        });
        dialog.remove();
      };
    },
  });
}

// Trigger via Right-Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-highlight") {
    executeContextNoteFlow(tab, info.selectionText);
  }
});

// Trigger via Keyboard Shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === "save-highlight-shortcut") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) executeContextNoteFlow(tabs[0], null);
    });
  }
});

// Message Hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "save_highlight_data") {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      let notes = res[STORAGE_KEY] || [];
      if (typeof notes === "string") {
        try {
          notes = JSON.parse(notes);
        } catch {
          notes = [];
        }
      }
      (async () => {
        let note = request.data;
        try {
          const noteText =
            (note.title || "") +
            " " +
            (note.content || "") +
            " " +
            (note.selection || "");
          note.tags = [];
        } catch (e) {
          console.warn("Tag generation failed");
          note.tags = [];
        }

        notes.push(note);
        chrome.storage.local.set({ [STORAGE_KEY]: notes }, () => {
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(
              sender.tab.id,
              { action: "refresh_highlights" },
              () => {
                if (chrome.runtime.lastError) {
                  /* ignore */
                }
              },
            );
          }
        });
      })();
    });
  }

  if (request.action === "capture_screenshot") {
    chrome.tabs.captureVisibleTab(
      null,
      { format: "jpeg", quality: 60 },
      (dataUrl) => {
        sendResponse({ data: dataUrl });
      },
    );
    return true;
  }
});
