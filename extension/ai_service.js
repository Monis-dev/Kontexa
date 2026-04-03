let lastCallTime = 0;
const MIN_DELAY = 2000;

const AIService = {
  // Model Configuration
  MODEL_NAME: "gemini-2.5-flash",

  async callGemini(prompt, contextNotes) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;

    if (!apiKey) throw new Error("API_KEY_MISSING");

    const now = Date.now();

    if (now - lastCallTime < MIN_DELAY) {
      await new Promise((res) => setTimeout(res, MIN_DELAY));
    }

    lastCallTime = Date.now();

    // 1. Cleanly format the notes so the AI isn't confused by empty fields
    const notesText = contextNotes
      .map((n, i) => {
        let parts = [`--- Note ${i + 1} (ID: ${n.id}) ---`];
        if (n.title) parts.push(`Page Title: ${n.title}`);
        if (n.selection) parts.push(`Highlighted Text: ${n.selection}`);
        if (n.content) parts.push(`User's Written Note: ${n.content}`);
        return parts.join("\n");
      })
      .join("\n\n");

    // 2. Stronger System Prompt
    const systemPrompt = `
You are an expert research assistant.

You must return a JSON response with TWO things:
1. "answer" → answer to user question using ONLY the provided notes
2. "tags" → object mapping each note's EXACT ID to an array of tags

RULES:
- Use the EXACT note ID as the key (e.g., "abc123", not "note_id_1")
- Tags must be 2–4 words max
- lowercase
- no duplicates
- based ONLY on note content

FORMAT (use the real IDs from the notes below):
{
  "answer": "your answer here",
  "tags": {
    "<exact_note_id>": ["tag1", "tag2"],
    "<exact_note_id>": ["tag3"]
  }
}

NOTES:
${notesText || "No notes provided."}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\nUser Question: ${prompt}` }],
            },
          ],
          generationConfig: {
            temperature: 0.2, // Lower temperature makes it more factual and strict to the notes
          },
        }),
      });

      if (response.status === 429) {
        return "⚠️ Rate limit exceeded. Please wait a moment or check your API key usage.";
      }

      if (!response.ok) {
        const errData = await response.json();
        return `Error: ${errData.error?.message || "Failed to reach AI service."}`;
      }

      const data = await response.json();
      let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!raw) {
        return { answer: "⚠️ Empty AI response", tags: {} };
      }

      // clean markdown
      raw = raw.replace(/```json|```/g, "").trim();

      let parsed;

      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn("JSON parse failed", raw);
        return { answer: raw, tags: {} };
      }

      return {
        answer: parsed.answer || "No answer",
        tags: parsed.tags || {},
      };
    } catch (error) {
      console.error("AI Service Error:", error);
      return "Connection error. Please check your internet connection and API key.";
    }
  },
  async chat(question, contextNotes) {
    return await this.callGemini(question, contextNotes);
  },

  async summarize(content) {
    const prompt = `Summarize this text concisely, highlighting key research points. 
    If the text is empty or meaningless, say "No content to summarize."\n\nText: ${content}`;
    // Passing an empty array as context since this is a direct content summary
    return await this.callGemini(prompt, []);
  },

  // --- NEW: GENERATE INDIVIDUAL NOTES FROM PAGE ---
  async generateNotesFromPage(pageContent) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;

    if (!apiKey) throw new Error("API_KEY_MISSING");

    // Limit content length to avoid exceeding token limits on massive pages
    const safeContent = pageContent.substring(0, 30000);

    const systemPrompt = `You are an expert research assistant. Read the provided documentation/webpage content and extract the 3 to 5 most important concepts.
    
    You MUST return your response as a valid JSON array of objects. Do not include markdown formatting like \`\`\`json. Just the raw array.
    
    Format:
    [
      { "title": "Short Heading", "content": "Detailed explanation (2-3 sentences)." },
      { "title": "Another Heading", "content": "Another explanation." }
    ]
    
    Content to analyze:
    ${safeContent}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;
      // Clean up markdown in case the AI ignores the "no markdown" rule
      rawText = rawText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(rawText); // Returns Array of note objects
    } catch (error) {
      console.error("AI Generation Error:", error);
      return null;
    }
  },
  async generateNotesFromQuestion(question) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;
    if (!apiKey) return null;

    const prompt = `
You are a note generator. The user asked about a topic they have no saved notes on.

Generate 3 helpful, accurate notes about this topic.

Return ONLY a valid JSON array. No markdown, no backticks, no extra text.

Each object must have EXACTLY these fields:
- "title": short heading (5 words max)
- "content": clear explanation (2-3 sentences, factual and accurate)
- "tags": array of 2-3 lowercase single-word tags

DO NOT include a "domain" field. DO NOT invent website URLs.

FORMAT:
[
  {
    "title": "Concept Name",
    "content": "Clear explanation here.",
    "tags": ["tag1", "tag2"]
  }
]

User Question: ${question}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      raw = raw.replace(/```json|```/g, "").trim();

      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn("generateNotesFromQuestion: JSON parse failed", raw);
        return null;
      }
    } catch (error) {
      console.error("AI Generation Error:", error);
      return null;
    }
  },

  async generateTags(noteText) {
    if (!noteText || noteText.trim().length < 10) return [];

    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;

    if (!apiKey) return [];

    const prompt = `
Generate 3-5 topic tags.

Rules:
- lowercase
- 1-2 words max
- no symbols
- return ONLY JSON array

Example:
["javascript","react","frontend"]

Text:
${noteText}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) return [];

      text = text.replace(/```json|```/g, "").trim();

      let parsed = JSON.parse(text);

      // ✅ sanitize
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0);
    } catch (e) {
      console.warn("Tag generation failed:", e);
      return [];
    }
  },

  async generateNotesFromTranscript(transcript, videoTitle) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;
    if (!apiKey) throw new Error("API_KEY_MISSING");

    const safeTranscript = transcript.substring(0, 20000);

    const prompt = `You are an expert note-taker watching a YouTube video titled: "${videoTitle}"

Extract the 4 to 6 most important concepts or insights from the transcript below.

RULES:
- Each note must have a short "title" (5 words max)
- Each note must have "content" (2-3 sentences summarizing the point)
- Each note must have "tags" (2-4 lowercase single-word tags)
- Return ONLY a valid JSON array, no markdown, no extra text

FORMAT:
[
  { "title": "Concept title", "content": "Explanation here.", "tags": ["tag1", "tag2"] }
]

TRANSCRIPT:
${safeTranscript}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    });

    if (!response.ok) throw new Error("Gemini API error");

    const data = await response.json();
    let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    raw = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(raw);
  },
};

async function lazyTagNotes(notes) {
  const updated = [];

  const MAX_TAGS_PER_RUN = 2;

  let count = 0;

  for (let note of notes) {
    if (count >= MAX_TAGS_PER_RUN) break;

    if (note.tags && note.tags.length > 0) continue;

    try {
      const text =
        (note.title || "") +
        " " +
        (note.content || "") +
        " " +
        (note.selection || "");

      const tags = await AIService.generateTags(text);

      if (tags.length > 0) {
        note.tags = tags;
        count++;
      }
    } catch (e) {
      console.warn("Lazy tagging failed");
    }
  }

  return updated;
}

function smartFilterNotes(notes, query) {
  query = query.toLowerCase();
  const STOP_WORDS = new Set([
    "is",
    "what",
    "the",
    "a",
    "an",
    "are",
    "was",
    "were",
    "how",
    "why",
    "when",
    "where",
    "who",
    "do",
    "does",
    "can",
    "tell",
    "me",
    "about",
    "give",
    "show",
    "explain",
    "with",
    "for",
    "of",
    "in",
    "on",
    "at",
    "to",
    "and",
    "its",
    "this",
  ]);
  const words = query
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (words.length === 0) return [];

  return notes
    .map((note) => {
      let score = 0;

      const text =
        (note.title || "") +
        " " +
        (note.content || "") +
        " " +
        (note.selection || "");

      const lowerText = text.toLowerCase();

      // Exact query match
      if (lowerText.includes(query)) score += 8;

      // Word-level matching
      words.forEach((word) => {
        if (lowerText.includes(word)) score += 3;
      });

      // Title boost
      if ((note.title || "").toLowerCase().includes(query)) {
        score += 5;
      }

      // Short notes penalty (avoid noise)
      if (text.length < 50) score -= 2;

      return { note, score };
    })
    .filter((item) => item.score > 0) // Lowered threshold so short AI notes pass
    .sort((a, b) => b.score - a.score)
    .slice(0, 9)
    .map((item) => item.note);
}

function detectDomain(query) {
  query = query.toLowerCase();

  if (
    query.includes("neural") ||
    query.includes("machine learning") ||
    query.includes("ai")
  ) {
    return "ai";
  }

  if (
    query.includes("react") ||
    query.includes("javascript") ||
    query.includes("frontend")
  ) {
    return "web";
  }

  if (query.includes("database") || query.includes("sql")) {
    return "database";
  }

  return null;
}