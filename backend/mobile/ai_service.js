// ContextNote Mobile — AI Agent
// Adapted from ai_service.js — uses localStorage instead of chrome.storage
// Gemini only for now (testing)

const MIN_DELAY = 2000;
let lastCallTime = 0;

const AIAgent = {
  MODEL: "gemini-2.5-flash",

  // Get key from localStorage (mobile uses cn_keys, not gemini_key)
  getKey() {
    const keys = JSON.parse(localStorage.getItem("cn_keys") || "{}");
    return keys.gemini || null;
  },

  // Same scoring logic as your smartFilterNotes — keeps top relevant notes
  filterNotes(notes, query) {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter((w) => w.length > 1);

    return notes
      .map((note) => {
        let score = 0;
        const text = `${note.title || ""} ${note.content || ""} ${note.selection || ""}`;
        const lower = text.toLowerCase();

        if (lower.includes(q)) score += 8;
        words.forEach((w) => {
          if (lower.includes(w)) score += 3;
        });
        if ((note.title || "").toLowerCase().includes(q)) score += 5;
        if (note.pinned) score += 2;
        if (text.length < 50) score -= 2;

        return { note, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12) // slightly more than desktop — mobile has no folder scoping
      .map((x) => x.note);
  },

  // Format notes for the prompt — same structure as your ai_service.js
  buildContext(notes) {
    return notes
      .map((n, i) => {
        const parts = [`--- Note ${i + 1} (ID: ${n.id}) ---`];
        if (n.title) parts.push(`Title: ${n.title}`);
        if (n.domain) parts.push(`Source: ${n.domain}`);
        if (n.selection)
          parts.push(`Highlighted: ${n.selection.slice(0, 300)}`);
        if (n.content) parts.push(`Note: ${n.content.slice(0, 300)}`);
        return parts.join("\n");
      })
      .join("\n\n");
  },

  // Main chat — same prompt structure as your ai_service.js callGemini
  async chat(question, allNotes) {
    const apiKey = this.getKey();
    if (!apiKey) throw new Error("NO_KEY");

    // Rate limiting — same as your 2s MIN_DELAY
    const now = Date.now();
    if (now - lastCallTime < MIN_DELAY) {
      await new Promise((r) => setTimeout(r, MIN_DELAY - (now - lastCallTime)));
    }
    lastCallTime = Date.now();

    // Smart filter — only send relevant notes, not all 200+
    const relevant = this.filterNotes(allNotes, question);
    const context = this.buildContext(relevant);

    const systemPrompt = `You are an expert research assistant for ContextNote.

Answer the user's question using ONLY the notes provided below.
Be concise. Use markdown: **bold**, bullet points, short paragraphs.
If the answer isn't in the notes, say so clearly.

Return a JSON object with:
1. "answer" → your markdown answer string
2. "tags" → object mapping each note's EXACT ID to an array of 2-4 word tags (lowercase)

FORMAT:
{
  "answer": "your answer here",
  "tags": {
    "<exact_note_id>": ["tag1", "tag2"]
  }
}

NOTES:
${context || "No relevant notes found for this query."}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\nQuestion: ${question}` }],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    });

    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Gemini API error");
    }

    const data = await res.json();
    let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    raw = raw.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(raw);
      return { answer: parsed.answer || "No answer.", tags: parsed.tags || {} };
    } catch (e) {
      // If JSON parse fails, return raw text as answer (graceful fallback)
      return { answer: raw, tags: {} };
    }
  },

  // Render markdown to HTML for the chat bubble — same as your dashboard
  renderMarkdown(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(
        /`([^`]+)`/g,
        '<code style="background:var(--acc-bg);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>',
      )
      .replace(
        /^### (.+)$/gm,
        '<h4 style="margin:8px 0 3px;font-size:13px;font-weight:700">$1</h4>',
      )
      .replace(
        /^## (.+)$/gm,
        '<h3 style="margin:10px 0 4px;font-size:14px;font-weight:700">$1</h3>',
      )
      .replace(
        /^\s*[-*] (.+)$/gm,
        '<li style="margin:2px 0;padding-left:4px">$1</li>',
      )
      .replace(
        /(<li[\s\S]*?<\/li>)/g,
        '<ul style="margin:5px 0;padding-left:16px">$1</ul>',
      )
      .replace(/\n\n/g, '</p><p style="margin:5px 0">')
      .replace(/\n/g, "<br>")
      .replace(/^/, '<p style="margin:0">')
      .replace(/$/, "</p>");
  },
};
