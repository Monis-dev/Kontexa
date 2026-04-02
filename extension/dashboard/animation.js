/* ═══════════════════════════════════════════════════════════
   CONTEXTNOTE — DELIGHT ANIMATIONS SYSTEM
   Drop this file in your extension folder and add:
   <script src="animations.js"></script>
   BEFORE your closing </body> tag (after dashboard.js)
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ══════════════════════════════════════
     1. FLOATING AMBIENT PARTICLES
        Soft orbs that drift in the background
     ══════════════════════════════════════ */
  function createAmbientParticles() {
    const canvas = document.createElement("canvas");
    canvas.id = "cn-ambient";
    canvas.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:0; opacity:0.45;
    `;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    let W,
      H,
      particles = [];

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const getAccent = () => {
      const style = getComputedStyle(document.documentElement);
      return style.getPropertyValue("--acc").trim() || "#6366f1";
    };

    class Particle {
      constructor() {
        this.reset(true);
      }
      reset(initial = false) {
        this.x = Math.random() * W;
        this.y = initial ? Math.random() * H : H + 20;
        this.r = Math.random() * 3 + 1;
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = -(Math.random() * 0.4 + 0.1);
        this.alpha = Math.random() * 0.4 + 0.1;
        this.pulse = Math.random() * Math.PI * 2;
        this.pulseSpeed = Math.random() * 0.02 + 0.005;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.pulse += this.pulseSpeed;
        this.currentAlpha = this.alpha * (0.7 + 0.3 * Math.sin(this.pulse));
        if (this.y < -20) this.reset();
      }
      draw(accent) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = this.currentAlpha;
        ctx.fill();
        ctx.restore();
      }
    }

    for (let i = 0; i < 28; i++) particles.push(new Particle());

    let rafId;
    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      const accent = getAccent();
      particles.forEach((p) => {
        p.update();
        p.draw(accent);
      });
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  /* ══════════════════════════════════════
     2. CONFETTI BURST — called on note save
     ══════════════════════════════════════ */
  function confettiBurst(originX, originY) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = `
      position:fixed; inset:0; width:100%; height:100%;
      pointer-events:none; z-index:9999;
    `;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--acc")
        .trim() || "#6366f1";

    // Color palette based on accent + complementary colors
    const colors = [
      accent,
      "#f59e0b",
      "#10b981",
      "#ec4899",
      "#3b82f6",
      "#8b5cf6",
      "#f97316",
      "#06b6d4",
      "#84cc16",
    ];

    const PIECE_COUNT = 80;
    const pieces = Array.from({ length: PIECE_COUNT }, () => ({
      x: originX ?? canvas.width / 2,
      y: originY ?? canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 1.5) * 14,
      r: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.25,
      shape: Math.random() < 0.5 ? "rect" : "circle",
      w: Math.random() * 10 + 4,
      h: Math.random() * 6 + 3,
      alpha: 1,
      gravity: 0.4 + Math.random() * 0.2,
      trail: [],
    }));

    let frame = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      pieces.forEach((p) => {
        p.trail.push({ x: p.x, y: p.y, alpha: p.alpha });
        if (p.trail.length > 6) p.trail.shift();

        // Draw trail
        p.trail.forEach((t, i) => {
          ctx.save();
          ctx.globalAlpha = t.alpha * (i / p.trail.length) * 0.3;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(t.x, t.y, p.r * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.alpha -= 0.012;
        p.vx *= 0.99;

        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          if (p.shape === "rect") {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });

      frame++;
      if (alive && frame < 180) requestAnimationFrame(animate);
      else canvas.remove();
    };
    animate();
  }

  /* ══════════════════════════════════════
     3. NOTE SAVED CELEBRATION
        Big "✓ Note Saved!" overlay with confetti
     ══════════════════════════════════════ */
  function noteSavedCelebration() {
    confettiBurst();

    // Celebration pill
    const pill = document.createElement("div");
    pill.className = "cn-celebrate-pill";
    pill.innerHTML = `
      <div class="cn-pill-icon">✓</div>
      <div class="cn-pill-text">
        <span class="cn-pill-main">Note Saved!</span>
        <span class="cn-pill-sub">Your knowledge is growing 🚀</span>
      </div>
    `;
    document.body.appendChild(pill);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pill.classList.add("cn-pill-in");
      });
    });

    // Animate out
    setTimeout(() => {
      pill.classList.remove("cn-pill-in");
      pill.classList.add("cn-pill-out");
      setTimeout(() => pill.remove(), 600);
    }, 3200);
  }

  /* ══════════════════════════════════════
     4. CARD ENTRANCE RIPPLE
        Cards burst in with a staggered wave
     ══════════════════════════════════════ */
  function initCardRippleEntrance() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const card = entry.target;
            if (!card.dataset.animated) {
              card.dataset.animated = "true";
              card.classList.add("cn-card-enter");
              observer.unobserve(card);
            }
          }
        });
      },
      { threshold: 0.1 },
    );

    const observeCards = () => {
      document
        .querySelectorAll(".card:not([data-animated])")
        .forEach((card, i) => {
          card.style.setProperty("--enter-delay", `${i * 60}ms`);
          observer.observe(card);
        });
    };

    // Observe now and on DOM mutations
    observeCards();
    const mo = new MutationObserver(observeCards);
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════
     5. MAGNETIC BUTTON EFFECT
        Buttons slightly follow the cursor
     ══════════════════════════════════════ */
  function initMagneticButtons() {
    const addMagnetic = (el) => {
      el.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) * 0.22;
        const dy = (e.clientY - cy) * 0.22;
        el.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "";
      });
    };

    const magnetize = () => {
      document
        .querySelectorAll(
          ".btn.pri:not([data-magnetic]), #aiSendBtn:not([data-magnetic])",
        )
        .forEach((el) => {
          el.dataset.magnetic = "true";
          addMagnetic(el);
        });
    };
    magnetize();
    const mo = new MutationObserver(magnetize);
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════
     6. CURSOR SPARKLE TRAIL
        Tiny sparks follow the mouse
     ══════════════════════════════════════ */
  function initCursorSparkle() {
    const sparks = [];
    const MAX = 12;

    document.addEventListener("mousemove", (e) => {
      // Only spawn occasionally
      if (Math.random() > 0.35) return;

      const spark = document.createElement("div");
      spark.className = "cn-spark";
      const size = Math.random() * 6 + 3;
      const hue = Math.random() > 0.5 ? "var(--acc)" : "var(--logo2)";
      spark.style.cssText = `
        left:${e.clientX}px; top:${e.clientY}px;
        width:${size}px; height:${size}px;
        background:${hue};
        --tx:${(Math.random() - 0.5) * 40}px;
        --ty:${(Math.random() - 1) * 40}px;
      `;
      document.body.appendChild(spark);
      sparks.push(spark);

      spark.addEventListener("animationend", () => {
        spark.remove();
        const idx = sparks.indexOf(spark);
        if (idx > -1) sparks.splice(idx, 1);
      });

      // Limit total sparks
      if (sparks.length > MAX) {
        const old = sparks.shift();
        old?.remove();
      }
    });
  }

  /* ══════════════════════════════════════
     7. RIPPLE CLICK EFFECT
        Ink ripple on every button click
     ══════════════════════════════════════ */
  function initRipple() {
    document.addEventListener("click", (e) => {
      const target = e.target.closest("button, .btn, .na, .act");
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "cn-ripple";
      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.cssText = `
        width:${size}px; height:${size}px;
        left:${e.clientX - rect.left - size / 2}px;
        top:${e.clientY - rect.top - size / 2}px;
      `;
      // Ensure target is positioned
      const pos = getComputedStyle(target).position;
      if (pos === "static") target.style.position = "relative";
      target.style.overflow = "hidden";
      target.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  }

  /* ══════════════════════════════════════
     8. SMOOTH COUNTER — stats tick up
     ══════════════════════════════════════ */
  function animateCounter(el, targetVal, duration = 800) {
    const start = performance.now();
    const startVal = parseInt(el.textContent) || 0;

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(startVal + (targetVal - startVal) * ease);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function initCounterAnimations() {
    const observer = new MutationObserver(() => {
      const nc = document.getElementById("nc");
      if (nc) {
        const val = parseInt(nc.textContent);
        if (!isNaN(val) && nc.dataset.lastVal !== String(val)) {
          nc.dataset.lastVal = String(val);
          animateCounter(nc, val);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /* ══════════════════════════════════════
     9. CARD HOVER TILT (3D perspective)
     ══════════════════════════════════════ */
  function initCardTilt() {
    const INTENSITY = 8;

    const addTilt = (card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width / 2);
        const dy = (e.clientY - cy) / (rect.height / 2);
        const rx = -dy * INTENSITY;
        const ry = dx * INTENSITY;
        card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-5px)`;
        card.style.boxShadow = `
          ${-ry * 1.5}px ${rx * 1.5 + 12}px 40px color-mix(in srgb, var(--acc) 16%, transparent),
          0 2px 8px rgba(0,0,0,0.06)
        `;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
        card.style.boxShadow = "";
      });
    };

    const tiltAll = () => {
      document.querySelectorAll(".card:not([data-tilt])").forEach((card) => {
        card.dataset.tilt = "true";
        addTilt(card);
      });
    };
    tiltAll();
    const mo = new MutationObserver(tiltAll);
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════
     10. STAGGER-IN PAGE LOAD SEQUENCE
         Logo → topbar → sidebar → cards
     ══════════════════════════════════════ */
  function initPageLoadSequence() {
    const elements = [
      { sel: ".topbar", delay: 0, cls: "cn-reveal" },
      { sel: ".side", delay: 120, cls: "cn-reveal" },
      { sel: ".mh", delay: 200, cls: "cn-reveal" },
      { sel: ".ms", delay: 260, cls: "cn-reveal" },
      { sel: ".sech", delay: 320, cls: "cn-reveal" },
    ];

    elements.forEach(({ sel, delay, cls }) => {
      const el = document.querySelector(sel);
      if (el) {
        el.style.opacity = "0";
        setTimeout(() => {
          el.style.opacity = "";
          el.classList.add(cls);
        }, delay);
      }
    });
  }

  /* ══════════════════════════════════════
     11. SIDEBAR NAV INDICATOR LINE
         Animated line that slides between active items
     ══════════════════════════════════════ */
  function initSidebarIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "cn-nav-indicator";
    const snav = document.getElementById("snav");
    if (!snav) return;
    snav.style.position = "relative";
    snav.appendChild(indicator);

    const updateIndicator = () => {
      const active = snav.querySelector(".na.on");
      if (!active) {
        indicator.style.opacity = "0";
        return;
      }
      const rect = active.getBoundingClientRect();
      const parentRect = snav.getBoundingClientRect();
      indicator.style.cssText = `
        top: ${rect.top - parentRect.top + snav.scrollTop}px;
        height: ${rect.height}px;
        opacity: 1;
      `;
    };

    snav.addEventListener("click", () => setTimeout(updateIndicator, 50));
    const mo = new MutationObserver(updateIndicator);
    mo.observe(snav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    setTimeout(updateIndicator, 500);
  }

  /* ══════════════════════════════════════
     12. TOAST UPGRADE — emoji + progress bar
     ══════════════════════════════════════ */
  function upgradeToast() {
    const originalToast = window.toast;
    if (!originalToast) return;

    window.toast = function (message, duration = 2600) {
      // Detect save events to trigger celebration
      const isSave = /saved|added|moved|created/i.test(message);
      const isDelete = /deleted/i.test(message);
      const isError = /error|fail/i.test(message);

      if (isSave) {
        noteSavedCelebration();
      }

      const t = document.getElementById("toast");
      if (!t) return;

      // Add emoji based on context
      let emoji = "✓";
      if (isDelete) emoji = "🗑";
      if (isError) emoji = "⚠️";
      if (/download/i.test(message)) emoji = "⬇️";
      if (/renamed/i.test(message)) emoji = "✏️";
      if (/folder/i.test(message)) emoji = "📁";

      t.innerHTML = `
        <span class="toast-emoji">${emoji}</span>
        <span class="toast-msg">${message}</span>
        <div class="toast-bar" style="animation-duration:${duration}ms"></div>
      `;

      t.className = "toast";
      if (isDelete) t.classList.add("toast-danger");
      if (isError) t.classList.add("toast-danger");

      t.classList.add("on");
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => t.classList.remove("on"), duration);
    };
  }

  /* ══════════════════════════════════════
     13. WELCOME ANIMATION — first load
         Typewriter effect on the page title
     ══════════════════════════════════════ */
  function initWelcomeTypewriter() {
    const waitForTitle = setInterval(() => {
      const mh = document.querySelector(".mh");
      if (mh && mh.textContent.trim()) {
        clearInterval(waitForTitle);
        const originalText = mh.textContent;
        mh.textContent = "";
        mh.style.borderRight = "2px solid var(--acc)";

        let i = 0;
        const type = setInterval(() => {
          mh.textContent = originalText.slice(0, i + 1);
          i++;
          if (i >= originalText.length) {
            clearInterval(type);
            setTimeout(() => {
              mh.style.borderRight = "";
            }, 500);
          }
        }, 45);
      }
    }, 300);
  }

  /* ══════════════════════════════════════
     14. LOGO EASTER EGG
         Click logo 3 times → big confetti party
     ══════════════════════════════════════ */
  function initLogoEasterEgg() {
    let clicks = 0;
    let timer;
    const logo = document.querySelector(".logo");
    if (!logo) return;

    logo.addEventListener("click", () => {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => {
        clicks = 0;
      }, 1000);

      if (clicks >= 3) {
        clicks = 0;
        // Mega party
        for (let i = 0; i < 5; i++) {
          setTimeout(() => {
            confettiBurst(
              Math.random() * window.innerWidth,
              Math.random() * window.innerHeight * 0.5,
            );
          }, i * 200);
        }
        const pill = document.createElement("div");
        pill.className = "cn-celebrate-pill";
        pill.innerHTML = `
          <div class="cn-pill-icon">🎉</div>
          <div class="cn-pill-text">
            <span class="cn-pill-main">Thanks for using ContextNote!</span>
            <span class="cn-pill-sub">You found the secret 🎊</span>
          </div>
        `;
        document.body.appendChild(pill);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => pill.classList.add("cn-pill-in")),
        );
        setTimeout(() => {
          pill.classList.remove("cn-pill-in");
          pill.classList.add("cn-pill-out");
          setTimeout(() => pill.remove(), 600);
        }, 4000);
      }
    });
  }

  /* ══════════════════════════════════════
     INJECT STYLES
     ══════════════════════════════════════ */
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      /* ── Ambient canvas sits behind everything ── */
      #cn-ambient { mix-blend-mode: screen; }

      /* ── Celebration pill ── */
      .cn-celebrate-pill {
        position: fixed;
        bottom: -120px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--sur);
        border: 1.5px solid color-mix(in srgb, var(--acc) 30%, transparent);
        border-radius: 20px;
        padding: 16px 24px;
        display: flex;
        align-items: center;
        gap: 16px;
        box-shadow:
          0 24px 60px rgba(0,0,0,0.18),
          0 0 0 1px var(--bdr),
          inset 0 1px 0 rgba(255,255,255,0.1);
        z-index: 9998;
        transition: bottom 0.6s cubic-bezier(0.16, 1, 0.3, 1),
                    opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        min-width: 280px;
        backdrop-filter: blur(16px);
      }
      .cn-celebrate-pill.cn-pill-in {
        bottom: 32px;
      }
      .cn-celebrate-pill.cn-pill-out {
        bottom: -120px;
        opacity: 0;
      }
      .cn-pill-icon {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--acc), var(--logo2, #8b5cf6));
        display: grid;
        place-items: center;
        font-size: 20px;
        flex-shrink: 0;
        box-shadow: 0 6px 18px color-mix(in srgb, var(--acc) 45%, transparent);
        animation: pillIconPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both;
      }
      @keyframes pillIconPop {
        from { transform: scale(0) rotate(-20deg); }
        to { transform: scale(1) rotate(0); }
      }
      .cn-pill-text {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .cn-pill-main {
        font-size: 14px;
        font-weight: 700;
        color: var(--ink);
        letter-spacing: -0.3px;
      }
      .cn-pill-sub {
        font-size: 12px;
        color: var(--mut);
      }

      /* ── Card entrance animation ── */
      .cn-card-enter {
        animation: cnCardBounce 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) var(--enter-delay, 0ms) both !important;
      }
      @keyframes cnCardBounce {
        from { opacity: 0; transform: translateY(28px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* ── Cursor sparkle ── */
      .cn-spark {
        position: fixed;
        border-radius: 50%;
        pointer-events: none;
        z-index: 9997;
        animation: sparkFly 0.7s ease-out forwards;
        transform: translate(-50%, -50%);
        mix-blend-mode: screen;
      }
      @keyframes sparkFly {
        0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); }
      }

      /* ── Ripple ── */
      .cn-ripple {
        position: absolute;
        border-radius: 50%;
        background: color-mix(in srgb, var(--acc) 25%, transparent);
        pointer-events: none;
        animation: cnRipple 0.55s ease-out forwards;
      }
      @keyframes cnRipple {
        from { opacity: 1; transform: scale(0); }
        to { opacity: 0; transform: scale(1); }
      }

      /* ── Sidebar indicator ── */
      .cn-nav-indicator {
        position: absolute;
        left: 2px;
        width: 3px;
        border-radius: 3px;
        background: linear-gradient(180deg, var(--acc), var(--logo2, #8b5cf6));
        opacity: 0;
        transition: top 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                    height 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                    opacity 0.2s;
        pointer-events: none;
        z-index: 10;
        box-shadow: 0 0 8px color-mix(in srgb, var(--acc) 60%, transparent);
      }

      /* ── Reveal animation ── */
      .cn-reveal {
        animation: cnReveal 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes cnReveal {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* ── Toast upgrade ── */
      .toast {
        display: flex !important;
        align-items: center;
        gap: 10px;
        flex-direction: row;
        padding: 14px 22px 18px !important;
        min-width: 220px;
        overflow: hidden;
      }
      .toast-emoji {
        font-size: 18px;
        flex-shrink: 0;
        animation: toastEmojiIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
      }
      @keyframes toastEmojiIn {
        from { transform: scale(0) rotate(-30deg); opacity: 0; }
        to { transform: scale(1) rotate(0); opacity: 1; }
      }
      .toast-msg {
        font-size: 13.5px;
        font-weight: 600;
        flex: 1;
      }
      .toast-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        width: 100%;
        background: linear-gradient(90deg, var(--acc), var(--logo2, #8b5cf6));
        border-radius: 0 0 12px 12px;
        transform-origin: left;
        animation: toastBarShrink linear forwards;
        opacity: 0.7;
      }
      @keyframes toastBarShrink {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
      .toast-danger .toast-bar {
        background: linear-gradient(90deg, #ef4444, #f97316);
      }
      .toast-danger {
        border-left: 3px solid #ef4444;
      }

      /* ── Logo glow pulse ── */
      .logo {
        animation: logoGlow 4s ease-in-out infinite;
      }
      @keyframes logoGlow {
        0%, 100% { box-shadow: 0 2px 12px color-mix(in srgb, var(--acc) 30%, transparent); }
        50% { box-shadow: 0 4px 24px color-mix(in srgb, var(--acc) 60%, transparent), 0 0 0 4px color-mix(in srgb, var(--acc) 10%, transparent); }
      }

      /* ── Shimmer on card hover (extra delight) ── */
      .card::after {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
        pointer-events: none;
        transition: left 0.5s ease;
      }
      .card:hover::after { left: 140%; }

      /* ── Section header animate in ── */
      .sech { animation: sechSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
      @keyframes sechSlide {
        from { opacity: 0; transform: translateX(-10px); }
        to { opacity: 1; transform: translateX(0); }
      }

      /* ── Save button pulse when form is valid ── */
      #saveEdit:not(:disabled),
      #saveAddNote:not(:disabled) {
        animation: savePulse 2.5s ease-in-out infinite;
      }
      @keyframes savePulse {
        0%, 100% { box-shadow: 0 4px 14px color-mix(in srgb, var(--acc) 35%, transparent); }
        50% { box-shadow: 0 6px 22px color-mix(in srgb, var(--acc) 55%, transparent), 0 0 0 4px color-mix(in srgb, var(--acc) 12%, transparent); }
      }

      /* ── Smooth note count badge ── */
      .bdg {
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      }

      /* ── Folder icon bounce on hover ── */
      .globe {
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s !important;
      }
      .sech:hover .globe {
        transform: scale(1.15) rotate(-8deg);
        background: color-mix(in srgb, var(--acc) 18%, transparent) !important;
      }

      /* ── Sidebar label glow on hover ── */
      .na:hover .nd {
        color: var(--ink);
      }
      .na.on {
        position: relative;
      }
      .na.on::after {
        content: '';
        position: absolute;
        right: -2px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 60%;
        background: white;
        border-radius: 2px;
        opacity: 0.5;
      }

      /* ── Settings panel items animate in ── */
      .sp-item {
        animation: spItemIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .sp-item:nth-child(1) { animation-delay: 0.05s; }
      .sp-item:nth-child(2) { animation-delay: 0.10s; }
      .sp-item:nth-child(3) { animation-delay: 0.15s; }
      @keyframes spItemIn {
        from { opacity: 0; transform: translateX(16px); }
        to { opacity: 1; transform: translateX(0); }
      }

      /* ── View more button shimmer ── */
      .btn-view-more {
        position: relative;
        overflow: hidden;
      }
      .btn-view-more::after {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 50%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        animation: btnShimmer 2.5s ease-in-out infinite;
      }
      @keyframes btnShimmer {
        0% { left: -100%; }
        60%, 100% { left: 200%; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════
     INIT — run everything
     ══════════════════════════════════════ */
  function init() {
    injectStyles();
    createAmbientParticles();
    initCursorSparkle();
    initRipple();
    initMagneticButtons();
    initCardTilt();
    initCardRippleEntrance();
    initCounterAnimations();
    initSidebarIndicator();
    initPageLoadSequence();
    initLogoEasterEgg();
    upgradeToast();

    // Typewriter after a short delay (wait for notes to load)
    setTimeout(initWelcomeTypewriter, 800);

    // Expose celebration for external use
    window.CN_Celebrate = {
      noteSaved: noteSavedCelebration,
      confetti: confettiBurst,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
