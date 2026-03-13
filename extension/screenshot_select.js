// screenshot_select.js
// Injected by background.js when user triggers "take screenshot"
// Draws a drag-selection overlay, then messages background with the crop rect

(function () {
  // Don't inject twice
  if (document.getElementById("cn-screenshot-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "cn-screenshot-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0.35);
    user-select: none;
    -webkit-user-select: none;
  `;

  const selBox = document.createElement("div");
  selBox.id = "cn-sel-box";
  selBox.style.cssText = `
    position: fixed;
    border: 2px solid #6366f1;
    background: rgba(99, 102, 241, 0.10);
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
    display: none;
    pointer-events: none;
    z-index: 2147483647;
  `;

  const hint = document.createElement("div");
  hint.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.75);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 20px;
    border-radius: 8px;
    pointer-events: none;
    letter-spacing: 0.2px;
  `;
  hint.textContent = "Drag to select area  ·  Esc to cancel";

  overlay.appendChild(selBox);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  let startX = 0,
    startY = 0;
  let isDragging = false;

  function getRect(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = "none";

    selBox.style.display = "block";
    selBox.style.left = startX + "px";
    selBox.style.top = startY + "px";
    selBox.style.width = "0px";
    selBox.style.height = "0px";
    // Reset box shadow cutout
    selBox.style.boxShadow = `0 0 0 9999px rgba(0,0,0,0.35)`;
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const r = getRect(startX, startY, e.clientX, e.clientY);
    selBox.style.left = r.x + "px";
    selBox.style.top = r.y + "px";
    selBox.style.width = r.w + "px";
    selBox.style.height = r.h + "px";
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;

    const r = getRect(startX, startY, e.clientX, e.clientY);

    // Ignore tiny accidental drags (< 10px)
    if (r.w < 10 || r.h < 10) {
      cleanup();
      return;
    }

    // Scale by devicePixelRatio for HiDPI screens
    const dpr = window.devicePixelRatio || 1;

    // Send crop rect to background.js
    chrome.runtime.sendMessage({
      action: "capture_screenshot_region",
      rect: {
        x: Math.round(r.x * dpr),
        y: Math.round(r.y * dpr),
        w: Math.round(r.w * dpr),
        h: Math.round(r.h * dpr),
        // Also send CSS pixels for the dialog
        cssX: r.x,
        cssY: r.y,
        cssW: r.w,
        cssH: r.h,
      },
    });

    cleanup();
  });

  // Cancel on Escape
  document.addEventListener("keydown", onKeyDown);
  function onKeyDown(e) {
    if (e.key === "Escape") cleanup();
  }

  function cleanup() {
    overlay.remove();
    selBox.remove();
    document.removeEventListener("keydown", onKeyDown);
  }
})();
