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
      // 1. Find the "More actions" button — try multiple selectors
      // YouTube changes this periodically so we cast a wide net
      const moreBtn =
        document.querySelector('button[aria-label="More actions"]') ||
        document.querySelector('button[aria-label="More Actions"]') ||
        document.querySelector("#button-shape button") ||
        [...document.querySelectorAll("button")].find(
          (b) =>
            b.getAttribute("aria-label")?.toLowerCase().includes("more") &&
            b.closest("ytd-menu-renderer"),
        );

      if (!moreBtn) return { error: "NO_MORE_BTN" };

      moreBtn.click();
      await new Promise((r) => setTimeout(r, 1000));

      // 2. Find "Show transcript" — try text match AND partial match
      const allFormattedStrings = [
        ...document.querySelectorAll("yt-formatted-string"),
      ];

      // Also check tp-yt-paper-item and plain text inside menu items
      const allMenuTexts = [
        ...document.querySelectorAll(
          "tp-yt-paper-item, ytd-menu-service-item-renderer",
        ),
      ];

      const transcriptBtn =
        allFormattedStrings.find(
          (el) => el.textContent.trim() === "Show transcript",
        ) ||
        allFormattedStrings.find((el) =>
          el.textContent.trim().toLowerCase().includes("transcript"),
        ) ||
        allMenuTexts.find((el) =>
          el.textContent.trim().toLowerCase().includes("transcript"),
        );

      if (!transcriptBtn) {
        // Close the menu before returning
        document.body.click();
        await new Promise((r) => setTimeout(r, 300));
        return { error: "NO_TRANSCRIPT" };
      }

      transcriptBtn.click();
      let segments = [];
      const MAX_WAIT = 5000;
      const POLL_INTERVAL = 300;
      let waited = 0;

      while (waited < MAX_WAIT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        waited += POLL_INTERVAL;

        const found = document.querySelectorAll(
          "ytd-transcript-segment-renderer",
        );
        if (found.length > 0) {
          segments = [...found];
          break;
        }
      }

      if (!segments.length) return { error: "NO_SEGMENTS" };

      // Newer YouTube layout fallback
      if (!segments.length) {
        segments = document.querySelectorAll(
          "ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer",
        );
      }

      if (!segments.length) return { error: "NO_SEGMENTS" };

      const lines = [...segments]
        .map((seg) => {
          // Try multiple possible text container selectors
          const text =
            seg.querySelector(".segment-text")?.textContent?.trim() ||
            seg.querySelector("yt-formatted-string")?.textContent?.trim() ||
            seg.textContent?.trim() ||
            "";
          return text;
        })
        .filter(Boolean);

      if (!lines.length) return { error: "NO_SEGMENTS" };

      // 4. Close transcript panel
      const closeBtn =
        document.querySelector('button[aria-label="Close transcript"]') ||
        document.querySelector('button[aria-label="close"]');
      closeBtn?.click();

      // 5. Get video title — try multiple selectors
      const title =
        document
          .querySelector("h1.ytd-video-primary-info-renderer")
          ?.textContent?.trim() ||
        document
          .querySelector("ytd-video-primary-info-renderer h1")
          ?.textContent?.trim() ||
        document
          .querySelector("h1.style-scope.ytd-watch-metadata")
          ?.textContent?.trim() ||
        document.title;

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
