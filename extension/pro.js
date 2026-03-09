const API_URL = "http://127.0.0.1:5000"; // Change to your Render URL

const ProMode = {

  async checkAuthStatus() {
    try {
      const res = await fetch(`${API_URL}/api/me`, { credentials: "include" });
      if (res.ok) {
        const user = await res.json();
        return {
          isLoggedIn: true,
          isPro: user.is_pro === true
        };
      }
      return { isLoggedIn: false, isPro: false }; // 401 Not Logged in
    } catch (e) {
      console.error("Auth check failed", e);
      return { isLoggedIn: false, isPro: false }; // Server unreachable
    }
  },

  // 2. The Strict Gatekeeper: (Logged In + Pro) AND (Has API Key)
  async canAccessAI() {
    // Step 1 & 2: Check Login & Pro
    const status = await this.checkAuthStatus();

    if (!status.isLoggedIn || !status.isPro) {
      // Block: Hide AI modal, Show Paywall
      const paywall = document.getElementById("paywallModal");
      const aiModal = document.getElementById("aiModal");
      
      if (aiModal) aiModal.classList.remove("on");
      
      if (paywall) {
        paywall.classList.add("on");
      } else {
        alert("🔒 Pro Feature: Please log in and upgrade to Pro to use AI tools.");
      }
      return false; // Access Denied
    }

    // Step 3: Check for Local API Key
    const res = await chrome.storage.local.get(['gemini_key']);
    if (!res.gemini_key) {
      // Block: Hide AI modal, Show API Settings Modal
      const apiModal = document.getElementById("apiSettingsModal");
      const aiModal = document.getElementById("aiModal");
      
      if (aiModal) aiModal.classList.remove("on");
      
      if (apiModal) {
        apiModal.classList.add("on");
      } else {
        alert("Please set your Gemini API Key in Settings.");
      }
      return false; // Access Denied
    }

    return true; // Access Granted!
  },


  // 1. Check Status (Double check with server)
  async isProUser() {
    try {
      const res = await fetch(`${API_URL}/api/me`, { credentials: "include" });
      if (res.ok) {
        const user = await res.json();
        return user.is_pro === true;
      }
    } catch (e) {
      console.error("Auth check failed", e);
    }
    return false;
  },

  // 2. Generic Upgrade Alert
  showUpgradeMessage() {
    // You can replace this with opening the Paywall Modal from dashboard.js
    if (document.getElementById("paywallModal")) {
      document.getElementById("paywallModal").classList.add("on");
    } else {
      alert("🔒 Pro Feature: Please upgrade to use AI tools & Cloud Sync.");
    }
  },

  // 3. AI Chat
  async aiChat(question, domainNotes) {
    if (!(await this.isProUser())) {
      this.showUpgradeMessage();
      return null;
    }

    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context: domainNotes }),
      credentials: "include",
    });
    const data = await res.json();
    return data.answer;
  },

  // 4. Summarize Page (or Note)
  async summarizeText(text) {
    if (!(await this.isProUser())) {
      this.showUpgradeMessage();
      return null;
    }

    try {
      const res = await fetch(`${API_URL}/api/ai/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        credentials: "include",
      });
      return await res.json();
    } catch (e) {
      return { summary: "Error generating summary." };
    }
  },
};
