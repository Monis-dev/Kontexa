const STORAGE_KEY = "context_notes_data";
const SETTINGS_KEY = "cn_show_highlights";

// ==========================================
// ── 1. HIGHLIGHT ENGINE ──
// ==========================================

function removeHighlights() {
  document.querySelectorAll("mark.cn-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize(); // Merge text nodes back together
  });
}

function highlightTextOnPage(searchText, noteTitle) {
  if (!searchText || searchText.length < 2) return;

  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );
  const nodeList = [];
  let currentNode = treeWalker.nextNode();

  while (currentNode) {
    const parentTag = currentNode.parentNode.tagName;
    if (
      ["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"].indexOf(
        parentTag,
      ) === -1
    ) {
      nodeList.push(currentNode);
    }
    currentNode = treeWalker.nextNode();
  }

  let totalText = nodeList.map((n) => n.nodeValue).join("");
  const cleanSearchText = searchText.replace(/\s+/g, " ").trim();
  const cleanTotalText = totalText.replace(/\s+/g, " ");

  let searchIndex = 0;
  let startIndex = cleanTotalText.indexOf(cleanSearchText, searchIndex);

  while (startIndex !== -1) {
    try {
      if (window.find && window.getSelection) {
        if (window.find(searchText, false, false, false, false, false, false)) {
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const mark = document.createElement("mark");
            mark.className = "cn-highlight";
            mark.style.backgroundColor = "#fde047";
            mark.style.color = "#92400e";
            mark.style.borderBottom = "2px solid #f59e0b";
            mark.title = `ContextNote: ${noteTitle}`;

            try {
              range.surroundContents(mark);
            } catch (e) {
              const newNode = document.createElement("mark");
              newNode.className = "cn-highlight";
              newNode.style.backgroundColor = "#fde047";
              newNode.style.color = "#92400e";
              newNode.style.borderBottom = "2px solid #f59e0b";
              newNode.title = `ContextNote: ${noteTitle}`;
              newNode.appendChild(range.extractContents());
              range.insertNode(newNode);
            }
            sel.removeAllRanges();
          }
        }
      }
    } catch (e) {
      console.log("Highlighting error:", e);
    }

    searchIndex = startIndex + 1;
    startIndex = cleanTotalText.indexOf(cleanSearchText, searchIndex);
    if (searchIndex > cleanTotalText.length) break;
  }
}

function initHighlights() {
  // If extension context is dead, abort immediately
  if (!chrome.runtime?.id) return;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  try {
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (res) => {
      if (chrome.runtime.lastError) return; // Ignore disconnected errors

      const isEnabled = res[SETTINGS_KEY] !== false;
      if (!isEnabled) {
        removeHighlights();
        return;
      }

      const allNotes = res[STORAGE_KEY] ? JSON.parse(res[STORAGE_KEY]) : [];
      const currentUrlNotes = allNotes.filter(
        (n) => n.url === window.location.href,
      );

      if (currentUrlNotes.length > 0) {
        currentUrlNotes.sort((a, b) => b.selection.length - a.selection.length);
        removeHighlights();
        currentUrlNotes.forEach((note) => {
          highlightTextOnPage(note.selection, note.title);
        });
        window.scrollTo(scrollX, scrollY);
      }
    });
  } catch (e) {
    // Fails silently if context is invalidated
  }
}

// ==========================================
// ── 2. YOUTUBE VIDEO TIMESTAMPS MARKERS ──
// ==========================================

function isContextValid() {
  try {
    // Accessing chrome.runtime.id throws an error if context is dead
    return !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function getYouTubeVideoId(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes("youtube.com")) {
      return urlObj.searchParams.get("v");
    }
  } catch (e) {
    return null;
  }
  return null;
}

function initVideoMarkers() {
  if (!isContextValid()) return;
  if (!window.location.hostname.includes("youtube.com")) return;

  const video = document.querySelector("video");
  const progressBar = document.querySelector(".ytp-progress-list");

  if (!video || !progressBar || isNaN(video.duration) || video.duration === 0)
    return;

  try {
    chrome.storage.local.get([STORAGE_KEY, "cn_show_highlights"], (res) => {
      // Check again inside the async callback
      if (!isContextValid() || chrome.runtime.lastError) return;

      if (res["cn_show_highlights"] === false) {
        document.querySelectorAll(".cn-vid-marker").forEach((m) => m.remove());
        return;
      }

      const allNotes = res[STORAGE_KEY] ? JSON.parse(res[STORAGE_KEY]) : [];
      const currentVideoId = getYouTubeVideoId(window.location.href);

      if (!currentVideoId) return;

      const videoNotes = allNotes.filter((n) => {
        const noteVideoId = getYouTubeVideoId(n.url);
        return noteVideoId === currentVideoId && n.timestamp;
      });

      // Clean up old markers
      document.querySelectorAll(".cn-vid-marker").forEach((m) => m.remove());

      videoNotes.forEach((note) => {
        const seconds = timeToSeconds(note.timestamp);
        const duration = video.duration;

        if (seconds > duration) return;

        const percent = (seconds / duration) * 100;

        const marker = document.createElement("div");
        marker.className = "cn-vid-marker";

        marker.style.cssText = `
          position: absolute;
          left: ${percent}%;
          bottom: -10%; 
          width: 6px; 
          height: 120%; 
          background-color: #fbbf24;
          border-radius: 2px;
          box-shadow: 0 0 6px rgba(251, 191, 36, 0.8), 0 0 2px rgba(0,0,0,0.8);
          z-index: 50;
          cursor: pointer;
          transition: transform 0.15s ease, background-color 0.15s ease;
        `;

        const cleanTitle = note.title || "Timestamp";
        marker.title = `ContextNote: ${cleanTitle}`;

        marker.addEventListener("mouseenter", () => {
          marker.style.transform = "scaleX(1.8) scaleY(1.2)";
          marker.style.backgroundColor = "#fff";
        });
        marker.addEventListener("mouseleave", () => {
          marker.style.transform = "scaleX(1) scaleY(1)";
          marker.style.backgroundColor = "#fbbf24";
        });

        marker.addEventListener("click", (e) => {
          e.stopPropagation();
          video.currentTime = seconds;
        });

        progressBar.appendChild(marker);
      });
    });
  } catch (e) {
    // Silently catch the error so it doesn't print to console
  }
}

// ==========================================
// ── 3. INITIALIZATION & LISTENERS ──
// ==========================================

// Run highlights immediately
initHighlights();
setTimeout(initHighlights, 1500);

// YouTube interval loop
let ytInterval = setInterval(() => {
  if (!isContextValid()) {
    clearInterval(ytInterval); // Permanently stop the loop if extension was reloaded
    return;
  }
  if (window.location.hostname.includes("youtube.com")) {
    initVideoMarkers();
  }
}, 2000);

// Single, clean message listener
try {
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "refresh_highlights") {
        initHighlights();
        initVideoMarkers();
      } else if (request.action === "remove_highlights") {
        removeHighlights();
        document.querySelectorAll(".cn-vid-marker").forEach((m) => m.remove());
      }
    });
  }
} catch (e) {
  // Catch listener failures quietly
}