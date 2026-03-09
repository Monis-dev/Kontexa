const STORAGE_KEY = "context_notes_data";
const API_BASE = "http://127.0.0.1:5000";

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

// --- MODALS (Guide & Logout) ---
E($("infoBtn"), "click", () => {
  $("proceedLoginBtn").style.display = "none";
  $("guideModal").classList.add("on");
});
E($("closeGuideBtn"), "click", () => $("guideModal").classList.remove("on"));
E($("proceedLoginBtn"), "click", () => {
  $("guideModal").classList.remove("on");
  window.open(`${API_BASE}/login`, "_blank");
});

// Logout Actions
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

// --- CARD GENERATOR ---
const card = (n, dom) => {
  const title = n.title || "Untitled";
  const body = n.content || "";
  const sel = n.selection || n.text_selection || "";
  const searchStr = (title + " " + body).toLowerCase();

  const pinColor = n.pinned ? "#f59e0b" : "currentColor";
  const pinFill = n.pinned ? "#f59e0b" : "none";

  // --- FIX: Declare mediaHtml here ---
  let mediaHtml = "";

  // Badge for Timestamp
  if (n.timestamp) {
    mediaHtml += `<div style="font-size:11px; background:#eef2ff; color:#4f46e5; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:6px; margin-right:4px; border:1px solid #c7d2fe;">⏱️ ${n.timestamp}</div>`;
  }
  // Image Preview
  if (n.image_data) {
    mediaHtml += `<div style="margin-top:8px; border-radius:6px; overflow:hidden; border:1px solid #e2e8f0; cursor:pointer;" onclick="window.open('${n.image_data}')">
      <img src="${n.image_data}" style="width:100%; height:auto; display:block;" title="Click to view full size">
    </div>`;
  }

  return `<div class="card" data-id="${n.id}" data-t="${esc(searchStr)}">
    <div class="ca">
      <button class="act btn-pin" title="Pin Note" data-id="${n.id}">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:${pinColor};fill:${pinFill};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="act btn-edit" title="Edit" data-id="${n.id}">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="act del btn-delete" title="Delete" data-id="${n.id}">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    </div>
    <div class="ct">${esc(title)}</div>
    ${mediaHtml}
    ${sel ? `<div class="chi">"${esc(sel)}"</div>` : ""}
    ${body ? `<div class="cb">${esc(body)}</div>` : ""}
    <div class="ctags"><span class="tag">${esc(dom.slice(0, 22))}</span></div>
  </div>`;
};

// --- RENDER MAIN DASHBOARD ---
function render(groupedData) {
  $("skel")?.remove();
  const total = allNotesFlat.length;
  $("smeta").textContent =
    `${groupedData.length} page${groupedData.length !== 1 ? "s" : ""} · ${total} notes`;

  // Navigation Sidebar
  $("snav").innerHTML = groupedData.length
    ? groupedData
        .map((s, i) => {
          const shortName = s.domain.replace(/^www\./, "");
          return `<a class="na${i === 0 ? " on" : ""}" href="#s${i}" data-t="s${i}" title="${esc(s.url)}"><div class="dot"></div><span class="nd">${esc(shortName)}</span><span class="bdg">${s.notes.length}</span></a>`;
        })
        .join("")
    : '<p style="padding:12px;font-size:13px;color:var(--mut)">No sources yet.</p>';

  if (!groupedData.length) {
    $("main").innerHTML =
      `<div class="empty"><span>📝</span><h3>No notes yet</h3><p>Use the extension to highlight and save notes!</p></div>`;
    return;
  }

  $("main").innerHTML =
    `<div class="mh">Your Notes</div><div class="ms"><strong id="nc">${total}</strong> notes found</div><div class="nores" id="nores"><h3>No notes match "<span id="noresq"></span>"</h3></div>` +
    groupedData
      .map((site, i) => {
        const pinnedNotes = site.notes.filter((n) => n.pinned);
        const unpinnedNotes = site.notes.filter((n) => !n.pinned);

        let displayNotes = [];
        let hiddenCount = 0;

        if (pinnedNotes.length > 0) {
          displayNotes = pinnedNotes;
          hiddenCount = unpinnedNotes.length;
        } else {
          displayNotes = unpinnedNotes.slice(0, 2);
          hiddenCount = unpinnedNotes.length - 2;
        }

        let gridHTML = displayNotes.map((n) => card(n, site.domain)).join("");

        let niceUrl = site.url.replace(/^https?:\/\/(www\.)?/, "");
        niceUrl =
          niceUrl.length > 50 ? niceUrl.substring(0, 50) + "..." : niceUrl;

        return `
      <div class="sec" id="s${i}">
        <div class="sech">
          <div class="globe"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
          <span class="sdom" title="${esc(site.url)}" style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(niceUrl)}</span>
          <a href="${esc(site.url)}" target="_blank" rel="noopener" class="slink">Visit page ↗</a>
          <span class="scnt">${site.notes.length} note${site.notes.length !== 1 ? "s" : ""}</span>
        </div>
        
        <div class="grid">${gridHTML}</div>
        
        ${
          hiddenCount > 0
            ? `
          <div style="margin-top:10px;">
            <button class="btn-view-more" data-url="${site.url}">
              View ${hiddenCount} More Notes ➔
            </button>
          </div>`
            : ""
        }
          
        ${i < groupedData.length - 1 ? '<div class="divider"></div>' : ""}
      </div>`;
      })
      .join("");

  bindNav();
}

// --- GLOBAL EVENT DELEGATION ---
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".btn-edit");
  const delBtn = e.target.closest(".btn-delete");
  const pinBtn = e.target.closest(".btn-pin");
  const viewMoreBtn = e.target.closest(".btn-view-more");
  const logoutBtn = e.target.closest("#logoutBtn");

  if (viewMoreBtn) openSpecificPage(viewMoreBtn.dataset.url);

  if (logoutBtn) {
    $("synmenu").classList.remove("on");
    $("logoutModal").classList.add("on");
  }

  if (pinBtn) {
    const id = pinBtn.dataset.id;
    const idx = allNotesFlat.findIndex((n) => n.id === id);
    if (idx > -1) {
      allNotesFlat[idx].pinned = !allNotesFlat[idx].pinned;
      chrome.storage.local.set(
        { [STORAGE_KEY]: JSON.stringify(allNotesFlat) },
        async () => {
          if ($("singlePageView").style.display === "block")
            openSpecificPage(allNotesFlat[idx].url);
          else loadLocalUI();

          if (isLoggedIn) {
            try {
              await fetch(`${API_BASE}/api/notes/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pinned: allNotesFlat[idx].pinned }),
                credentials: "include",
              });
            } catch (err) {}
          }
        },
      );
    }
  }

  if (editBtn) {
    eId = editBtn.dataset.id;
    const cardEl = editBtn.closest(".card");
    $("etitle").value = cardEl.querySelector(".ct")
      ? cardEl.querySelector(".ct").textContent.trim()
      : "";
    $("eta").value = cardEl.querySelector(".cb")
      ? cardEl.querySelector(".cb").textContent.trim()
      : "";
    $("modal").classList.add("on");
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    if (!confirm("Delete this note?")) return;

    const url = allNotesFlat.find((n) => n.id === id)?.url;

    allNotesFlat = allNotesFlat.filter((n) => n.id !== id);
    chrome.storage.local.set(
      { [STORAGE_KEY]: JSON.stringify(allNotesFlat) },
      async () => {
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
          } catch (err) {}
        }
      },
    );
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

    chrome.storage.local.set(
      { [STORAGE_KEY]: JSON.stringify(allNotesFlat) },
      async () => {
        closeEdit();
        toast("Saved ✓");

        if ($("singlePageView").style.display === "block")
          openSpecificPage(url);
        else loadLocalUI();

        if (isLoggedIn) {
          try {
            await fetch(`${API_BASE}/api/notes/${savedId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: titleVal, content: contentVal }),
              credentials: "include",
            });
          } catch (err) {}
        }
      },
    );
  }
});

// Search and Nav
function bindNav() {
  const nas = document.querySelectorAll(".na[data-t]"),
    secs = document.querySelectorAll(".sec");
  nas.forEach((a) =>
    E(a, "click", (e) => {
      e.preventDefault();
      if ($("singlePageView").style.display === "block") {
        $("singlePageView").style.display = "none";
        $("main").style.display = "block";
      }
      $(a.dataset.t)?.scrollIntoView({ behavior: "smooth", block: "start" });
      nas.forEach((n) => n.classList.remove("on"));
      a.classList.add("on");
      if (mob()) closeS();
    }),
  );
}

E($("search"), "input", () => {
  if ($("singlePageView").style.display === "block") {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
  }
  const q = $("search").value.trim().toLowerCase();
  $("sc").classList.toggle("on", q.length > 0);
  let vis = 0;
  document.querySelectorAll(".sec").forEach((sec) => {
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

// --- GROUP BY URL ---
function loadLocalUI() {
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    allNotesFlat = res[STORAGE_KEY] ? JSON.parse(res[STORAGE_KEY]) : [];

    const grouped = {};
    allNotesFlat.forEach((n) => {
      if (!grouped[n.url])
        grouped[n.url] = { domain: n.domain, url: n.url, notes: [] };
      grouped[n.url].notes.push(n);
    });

    render(Object.values(grouped));
  });
}

// Listen for updates from the popup/extension so the dashboard auto-refreshes
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes[STORAGE_KEY]) {
      // Don't refresh if the user is currently editing a note or looking at a specific page
      if (
        !$("modal").classList.contains("on") &&
        $("singlePageView").style.display !== "block"
      ) {
        loadLocalUI();
      }
    }
  });
}

// Paywall Actions
// Paywall Logout Action (SAFE VERSION - NEVER DELETES LOCAL NOTES)
E($("paywallLogoutBtn"), "click", async () => {
  const btn = $("paywallLogoutBtn");
  btn.textContent = "Disconnecting...";
  btn.disabled = true;

  try {
    // 1. Tell the server to kill the session (if server is online)
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {
    console.warn("Server offline, logging out locally.");
  }

  // 2. Clear auth state variable, but DO NOT touch chrome.storage
  isLoggedIn = false;
  
  // 3. Hide the Paywall
  $("paywallModal").classList.remove("on");
  
  // 4. Update the UI to reflect Local Mode
  $("uStatus").textContent = "Local Mode Only";
  
  const logoutBtnEl = $("logoutBtn");
  if (logoutBtnEl) {
    // Change the "Logout" button back to the "Login" button
    logoutBtnEl.outerHTML = `<div class="sitem" id="loginBtn">🔑 Sync via Google</div>`;
    
    // Re-attach the listener for the new login button
    E($("loginBtn"), "click", () => {
      $("synmenu").classList.remove("on");
      $("proceedLoginBtn").style.display = "block";
      $("guideModal").classList.add("on");
    });
  }

  // 5. Notify user and reset button
  toast("Disconnected. Your notes are safe locally.");
  btn.textContent = "No thanks, Log me out";
  btn.disabled = false;
});

E($("upgradeBtn"), "click", async () => {
  // Simulate Payment Process
  const btn = $("upgradeBtn");
  btn.textContent = "Processing Payment...";

  try {
    const res = await fetch(`${API_BASE}/api/upgrade`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      btn.textContent = "Success! Reloading...";
      setTimeout(() => window.location.reload(), 1500);
    }
  } catch (e) {
    btn.textContent = "Payment Failed";
  }
});

// SYNC ENGINE & LOGOUT
let isCheckingAuth = false;
let initialLoadDone = false; // Prevents reloading the DOM repeatedly on failures

async function checkAuthAndSync() {
  if (isCheckingAuth) return;
  isCheckingAuth = true;

  try {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
    if (res.ok) {
      const user = await res.json();
      isLoggedIn = true;
      const planName = user.is_pro ? "Pro Plan" : "Free Plan";
      const statusColor = user.is_pro ? "#4f46e5" : "#64748b";
      $("uStatus").innerHTML =
        `<span style="color:${statusColor}; font-weight:bold;">${planName}</span> • ${user.email}`;
      if ($("loginBtn"))
        $("loginBtn").outerHTML =
          `<div class="sitem danger" id="logoutBtn">🚪 Logout</div>`;

      // 🛑 PAYWALL CHECK 🛑
      if (!user.is_pro) {
        if ($("paywallModal")) $("paywallModal").classList.add("on");
        loadLocalUI();
        return;
      }

      chrome.storage.local.get(STORAGE_KEY, async (localRes) => {
        const localNotes = localRes[STORAGE_KEY]
          ? JSON.parse(localRes[STORAGE_KEY])
          : [];
        if (localNotes.length > 0) {
          try {
            await fetch(`${API_BASE}/api/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(localNotes),
              credentials: "include",
            });
          } catch (e) {}
        }
        const cloudRes = await fetch(`${API_BASE}/api/notes`, {
          credentials: "include",
        });
        if (cloudRes.ok) {
          const cloudData = await cloudRes.json();
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
              });
            }),
          );
          chrome.storage.local.set(
            { [STORAGE_KEY]: JSON.stringify(flattenedCloudNotes) },
            loadLocalUI,
          );
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
window.addEventListener("focus", () => {
  if (!isLoggedIn) checkAuthAndSync();
});
window.onload = checkAuthAndSync;

// --- AI FEATURES ---
function openSpecificPage(targetUrl) {
  $("main").style.display = "none";
  $("singlePageView").style.display = "block";

  const siteNotes = allNotesFlat.filter((n) => n.url === targetUrl);
  siteNotes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const cleanUrl = targetUrl.replace(/^https?:\/\/(www\.)?/, "");

  // 1. Build the HTML
  $("singlePageView").innerHTML = `
    <button class="back-btn" id="backToDash">← Back to Dashboard</button>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
        <div class="mh" style="word-break: break-all;">${esc(cleanUrl)}</div>
        <button class="btn pri" id="chatWithAiBtn">💬 Chat with AI</button>
    </div>
    <div class="grid wrap">
      ${siteNotes.map((n) => card(n, siteNotes[0].domain)).join("")}
    </div>
  `;

  // 2. Attach listeners AFTER the HTML is injected
  E($("backToDash"), "click", () => {
    $("singlePageView").style.display = "none";
    $("main").style.display = "block";
    loadLocalUI();
  });

  E($("chatWithAiBtn"), "click", () => {
    $("aiModal").dataset.context = JSON.stringify(siteNotes);
    $("aiModal").classList.add("on");
  });
}

//AI logic
E($("aiBtn"), "click", () => {
  // If general chat, pass all notes or empty context
  $("aiModal").dataset.context = JSON.stringify(allNotesFlat);
  $("aiModal").classList.add("on");
});

E($("closeAiBtn"), "click", () => $("aiModal").classList.remove("on"));

// Replace your existing E($("aiSendBtn"), "click", ...) with this:

let isAiProcessing = false; // Add this global flag near the top of your dashboard.js

// AI Send Function Logic
async function handleAiSubmit() {
  if (isAiProcessing) return; // Prevent spamming

  const input = $("aiInput");
  const sendBtn = $("aiSendBtn");
  const q = input.value.trim();

  if (!q || q === "Thinking..." || q === "Checking permissions...") return;

  isAiProcessing = true;
  sendBtn.disabled = true;
  input.disabled = true;

  const chatBox = $("aiChatBox");

  // 1. Temporarily show user message in chat
  const tempMsgId = "msg-" + Date.now();
  chatBox.innerHTML += `<div class="chat-msg chat-user" id="${tempMsgId}">${esc(q)}</div>`;
  chatBox.scrollTop = chatBox.scrollHeight;

  // Clear input visually while processing
  input.value = "Checking permissions...";

  // 2. STRICT GATING: (Logged In -> Pro -> Has API Key)
  const hasAccess = await ProMode.canAccessAI();

  if (!hasAccess) {
    // Access Denied: Remove the temporary message so it doesn't stay stuck
    const tempMsg = document.getElementById(tempMsgId);
    if (tempMsg) tempMsg.remove();

    // Reset UI
    input.value = q; // Put their question back so they don't lose it
    input.disabled = false;
    sendBtn.disabled = false;
    isAiProcessing = false;
    return; // Stop execution
  }

  // 3. Access Granted: Proceed with AI Call
  input.value = "Thinking...";

  try {
    const contextNotes = JSON.parse($("aiModal").dataset.context || "[]");

    // Call client-side AI Service directly
    const answer = await AIService.chat(q, contextNotes);

    // Show the AI's response
    chatBox.innerHTML += `<div class="chat-msg chat-ai">${esc(answer).replace(/\n/g, "<br>")}</div>`;
  } catch (e) {
    console.error(e);
    chatBox.innerHTML += `<div class="chat-msg chat-ai">Error: Could not connect to AI. Please check your network or API key.</div>`;
  }

  // 4. Reset UI
  input.value = "";
  input.disabled = false;
  sendBtn.disabled = false;
  isAiProcessing = false;
  chatBox.scrollTop = chatBox.scrollHeight;

  // Focus back on input for the next question
  setTimeout(() => input.focus(), 10);
}

// Attach to Send Button
E($("aiSendBtn"), "click", handleAiSubmit);

// Attach to Enter Key on the Input field
E($("aiInput"), "keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    // Prevent firing on Shift+Enter if you ever change to a textarea
    e.preventDefault(); // Stop default form submission or newlines
    handleAiSubmit();
  }
});
//API key logic
E($("closeApiSettingsBtn"), "click", () =>
  $("apiSettingsModal").classList.remove("on"),
);

// Open API Settings
E($("apiSettingsBtn"), "click", () => {
  chrome.storage.local.get(["gemini_key"], (res) => {
    $("apiKeyInput").value = res.gemini_key || "";
    $("apiSettingsModal").classList.add("on");
  });
});

// Save API Settings
E($("saveApiKey"), "click", () => {
  const key = $("apiKeyInput").value.trim();
  chrome.storage.local.set({ gemini_key: key }, () => {
    toast("API Key saved securely.");
    $("apiSettingsModal").classList.remove("on");
  });
});

// GATING LOGIC
async function executeProFeature(callback) {
  const res = await chrome.storage.local.get(["gemini_key"]);
  const hasKey = !!res.gemini_key;

  // Logic: If user is Pro OR has their own key, allow it.
  if (isLoggedIn || hasKey) {
    callback();
  } else {
    toast("Please set your Gemini API Key in Settings or Upgrade to Pro");
    // Open Settings modal instead
    $("apiSettingsModal").classList.add("on");
  }
}

// ── THEME ENGINE (Moved from HTML to JS for Extensions) ──
const THEME_KEY = "cn_theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".palette-swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.theme === theme);
  });

  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.set({ [THEME_KEY]: theme });
  }
}

// Load saved theme initially
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get([THEME_KEY], (res) => {
    applyTheme(res[THEME_KEY] || "indigo");
  });
} else {
  applyTheme("indigo");
}

// Theme Event Listeners
E($("themeBtn"), "click", (e) => {
  e.stopPropagation();
  $("themePanel").classList.toggle("on");
});

document.querySelectorAll(".palette-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    applyTheme(swatch.dataset.theme);
    $("themePanel").classList.remove("on");
  });
});

document.addEventListener("click", (e) => {
  if (
    $("themePanel") &&
    !$("themePanel").contains(e.target) &&
    e.target !== $("themeBtn")
  ) {
    $("themePanel").classList.remove("on");
  }
});
