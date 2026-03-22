async function sendMsg() {
  if (aiRunning) return;
  const q = $("cin").value.trim();
  if (!q) return;

  // Check key exists before doing anything
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

    // Render markdown answer
    const bubble = document.createElement("div");
    bubble.className = "cm a";
    bubble.innerHTML = AIAgent.renderMarkdown(result.answer);
    $("cbox").appendChild(bubble);
    $("cbox").scrollTop = $("cbox").scrollHeight;

    // Save tags back to local cache (same pattern as your dashboard)
    if (result.tags && Object.keys(result.tags).length > 0) {
      notes = notes.map((n) => {
        const newTags = result.tags[n.id];
        if (newTags?.length) {
          const merged = [...new Set([...(n.tags || []), ...newTags])];
          return { ...n, tags: merged };
        }
        return n;
      });
      localStorage.setItem("cn_notes_v3", JSON.stringify(notes));
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
