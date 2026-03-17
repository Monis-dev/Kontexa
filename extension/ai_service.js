const AIService = {
  // Model Configuration
  MODEL_NAME: "gemini-2.5-flash",

  async callGemini(prompt, contextNotes) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    const apiKey = res.gemini_key;

    if (!apiKey) throw new Error("API_KEY_MISSING");

    // 1. Cleanly format the notes so the AI isn't confused by empty fields
    // 1. Cleanly format the notes including Tags
    const notesText = contextNotes
      .map((n, i) => {
        let parts = [`--- Note ${i + 1} ---`];
        if (n.title) parts.push(`Page Title: ${n.title}`);
        if (n.tags) parts.push(`Tags: ${n.tags}`); // Added Tags to context
        if (n.selection) parts.push(`Highlighted Text: ${n.selection}`);
        if (n.content) parts.push(`User's Written Note: ${n.content}`);
        return parts.join("\n");
      })
      .join("\n\n");

    // 2. Stronger System Prompt
    const systemPrompt = `You are an expert research assistant. Your ONLY source of knowledge is the user's research notes provided below. 
    I have filtered the 15 most relevant notes from the user's entire library based on their question.
    
    INSTRUCTIONS:
    1. Read ALL the provided notes carefully, paying attention to the Tags and Titles.
    2. Answer the user's question by synthesizing information from the Titles, Tags, Highlights, and Written Notes. Treat this data as absolute truth.
    3. If the answer can be reasonably inferred or pieced together from any part of the notes, provide a detailed and helpful answer.
    4. Only if the topic is completely absent from the notes, reply strictly with: "I don't have enough information in your notes to answer that."

    USER'S RESEARCH NOTES:
    ${notesText || "No notes provided."}`;

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
      return data.candidates[0].content.parts[0].text;
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
      let rawText = data.candidates[0].content.parts[0].text;

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

  async generateAutoTags(title, content, selection) {
    const res = await chrome.storage.local.get(["gemini_key"]);
    if (!res.gemini_key) return "";

    const prompt = `Analyze this research note and provide 3 to 5 relevant one-word tags. Return ONLY the tags separated by commas.
    Title: ${title} | Content: ${content} | Highlight: ${selection}`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_NAME}:generateContent?key=${res.gemini_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4 },
          }),
        },
      );

      // Handle 429 smoothly
      if (response.status === 429) {
        console.warn("AI Tagging throttled (429). Returning empty tags.");
        return "";
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text.trim();
    } catch (e) {
      return "";
    }
  },
};
