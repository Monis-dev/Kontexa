// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const API = "https://context-notes.onrender.com";
const NKEY = "cn_notes_v3";
const KKEY = "cn_keys";
const TKEY = "cn_theme";
const UKEY = "cn_user";

// ═══════════════════════════════════════════════════════════════════════════
//  THEMES
// ═══════════════════════════════════════════════════════════════════════════
const TH = {
  nova: {
    l: "Nova",
    e: "✦",
    s: "linear-gradient(135deg,#6366f1,#4f46e5)",
    f: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
    fv: "'Plus Jakarta Sans',sans-serif",
    bg: "#f6f7f9",
  },
  midnight: {
    l: "Midnight",
    e: "🌙",
    s: "linear-gradient(135deg,#1e293b,#0f172a)",
    f: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    fv: "'Inter',sans-serif",
    bg: "#080f1a",
  },
  aurora: {
    l: "Aurora",
    e: "🌌",
    s: "linear-gradient(135deg,#7c3aed,#db2777)",
    f: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap",
    fv: "'Outfit',sans-serif",
    bg: "#0d0d1a",
  },
  forest: {
    l: "Forest",
    e: "🌿",
    s: "linear-gradient(135deg,#4ade80,#16a34a)",
    f: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&display=swap",
    fv: "'Nunito',sans-serif",
    bg: "#f0faf4",
  },
  parchment: {
    l: "Parchment",
    e: "📜",
    s: "linear-gradient(135deg,#d97706,#92400e)",
    f: "https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap",
    fv: "'Crimson Pro',serif",
    bg: "#fdf6e3",
  },
  slate: {
    l: "Slate",
    e: "◻",
    s: "linear-gradient(135deg,#64748b,#1e293b)",
    f: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap",
    fv: "'DM Sans',sans-serif",
    bg: "#f8fafc",
  },
  sunset: {
    l: "Sunset",
    e: "🌅",
    s: "linear-gradient(135deg,#f97316,#e11d48)",
    f: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap",
    fv: "'Sora',sans-serif",
    bg: "#fff7f3",
  },
  arctic: {
    l: "Arctic",
    e: "❄",
    s: "linear-gradient(135deg,#7dd3fc,#0ea5e9)",
    f: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap",
    fv: "'Figtree',sans-serif",
    bg: "#f0f9ff",
  },
};

let curTheme = localStorage.getItem(TKEY) || "nova";

function applyTheme(k) {
  if (!TH[k]) return;
  curTheme = k;
  const t = TH[k];
  document.documentElement.setAttribute("data-theme", k);
  document.documentElement.style.setProperty("--ff", t.fv);
  document.body.style.fontFamily = t.fv;
  document.getElementById("themeFont").href = t.f;
  document.getElementById("metaThemeColor").content = t.bg;
  localStorage.setItem(TKEY, k);
  renderTGrid();
}

function renderTGrid() {
  const g = document.getElementById("tgrid");
  if (!g) return;
  g.innerHTML = Object.entries(TH)
    .map(
      ([k, t]) =>
        `<div class="tsw${k === curTheme ? " on" : ""}" onclick="applyTheme('${k}');closeTh()">
      <div class="tcirc" style="background:${t.s}"></div>
      <span class="tlbl">${t.e} ${t.l}</span>
    </div>`,
    )
    .join("");
}

applyTheme(curTheme);

// ═══════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════
let notes = [];
let curUser = null;
let curView = "notes";
let prevView = "notes";
let curProv = "gemini";
let aiRunning = false;
let toastT;

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function toast(m, ms = 2500) {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), ms);
}

function byDomain(ns) {
  const m = {};
  ns.forEach((n) => {
    if (!m[n.url]) m[n.url] = { url: n.url, domain: n.domain, notes: [] };
    m[n.url].notes.push(n);
  });
  return Object.values(m);
}

function byFolder(ns) {
  const m = {};
  ns.forEach((n) => {
    if (n.folder) {
      if (!m[n.folder]) m[n.folder] = { name: n.folder, notes: [] };
      m[n.folder].notes.push(n);
    }
  });
  return Object.values(m);
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════
async function checkAuth() {
  const cached = localStorage.getItem(UKEY);
  if (cached) {
    try {
      curUser = JSON.parse(cached);
    } catch (e) {}
  }

  try {
    const r = await fetch(`${API}/api/me`, { credentials: "include" });
    if (r.ok) {
      curUser = await r.json();
      localStorage.setItem(UKEY, JSON.stringify(curUser));
    } else {
      curUser = null;
      localStorage.removeItem(UKEY);
      localStorage.removeItem(NKEY);
      notes = [];
    }
  } catch (e) {
    // offline — keep cached state
  }

  loadNotes();
}

// ═══════════════════════════════════════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════════════════════════════════════
async function loadNotes() {
  if (!curUser) {
    renderLoggedOut();
    return;
  }
  if (!curUser.is_pro) {
    renderFreeUser();
    return;
  }

  const raw = localStorage.getItem(NKEY);
  if (raw) {
    try {
      notes = JSON.parse(raw);
      renderHome();
      renderDrw();
    } catch (e) {}
  } else {
    $("homeCnt").innerHTML = '<div class="spin"></div>';
  }

  try {
    const r = await fetch(`${API}/api/notes`, { credentials: "include" });
    if (r.ok) {
      const sites = await r.json();
      notes = [];
      sites.forEach((s) =>
        (s.notes || []).forEach((n) =>
          notes.push({
            id: n.id,
            url: s.url,
            domain: s.domain,
            title: n.title || "Untitled",
            content: n.content || "",
            selection: n.selection || "",
            pinned: !!n.pinned,
            folder: n.folder || null,
            timestamp: n.timestamp || null,
            image_data: n.image_data || null,
            tags: n.tags || [],
          }),
        ),
      );
      localStorage.setItem(NKEY, JSON.stringify(notes));
      renderHome();
      renderDrw();
    } else if (r.status === 403) {
      curUser.is_pro = false;
      localStorage.setItem(UKEY, JSON.stringify(curUser));
      renderFreeUser();
    } else if (r.status === 401) {
      curUser = null;
      localStorage.removeItem(UKEY);
      renderLoggedOut();
    }
  } catch (e) {
    if (!raw) {
      $("homeCnt").innerHTML = `<div class="empty">
        <div class="empty-ico">📡</div>
        <div class="empty-ttl">Offline</div>
        <div class="empty-sub">Check your connection and try again.</div>
      </div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH SCREENS
// ═══════════════════════════════════════════════════════════════════════════
function renderLoggedOut() {
  $("homeCnt").innerHTML = `
    <div class="auth">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" style="width:34px;height:34px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round">
          <path d="M9 12h6M9 16h6M7 8h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/>
        </svg>
      </div>
      <div class="auth-ttl">Welcome to ContextNote</div>
      <div class="auth-sub">Sign in with Google to access your synced notes from any device.</div>
      <a class="auth-btn" href="${API}/login?mobile=1" target="_blank" rel="noopener" onclick="startAuthPoll()">
        <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round">
          <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20"/>
        </svg>
        Continue with Google
      </a>
      <div class="auth-note">A Google sign-in page will open. After signing in, return to this app — your notes load automatically.</div>
    </div>`;
}

function renderFreeUser() {
  $("homeCnt").innerHTML = `
    <div class="auth">
      <div class="auth-logo" style="font-size:28px;background:linear-gradient(135deg,#f59e0b,#d97706)">💎</div>
      <div class="auth-ttl">Pro Plan Required</div>
      <div class="auth-sub">Accessing notes on mobile requires <strong>ContextNote Pro</strong>. Upgrade once and sync everywhere.</div>
      <a class="auth-btn" href="${API}/pricing" target="_blank" rel="noopener">Upgrade to Pro →</a>
      <button class="auth-btn sec" onclick="checkAuth()">↻ I've already upgraded</button>
      <div class="auth-note">After upgrading, tap the button above to reload.</div>
    </div>`;
}

// Poll /api/me every 5 s after the Google tab opens (max 24 attempts = 2 min)
let pollT,
  pollN = 0;
function startAuthPoll() {
  clearInterval(pollT);
  pollN = 0;
  pollT = setInterval(async () => {
    if (++pollN > 24) {
      clearInterval(pollT);
      return;
    }
    try {
      const r = await fetch(`${API}/api/me`, { credentials: "include" });
      if (r.ok) {
        clearInterval(pollT);
        curUser = await r.json();
        localStorage.setItem(UKEY, JSON.stringify(curUser));
        toast("✓ Signed in!");
        loadNotes();
      }
    } catch (e) {}
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER HOME
// ═══════════════════════════════════════════════════════════════════════════
function renderHome(data) {
  data = data || notes;
  if (!data.length) {
    $("homeCnt").innerHTML = `<div class="empty">
      <div class="empty-ico">📝</div>
      <div class="empty-ttl">No notes yet</div>
      <div class="empty-sub">Use the ContextNote browser extension to highlight text on any website, then sync to see them here.</div>
    </div>`;
    return;
  }

  const doms = byDomain(data);
  const fdrs = byFolder(data);
  const tot = data.length;

  let h = `<div class="stats">
    <div class="chip"><div class="chip-dot"></div><strong>${tot}</strong>&nbsp;notes</div>
    <div class="chip"><div class="chip-dot"></div><strong>${doms.length}</strong>&nbsp;sources</div>
    ${fdrs.length ? `<div class="chip"><div class="chip-dot"></div><strong>${fdrs.length}</strong>&nbsp;folders</div>` : ""}
  </div>`;

  const all = [
    ...fdrs.map((f) => ({ ...f, iF: true })),
    ...doms.map((d) => ({ ...d, iF: false })),
  ];

  all.forEach((g) => {
    const nm = g.iF
      ? g.name
      : g.domain || g.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const srt = [...g.notes].sort(
      (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0),
    );
    const pre = srt.slice(0, 2);
    const ex = srt.length - 2;
    const enc = encodeURIComponent(g.iF ? g.name : g.url);
    const clk = g.iF ? `navFdr('${enc}')` : `navPg('${enc}')`;

    h += `<div class="grp">
      <div class="grp-hd" onclick="${clk}">
        <div class="grp-ico${g.iF ? " fdr" : ""}">
          ${
            g.iF
              ? '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
              : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>'
          }
        </div>
        <div class="grp-inf">
          <div class="grp-name">${esc(nm)}</div>
          <div class="grp-sub">${srt.length} note${srt.length !== 1 ? "s" : ""}</div>
        </div>
        <span class="grp-cnt">${srt.length}</span>
      </div>
      <div class="clist">${pre.map((n) => nCard(n, nm)).join("")}</div>
      ${ex > 0 ? `<button class="va" onclick="${clk}">View all ${srt.length} notes →</button>` : ""}
    </div>`;
  });

  $("homeCnt").innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NOTE CARD
// ═══════════════════════════════════════════════════════════════════════════
function nCard(n, dl) {
  const hs = n.selection?.trim();
  const hb = n.content?.trim();
  return `<div class="nc${n.pinned ? " pin" : ""}" onclick="openNote('${esc(n.id)}')">
    <div class="nc-t">${esc(n.title || "Untitled")}</div>
    ${hs ? `<div class="nc-s">"${esc(n.selection.slice(0, 110))}${n.selection.length > 110 ? "…" : ""}"</div>` : ""}
    ${hb ? `<div class="nc-b">${esc(n.content)}</div>` : ""}
    ${n.image_data ? `<img class="nc-img" src="${n.image_data}" loading="lazy"/>` : ""}
    <div class="nc-ft">
      ${n.pinned ? '<span class="tag p">⭐ Pinned</span>' : ""}
      ${n.folder ? `<span class="tag">📁 ${esc(n.folder)}</span>` : ""}
      ${n.timestamp ? `<span class="tstag">⏱ ${esc(n.timestamp)}</span>` : ""}
      <span class="tag d">${esc((dl || "").slice(0, 22))}</span>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function showView(v) {
  ["homeView", "pageView", "noteView", "settingsView"].forEach((id) =>
    $(id)?.classList.toggle("active", id === v + "View"),
  );
  curView = v;
}

function navPg(enc) {
  const url = decodeURIComponent(enc);
  prevView = curView;
  const ns = notes
    .filter((n) => n.url === url)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const dom =
    ns[0]?.domain || url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  renderPgView(ns, dom, url, false);
  showView("page");
  $("mainScr").scrollTop = 0;
}

function navFdr(enc) {
  const nm = decodeURIComponent(enc);
  prevView = curView;
  const ns = notes
    .filter((n) => n.folder === nm)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  renderPgView(ns, nm, null, true);
  showView("page");
  $("mainScr").scrollTop = 0;
}

function renderPgView(ns, ttl, url, iF) {
  let h = `<div class="phd">
    <div class="phd-ico">
      ${
        iF
          ? '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
          : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>'
      }
    </div>
    <div class="phd-inf">
      <div class="phd-ttl">${esc(ttl)}</div>
      <div class="phd-meta">${ns.length} note${ns.length !== 1 ? "s" : ""}</div>
    </div>
  </div>`;

  if (url)
    h += `<a class="purl" href="${esc(url)}" target="_blank" rel="noopener">↗ ${esc(url)}</a>`;

  h += ns.length
    ? `<div class="clist">${ns.map((n) => nCard(n, ttl)).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">🗂️</div><div class="empty-ttl">Empty</div><div class="empty-sub">No notes here yet.</div></div>`;

  $("pageCnt").innerHTML = h;
}

function openNote(id) {
  const n = notes.find((x) => String(x.id) === String(id));
  if (!n) return;
  prevView = curView;

  let h = "";
  if (n.domain)
    h += `<span class="nd-dom">
    <svg viewBox="0 0 24 24" style="width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:2"><circle cx="12" cy="12" r="10"/></svg>
    ${esc(n.domain)}
  </span>`;

  h += `<div class="nd-ttl">${esc(n.title || "Untitled")}</div>`;

  const mt = [];
  if (n.pinned) mt.push('<span class="tag p">⭐ Pinned</span>');
  if (n.folder) mt.push(`<span class="tag">📁 ${esc(n.folder)}</span>`);
  if (n.timestamp) mt.push(`<span class="tstag">⏱ ${esc(n.timestamp)}</span>`);
  if (mt.length) h += `<div class="nd-meta">${mt.join("")}</div>`;

  if (n.selection?.trim())
    h += `<div class="nd-sel">"${esc(n.selection)}"</div>`;
  if (n.content?.trim()) h += `<div class="nd-body">${esc(n.content)}</div>`;
  if (n.image_data)
    h += `<img class="nd-img" src="${n.image_data}" loading="lazy"/>`;

  if (n.url)
    h += `<div class="nd-src">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>
    <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.url)}</a>
  </div>`;

  $("noteDet").innerHTML = h;
  showView("note");
  $("mainScr").scrollTop = 0;
}

$("backBtn").onclick = () => {
  showView(
    prevView === "page"
      ? "page"
      : prevView === "settings"
        ? "settings"
        : "home",
  );
  $("mainScr").scrollTop = 0;
};
$("noteBackBtn").onclick = () => {
  showView(prevView === "page" ? "page" : "home");
  $("mainScr").scrollTop = 0;
};

// ═══════════════════════════════════════════════════════════════════════════
//  TAB SWITCH
// ═══════════════════════════════════════════════════════════════════════════
function switchTab(t) {
  document.querySelectorAll(".nt").forEach((x) => x.classList.remove("on"));
  $(`tab-${t}`).classList.add("on");
  if (t === "notes") showView("home");
  if (t === "settings") {
    showView("settings");
    renderSettings();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DRAWER
// ═══════════════════════════════════════════════════════════════════════════
$("menuBtn").onclick = openDrw;

function openDrw() {
  $("drw").classList.add("on");
  $("drwO").classList.add("on");
  renderDrw();
}
function closeDrw() {
  $("drw").classList.remove("on");
  $("drwO").classList.remove("on");
}

function renderDrw() {
  const doms = byDomain(notes);
  const fdrs = byFolder(notes);

  let h = `<div class="drw-sec"><div class="drw-lbl">Sources (${doms.length})</div>`;
  if (!doms.length)
    h += `<div style="padding:10px 16px;font-size:13px;color:var(--mut)">No sources</div>`;
  doms.forEach((g) => {
    const nm =
      g.domain || g.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    h += `<div class="drw-it" onclick="closeDrw();navPg('${encodeURIComponent(g.url)}')">
      <div class="drw-dot"></div>
      <span class="drw-nm">${esc(nm)}</span>
      <span class="drw-bdg">${g.notes.length}</span>
    </div>`;
  });
  h += "</div>";

  if (fdrs.length) {
    h += `<div class="drw-sec"><div class="drw-lbl">Folders (${fdrs.length})</div>`;
    fdrs.forEach((f) => {
      h += `<div class="drw-it" onclick="closeDrw();navFdr('${encodeURIComponent(f.name)}')">
        <div class="drw-fdot"></div>
        <span class="drw-nm">📁 ${esc(f.name)}</span>
        <span class="drw-bdg">${f.notes.length}</span>
      </div>`;
    });
    h += "</div>";
  }

  $("drwBdy").innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════════════════════
$("searchIn").addEventListener("input", () => {
  const q = $("searchIn").value.trim().toLowerCase();
  $("searchClr").classList.toggle("on", q.length > 0);

  if (!q) {
    if (curView === "home") renderHome();
    return;
  }

  if (curView !== "home") {
    switchTab("notes");
    document.querySelectorAll(".nt").forEach((t) => t.classList.remove("on"));
    $("tab-notes").classList.add("on");
  }

  const hits = notes.filter(
    (n) =>
      (n.title || "").toLowerCase().includes(q) ||
      (n.content || "").toLowerCase().includes(q) ||
      (n.selection || "").toLowerCase().includes(q) ||
      (n.domain || "").toLowerCase().includes(q),
  );

  $("homeCnt").innerHTML = hits.length
    ? `<div class="stats"><div class="chip"><div class="chip-dot"></div><strong>${hits.length}</strong>&nbsp;result${hits.length !== 1 ? "s" : ""} for "${esc(q)}"</div></div>
       <div class="clist">${hits.map((n) => nCard(n, n.domain || "")).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">🔍</div><div class="empty-ttl">No results</div><div class="empty-sub">Nothing matched "<strong>${esc(q)}</strong>"</div></div>`;
});

$("searchClr").onclick = () => {
  $("searchIn").value = "";
  $("searchClr").classList.remove("on");
  renderHome();
};

// ═══════════════════════════════════════════════════════════════════════════
//  AI MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openAI() {
  if (!curUser) {
    toast("Sign in first");
    return;
  }
  $("aiMo").classList.add("on");
  setTimeout(() => $("cin").focus(), 300);
}
function closeAI() {
  $("aiMo").classList.remove("on");
}

$("cin").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
});
$("csnd").onclick = sendMsg;
$("cin").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 88) + "px";
});

// ═══════════════════════════════════════════════════════════════════════════
//  SEND MESSAGE — uses AIAgent (ai_agent.js must be loaded first)
// ═══════════════════════════════════════════════════════════════════════════
async function sendMsg() {
  if (aiRunning) return;
  const q = $("cin").value.trim();
  if (!q) return;

  // Check key before anything else
  if (!AIAgent.getKey()) {
    toast("⚠️ Set a Gemini API key in Settings");
    closeAI();
    switchTab("settings");
    return;
  }

  addMsg("u", q);
  $("cin").value = "";
  $("cin").style.height = "auto";
  aiRunning = true;

  // Thinking indicator
  const tid = "t" + Date.now();
  $("cbox").insertAdjacentHTML(
    "beforeend",
    `<div class="cm a dots" id="${tid}"><span></span><span></span><span></span></div>`,
  );
  $("cbox").scrollTop = $("cbox").scrollHeight;

  try {
    const result = await AIAgent.chat(q, notes);
    $(tid)?.remove();

    // Render markdown answer in its own bubble
    const bubble = document.createElement("div");
    bubble.className = "cm a";
    bubble.innerHTML = AIAgent.renderMarkdown(result.answer);
    $("cbox").appendChild(bubble);
    $("cbox").scrollTop = $("cbox").scrollHeight;

    // Merge tags back into local note cache
    if (result.tags && Object.keys(result.tags).length > 0) {
      notes = notes.map((n) => {
        const newTags = result.tags[n.id];
        if (newTags?.length) {
          const merged = [...new Set([...(n.tags || []), ...newTags])];
          return { ...n, tags: merged };
        }
        return n;
      });
      localStorage.setItem(NKEY, JSON.stringify(notes));
    }
  } catch (e) {
    $(tid)?.remove();
    const msg =
      e.message === "NO_KEY"
        ? "⚠️ No Gemini API key set. Go to Settings → API Key."
        : e.message === "RATE_LIMIT"
          ? "⚠️ Rate limit hit. Wait a moment and try again."
          : `⚠️ Error: ${e.message}`;
    addMsg("a", msg);
  }

  aiRunning = false;
}

function addMsg(role, txt) {
  const d = document.createElement("div");
  d.className = `cm ${role}`;
  d.textContent = txt;
  $("cbox").appendChild(d);
  $("cbox").scrollTop = $("cbox").scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════════════
//  API KEY MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openAPI() {
  const ks = JSON.parse(localStorage.getItem(KKEY) || "{}");
  $("apiKIn").value = ks[curProv] || "";
  $("apiMo").classList.add("on");
}
function closeAPI() {
  $("apiMo").classList.remove("on");
}

function pickP(el) {
  document.querySelectorAll(".ptab").forEach((t) => t.classList.remove("on"));
  el.classList.add("on");
  curProv = el.dataset.p;
  const ks = JSON.parse(localStorage.getItem(KKEY) || "{}");
  $("apiKIn").value = ks[curProv] || "";
}

function saveKey() {
  const k = $("apiKIn").value.trim();
  const ks = JSON.parse(localStorage.getItem(KKEY) || "{}");
  if (k) ks[curProv] = k;
  else delete ks[curProv];
  localStorage.setItem(KKEY, JSON.stringify(ks));
  closeAPI();
  toast("✓ API key saved");
  renderSettings();
}

// ═══════════════════════════════════════════════════════════════════════════
//  THEME MODAL
// ═══════════════════════════════════════════════════════════════════════════
$("themeBtn").onclick = () => {
  renderTGrid();
  $("themeMo").classList.add("on");
};
function closeTh() {
  $("themeMo").classList.remove("on");
}

// ═══════════════════════════════════════════════════════════════════════════
//  ACCOUNT MODAL
// ═══════════════════════════════════════════════════════════════════════════
$("acctBtn").onclick = () => {
  renderAcct();
  $("acctMo").classList.add("on");
};
function closeAcct() {
  $("acctMo").classList.remove("on");
}

function renderAcct() {
  if (!curUser) {
    $("acctPnl").innerHTML = `
      <div style="text-align:center;font-size:36px;padding:8px 0">👤</div>
      <div class="ae" style="color:var(--mut)">Not signed in</div>
      <a class="abtn pri" href="${API}/login?mobile=1" target="_blank" rel="noopener"
         onclick="startAuthPoll();closeAcct()"
         style="display:flex;align-items:center;justify-content:center;text-decoration:none">
        Sign in with Google
      </a>`;
    return;
  }
  $("acctPnl").innerHTML = `
    <div class="av">${curUser.email[0].toUpperCase()}</div>
    <div class="ae">${esc(curUser.email)}</div>
    <div class="apl">
      ${
        curUser.is_pro
          ? '<span class="pro-badge">✦ Pro Plan</span>'
          : `<span style="font-size:12px;color:var(--mut)">Free Plan — <a href="${API}/pricing" target="_blank" style="color:var(--acc);text-decoration:none">Upgrade →</a></span>`
      }
    </div>
    <div class="adiv"></div>
    <button class="abtn" onclick="syncNow();closeAcct()">↻ Sync Notes</button>
    <button class="abtn dng" onclick="doLogout()">Sign Out</button>`;
}

async function doLogout() {
  closeAcct();
  try {
    await fetch(`${API}/api/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {}
  curUser = null;
  notes = [];
  localStorage.removeItem(UKEY);
  localStorage.removeItem(NKEY);
  renderLoggedOut();
  renderDrw();
  toast("Signed out");
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function renderSettings() {
  const ks = JSON.parse(localStorage.getItem(KKEY) || "{}");
  const hasK = !!(ks.gemini || ks.openai || ks.claude);
  const th = TH[curTheme];

  $("settingsCnt").innerHTML = `
    <div class="sw-ttl">Settings</div>

    <div class="sl">Account</div>
    <div class="sc2" style="margin-bottom:20px">
      <div class="sr" onclick="renderAcct();$('acctMo').classList.add('on')">
        <div class="si2">👤</div>
        <div class="si2-inf">
          <div class="si2-t">${curUser ? esc(curUser.email) : "Not signed in"}</div>
          <div class="si2-s">${curUser ? (curUser.is_pro ? '<span class="sdot ok"></span>Pro Plan' : "Free Plan — tap to upgrade") : "Tap to sign in"}</div>
        </div>
        <span class="schev">›</span>
      </div>
    </div>

    <div class="sl">Appearance</div>
    <div class="sc2" style="margin-bottom:20px">
      <div class="sr" onclick="renderTGrid();$('themeMo').classList.add('on')">
        <div class="si2">🎨</div>
        <div class="si2-inf">
          <div class="si2-t">Color Theme</div>
          <div class="si2-s">${th.e} ${th.l}</div>
        </div>
        <span class="schev">›</span>
      </div>
    </div>

    <div class="sl">AI</div>
    <div class="sc2" style="margin-bottom:20px">
      <div class="sr" onclick="openAPI()">
        <div class="si2">🔑</div>
        <div class="si2-inf">
          <div class="si2-t">API Key</div>
          <div class="si2-s">${hasK ? '<span class="sdot ok"></span>Key saved' : "No key — AI disabled"}</div>
        </div>
        <span class="schev">›</span>
      </div>
      <div class="sr" onclick="openAI()">
        <div class="si2">✦</div>
        <div class="si2-inf">
          <div class="si2-t">Ask AI</div>
          <div class="si2-s">Chat about your notes</div>
        </div>
        <span class="schev">›</span>
      </div>
    </div>

    <div class="sl">Data</div>
    <div class="sc2">
      <div class="sr" onclick="syncNow()">
        <div class="si2">↻</div>
        <div class="si2-inf">
          <div class="si2-t">Sync Notes</div>
          <div class="si2-s">${notes.length} notes cached locally</div>
        </div>
        <span class="schev">›</span>
      </div>
      <div class="sr" onclick="clearCache()">
        <div class="si2">🗑️</div>
        <div class="si2-inf">
          <div class="si2-t">Clear Cache</div>
          <div class="si2-s">Remove locally stored notes</div>
        </div>
        <span class="schev">›</span>
      </div>
    </div>
    <div style="text-align:center;padding:20px 0 4px;font-size:11px;color:var(--mut2)">ContextNote Mobile v1.4 PWA</div>`;
}

async function syncNow() {
  if (!curUser?.is_pro) {
    toast("Pro required to sync");
    return;
  }
  toast("Syncing…");
  notes = [];
  localStorage.removeItem(NKEY);
  $("homeCnt").innerHTML = '<div class="spin"></div>';
  await loadNotes();
  renderSettings();
  toast("✓ Synced");
}

function clearCache() {
  if (!confirm("Remove all locally cached notes from this device?")) return;
  localStorage.removeItem(NKEY);
  notes = [];
  renderHome();
  renderSettings();
  toast("Cache cleared");
}

// ═══════════════════════════════════════════════════════════════════════════
//  SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════════════
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("./sw.js")
      .then((r) => console.log("SW:", r.scope))
      .catch((e) => console.warn("SW failed:", e)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════
renderTGrid();
checkAuth();
