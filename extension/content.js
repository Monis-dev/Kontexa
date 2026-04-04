// ==========================================
// ── DOUBLE-INJECTION GUARD ──
// ==========================================
if (!window.__cnInjected) {
  window.__cnInjected = true;

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

    const textNodes = [];
    let fullText = "";
    let node;

    while ((node = walker.nextNode())) {
      const parentTag = node.parentNode ? node.parentNode.tagName : "";
      if (
        !["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT", "MARK"].includes(
          parentTag,
        )
      ) {
        const start = fullText.length;
        fullText += node.nodeValue;
        textNodes.push({ node, start, end: fullText.length });
      }
    }

    const search = searchText.trim();
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexStr = escapedSearch.replace(/\s+/g, "\\s+");
    const regex = new RegExp(regexStr, "i");

    const match = fullText.match(regex);
    if (!match) return;

    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    const overlappingNodes = textNodes.filter(
      (n) => n.end > matchStart && n.start < matchEnd,
    );

    overlappingNodes.reverse().forEach((n) => {
      const relativeStart = Math.max(0, matchStart - n.start);
      const relativeEnd = Math.min(n.node.nodeValue.length, matchEnd - n.start);

      if (relativeStart >= relativeEnd) return;

      const range = document.createRange();
      range.setStart(n.node, relativeStart);
      range.setEnd(n.node, relativeEnd);

      const mark = document.createElement("mark");
      mark.className = "cn-highlight";
      mark.style.backgroundColor = "#fde047";
      mark.style.color = "#92400e";
      mark.style.borderBottom = "2px solid #f59e0b";
      mark.title = `ContextNote: ${noteTitle}`;

      try {
        range.surroundContents(mark);
      } catch (e) {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
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
          (n) => n.url.split("#")[0] === window.location.href.split("#")[0],
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

  let isMarkersRunning = false;

  function initVideoMarkers() {
    if (!isContextValid()) return;
    if (!window.location.hostname.includes("youtube.com")) return;
    if (isMarkersRunning) return;

    const video = document.querySelector("video");
    const progressBar = document.querySelector(".ytp-progress-bar");

    if (!video || !progressBar) return;
    if (
      isNaN(video.duration) ||
      video.duration === 0 ||
      !isFinite(video.duration)
    )
      return;

    isMarkersRunning = true;
    document.querySelectorAll(".cn-vid-marker").forEach((m) => m.remove());

    try {
      chrome.storage.local.get([STORAGE_KEY, "cn_show_highlights"], (res) => {
        isMarkersRunning = false;

        if (!isContextValid() || chrome.runtime.lastError) return;
        if (res["cn_show_highlights"] === false) return;

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
        const barRect = progressBar.getBoundingClientRect();
        const barWidth = barRect.width;
        if (barWidth === 0) return;

        videoNotes.forEach((note) => {
          const seconds = timeToSeconds(note.timestamp);
          if (seconds > duration) return;

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
  // ── 3. YOUTUBE TRANSCRIPT EXTRACTOR ──
  // ==========================================

  async function extractYouTubeTranscript() {
    try {
      // 1. Expand the video description (the transcript button is often hidden inside)
      const expandBtn =
        document.querySelector("ytd-text-inline-expander #expand") ||
        document.querySelector("#description-inline-expander #expand") ||
        document.querySelector("#bottom-row #expand");

      if (expandBtn) {
        expandBtn.click();
        await new Promise((r) => setTimeout(r, 500)); // Wait for expansion animation
      }

      // 2. Look for the "Show transcript" button directly on the page
      const allElements = [
        ...document.querySelectorAll(
          "button, yt-formatted-string, tp-yt-paper-item",
        ),
      ];
      let transcriptBtn = allElements.find(
        (el) =>
          el.textContent &&
          el.textContent.trim().toLowerCase() === "show transcript",
      );

      // 3. Fallback: If not found directly, try opening the old "More actions" menu
      if (!transcriptBtn) {
        const moreBtn =
          document.querySelector('button[aria-label="More actions"]') ||
          document.querySelector('button[aria-label="More Actions"]') ||
          [...document.querySelectorAll("button")].find(
            (b) =>
              b.getAttribute("aria-label")?.toLowerCase().includes("more") &&
              b.closest("ytd-menu-renderer"),
          );

        if (moreBtn) {
          moreBtn.click();
          await new Promise((r) => setTimeout(r, 800)); // Wait for menu to open

          // Search inside the newly opened menu
          const menuItems = [
            ...document.querySelectorAll(
              "tp-yt-paper-item, yt-formatted-string",
            ),
          ];
          transcriptBtn = menuItems.find(
            (el) =>
              el.textContent &&
              el.textContent.trim().toLowerCase().includes("transcript"),
          );
        }
      }

      // If we still can't find it, the video actually has no transcript available
      if (!transcriptBtn) {
        document.body.click(); // Close any stray menus
        return { error: "NO_TRANSCRIPT" };
      }

      // 4. Click it to open the side panel
      transcriptBtn.click();

      // 5. Wait for the transcript segments to render (poll for up to 5 seconds)
      let segments = [];
      const MAX_WAIT = 5000;
      let waited = 0;

      while (waited < MAX_WAIT) {
        await new Promise((r) => setTimeout(r, 300));
        waited += 300;

        // Try standard layout
        segments = document.querySelectorAll("ytd-transcript-segment-renderer");
        if (segments.length > 0) break;

        // Try alternative newer layout
        segments = document.querySelectorAll(
          "ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer",
        );
        if (segments.length > 0) break;
      }

      if (!segments.length) return { error: "NO_SEGMENTS" };

      // 6. Extract the text from the segments
      const lines = [...segments]
        .map((seg) => {
          return (
            seg.querySelector(".segment-text")?.textContent?.trim() ||
            seg.querySelector("yt-formatted-string")?.textContent?.trim() ||
            seg.textContent?.trim() ||
            ""
          );
        })
        .filter(Boolean);

      if (!lines.length) return { error: "NO_SEGMENTS" };

      // 7. Clean up the UI by closing the transcript panel
      const closeBtn =
        document.querySelector('button[aria-label="Close transcript"]') ||
        document.querySelector('button[aria-label="close"]') ||
        document.querySelector(
          'ytd-engagement-panel-title-header-renderer button[aria-label="Close"]',
        );

      if (closeBtn) closeBtn.click();

      // 8. Get reliable video title (fallback to document.title)
      const title = document.title
        .replace(/^\(\d+\)\s*/, "")
        .replace(" - YouTube", "")
        .trim();

      return { transcript: lines.join(" "), title };
    } catch (e) {
      return { error: "EXTRACT_FAILED: " + e.message };
    }
  }

  // ==========================================
  // ── 4. INITIALIZATION & LISTENERS ──
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
          document
            .querySelectorAll(".cn-vid-marker")
            .forEach((m) => m.remove());
        } else if (request.action === "GET_YOUTUBE_TRANSCRIPT") {
          extractYouTubeTranscript().then(sendResponse);
          return true;
        }
      });
    }
  } catch (e) {}

  let currentHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentHref) {
      currentHref = window.location.href;
      setTimeout(() => {
        initHighlights();
        initVideoMarkers();
      }, 1000);
    }
  }, 1000);
} // ── END window.__cnInjected guard ──
