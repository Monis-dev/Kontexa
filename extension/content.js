const STORAGE_KEY = "context_notes_data";
const SETTINGS_KEY = "cn_show_highlights";

// 1. Remove all existing highlights safely
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

// 2. Advanced Finder: Handles text splitting across <b>, <span>, <a>, etc.
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

  // Step 1: Flatten the DOM into a list of text nodes
  while (currentNode) {
    // Skip hidden elements (scripts, styles, inputs)
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

  // Step 2: Search for the text across these nodes
  let totalText = nodeList.map((n) => n.nodeValue).join("");

  // Clean up whitespace for easier matching (browser selection often has weird newlines)
  const cleanSearchText = searchText.replace(/\s+/g, " ").trim();
  const cleanTotalText = totalText.replace(/\s+/g, " ");

  let searchIndex = 0;
  let startIndex = cleanTotalText.indexOf(cleanSearchText, searchIndex);

  // Loop to find ALL occurrences of the text
  while (startIndex !== -1) {
    let matchLength = cleanSearchText.length;
    let currentLength = 0;
    let startNodeIndex = -1;
    let startNodeOffset = -1;
    let endNodeIndex = -1;
    let endNodeOffset = -1;

    // Map the string index back to the DOM nodes
    let runningLength = 0;

    // We need to map the "clean" index back to the "real" index (accounting for newlines we stripped)
    // This is complex, so we use a simpler Range approach for robustness:

    try {
      if (window.find && window.getSelection) {
        // "Hack": Use the browser's own Find engine to locate the text safely
        // This is safer than math because it handles CSS rendering nuances
        if (window.find(searchText, false, false, false, false, false, false)) {
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);

            // Create the highlight wrapper
            const mark = document.createElement("mark");
            mark.className = "cn-highlight";
            mark.style.backgroundColor = "#fde047";
            mark.style.color = "#92400e";
            mark.style.borderBottom = "2px solid #f59e0b";
            mark.title = `ContextNote: ${noteTitle}`;

            // Safe Wrap: extractContents handles the <b> <span> splitting automatically!
            try {
              range.surroundContents(mark);
            } catch (e) {
              // If surroundContents fails (common on complex DOMs), use the fallback
              const newNode = document.createElement("mark");
              newNode.className = "cn-highlight";
              newNode.style.backgroundColor = "#fde047";
              newNode.style.color = "#92400e";
              newNode.style.borderBottom = "2px solid #f59e0b";
              newNode.title = `ContextNote: ${noteTitle}`;
              newNode.appendChild(range.extractContents());
              range.insertNode(newNode);
            }
            sel.removeAllRanges(); // Clear the user's blue selection
          }
        }
      }
    } catch (e) {
      console.log("Highlighting error:", e);
    }

    // Find next occurrence
    searchIndex = startIndex + 1;
    startIndex = cleanTotalText.indexOf(cleanSearchText, searchIndex);

    // Stop infinite loops if something weird happens
    if (searchIndex > cleanTotalText.length) break;
  }
}

// 3. Main Init Function
function initHighlights() {
  // Store scroll position so window.find doesn't jump the page around
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (res) => {
    const isEnabled = res[SETTINGS_KEY] !== false;
    if (!isEnabled) {
      removeHighlights();
      return;
    }

    const allNotes = res[STORAGE_KEY] ? JSON.parse(res[STORAGE_KEY]) : [];

    // Exact URL match
    const currentUrlNotes = allNotes.filter(
      (n) => n.url === window.location.href,
    );

    if (currentUrlNotes.length > 0) {
      // Sort by length (longest first) to prevent nesting issues
      currentUrlNotes.sort((a, b) => b.selection.length - a.selection.length);

      removeHighlights(); // Reset page

      currentUrlNotes.forEach((note) => {
        highlightTextOnPage(note.selection, note.title);
      });

      // Restore Scroll (Crucial because window.find jumps)
      window.scrollTo(scrollX, scrollY);
    }
  });
}

// Run immediately + fallback for dynamic sites
initHighlights();
setTimeout(initHighlights, 1500);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refresh_highlights") initHighlights();
  else if (request.action === "remove_highlights") removeHighlights();
});
