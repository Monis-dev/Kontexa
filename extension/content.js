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
    parent.normalize();
  });
}

function highlightTextOnPage(searchText, noteTitle) {
  if (!searchText || searchText.length < 2) return;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
  );

  const nodes = [];
  let node;

  while ((node = walker.nextNode())) {
    if (
      node.parentNode &&
      !["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"].includes(
        node.parentNode.tagName,
      )
    ) {
      nodes.push(node);
    }
  }

  const search = searchText.trim().toLowerCase();

  nodes.forEach((textNode) => {
    const text = textNode.nodeValue.toLowerCase();
    const index = text.indexOf(search);

    if (index !== -1) {
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + search.length);

      const mark = document.createElement("mark");
      mark.className = "cn-highlight";
      mark.style.backgroundColor = "#fde047";
      mark.style.color = "#92400e";
      mark.style.borderBottom = "2px solid #f59e0b";
      mark.title = `ContextNote: ${noteTitle}`;

      try {
        range.surroundContents(mark);
      } catch {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      }
    }
  });
}

function initHighlights() {
  if (!chrome.runtime?.id) return;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  try {
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (res) => {
      if (chrome.runtime.lastError) return;

      const isEnabled = res[SETTINGS_KEY] !== false;
      if (!isEnabled) {
        removeHighlights();
        return;
      }

      let allNotes = res[STORAGE_KEY] || [];

      if (typeof allNotes === "string") {
        try {
          allNotes = JSON.parse(allNotes);
        } catch {
          allNotes = [];
        }
      }
      const currentUrlNotes = allNotes.filter(
        (n) => n.url.split("?")[0] === window.location.href.split("?")[0],
      );

      if (currentUrlNotes.length > 0) {
        currentUrlNotes
          .filter((n) => n.selection && n.selection.length > 1)
          .sort((a, b) => b.selection.length - a.selection.length);
        removeHighlights();
        currentUrlNotes.forEach((note) => {
          highlightTextOnPage(note.selection, note.title);
        });
        window.scrollTo(scrollX, scrollY);
      }
    });
  } catch (e) {}
}

// ==========================================
// ── 2. YOUTUBE VIDEO TIMESTAMP MARKERS ──
// ==========================================

function isContextValid() {
  try {
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

// Guard flag so we never run two storage lookups simultaneously
let isMarkersRunning = false;

function initVideoMarkers() {
  if (!isContextValid()) return;
  if (!window.location.hostname.includes("youtube.com")) return;
  if (isMarkersRunning) return; // Prevent overlapping async calls

  const video = document.querySelector("video");

  // ── FIX: Use ".ytp-progress-bar" as the positioning parent, not ".ytp-progress-list"
  // ".ytp-progress-list" has inner padding that shifts percent-based positions.
  // ".ytp-progress-bar" is the true full-width bar element markers should be relative to.
  const progressBar = document.querySelector(".ytp-progress-bar");

  if (!video || !progressBar) return;
  if (
    isNaN(video.duration) ||
    video.duration === 0 ||
    !isFinite(video.duration)
  )
    return;

  isMarkersRunning = true;

  // ── FIX: Remove old markers BEFORE the async storage call so there's no
  // window where two sets of markers exist simultaneously.
  document.querySelectorAll(".cn-vid-marker").forEach((m) => m.remove());

  try {
    chrome.storage.local.get([STORAGE_KEY, "cn_show_highlights"], (res) => {
      isMarkersRunning = false; // Release lock after storage returns

      if (!isContextValid() || chrome.runtime.lastError) return;

      if (res["cn_show_highlights"] === false) return; // Already cleaned up above

      let allNotes = res[STORAGE_KEY] || [];

      if (typeof allNotes === "string") {
        try {
          allNotes = JSON.parse(allNotes);
        } catch {
          allNotes = [];
        }
      }
      const currentVideoId = getYouTubeVideoId(window.location.href);
      if (!currentVideoId) return;

      const videoNotes = allNotes.filter((n) => {
        const noteVideoId = getYouTubeVideoId(n.url);
        return noteVideoId === currentVideoId && n.timestamp;
      });

      if (videoNotes.length === 0) return;

      const duration = video.duration;

      // ── FIX: Get the actual rendered width of the progress bar so we can
      // place markers using pixel offsets instead of % — this avoids any
      // discrepancy from CSS padding on parent containers.
      const barRect = progressBar.getBoundingClientRect();
      const barWidth = barRect.width;

      if (barWidth === 0) return; // Bar not rendered yet, skip this tick

      videoNotes.forEach((note) => {
        const seconds = timeToSeconds(note.timestamp);
        if (seconds > duration) return;

        // ── FIX: Calculate pixel position relative to the bar's own width,
        // not a CSS percentage which can be affected by padding/box-model.
        const fraction = seconds / duration;
        const pixelLeft = fraction * barWidth;

        const marker = document.createElement("div");
        marker.className = "cn-vid-marker";

        marker.style.cssText = `
          position: absolute;
          left: ${pixelLeft}px;
          top: 0;
          width: 4px;
          height: 100%;
          background-color: #fbbf24;
          border-radius: 2px;
          box-shadow: 0 0 6px rgba(251, 191, 36, 0.9), 0 0 2px rgba(0,0,0,0.6);
          z-index: 50;
          cursor: pointer;
          pointer-events: all;
          transition: transform 0.15s ease, background-color 0.15s ease;
          transform-origin: center;
        `;

        const cleanTitle = note.title || "Timestamp";
        marker.title = `ContextNote: ${cleanTitle} @ ${note.timestamp}`;

        marker.addEventListener("mouseenter", () => {
          marker.style.transform = "scaleX(2) scaleY(1.15)";
          marker.style.backgroundColor = "#ffffff";
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
    isMarkersRunning = false;
  }
}

// ==========================================
// ── 3. INITIALIZATION & LISTENERS ──
// ==========================================

initHighlights();
setTimeout(initHighlights, 1500);

let ytInterval = setInterval(() => {
  if (!isContextValid()) {
    clearInterval(ytInterval);
    return;
  }
  if (window.location.hostname.includes("youtube.com")) {
    initVideoMarkers();
  }
}, 2000);

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
} catch (e) {}
