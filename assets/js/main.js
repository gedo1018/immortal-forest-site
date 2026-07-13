/* =========================================================
   仙人森林 · IMMORTAL FOREST — interaction engine
   ========================================================= */
(function () {
  "use strict";
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme (light / dark / system) ---------- */
  const KEY = "if-theme";
  const saved = localStorage.getItem(KEY) || "system";
  function applyTheme(mode) {
    if (mode === "system") {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", dark ? "dark" : "light");
    } else {
      root.setAttribute("data-theme", mode);
    }
  }
  applyTheme(saved);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem(KEY) || "system") === "system") applyTheme("system");
  });

  const toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const cur = root.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem(KEY, next);
    });
  }

  /* ---------- Nav scrolled + mobile menu ---------- */
  const nav = document.querySelector(".nav");
  const onScroll = () => { if (nav) nav.classList.toggle("scrolled", window.scrollY > 12); };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const burger = document.querySelector(".nav-burger");
  if (burger && nav) {
    burger.addEventListener("click", () => nav.classList.toggle("menu-open"));
    nav.querySelectorAll(".nav-links a").forEach(a =>
      a.addEventListener("click", () => nav.classList.remove("menu-open")));
  }

  /* ---------- Active nav link by page ---------- */
  const page = document.body.dataset.page;
  if (page) {
    document.querySelectorAll(".nav-links a").forEach(a => {
      if (a.dataset.page === page) a.classList.add("active");
    });
  }

  /* ---------- Magnetic buttons ---------- */
  if (!reduce && window.matchMedia("(pointer:fine)").matches) {
    document.querySelectorAll("[data-magnetic]").forEach(el => {
      const strength = 0.35;
      el.addEventListener("mousemove", e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * strength;
        const y = (e.clientY - r.top - r.height / 2) * strength;
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------- Scroll reveal ---------- */
  const reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(r => r.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(r => io.observe(r));
  }

  /* Product card spotlight + filter are now handled by assets/js/catalog.js */

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll(".faq-item").forEach(item => {
    const q = item.querySelector(".faq-q");
    const a = item.querySelector(".faq-a");
    q.addEventListener("click", () => {
      const open = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(o => {
        if (o !== item) { o.classList.remove("open"); o.querySelector(".faq-a").style.maxHeight = null; }
      });
      item.classList.toggle("open", !open);
      a.style.maxHeight = open ? null : a.scrollHeight + "px";
    });
  });

  /* Product filter is now handled by assets/js/catalog.js */

  /* ---------- Contact form ---------- */
  const form = document.querySelector("#contact-form");
  if (form) {
    const status = form.querySelector(".form-status");
    const submitBtn = form.querySelector('button[type="submit"]');
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    form.addEventListener("submit", e => {
      e.preventDefault();
      let ok = true;
      form.querySelectorAll("[required]").forEach(input => {
        const field = input.closest(".form-field");
        let valid = input.value.trim() !== "";
        if (valid && input.type === "email") valid = emailRe.test(input.value.trim());
        field.classList.toggle("invalid", !valid);
        if (!valid) ok = false;
      });
      if (!ok) {
        status.textContent = "请检查标红的必填项。";
        status.className = "form-status bad";
        return;
      }
      submitBtn.disabled = true;
      const label = submitBtn.querySelector(".lbl");
      const orig = label ? label.textContent : submitBtn.textContent;
      if (label) label.textContent = "发送中…";

      try {
        const resp = await fetch("/api/contact", {
          method: "POST",
          headers: { "Accept": "application/json" },
          body: new FormData(form),
        });
        if (resp.ok) {
          status.textContent = "已收到您的信息，我们的顾问将在 1 个工作日内与您联系 ✦";
          status.className = "form-status ok";
          form.reset();
        } else {
          throw new Error("server " + resp.status);
        }
      } catch (err) {
        status.textContent = "发送失败，请稍后重试或直接邮件联系我们。";
        status.className = "form-status bad";
      } finally {
        submitBtn.disabled = false;
        if (label) label.textContent = orig;
      }
    });
  }

  /* =========================================================
     Particle / aurora canvas (forest motes + constellation)
     ========================================================= */
  const canvas = document.getElementById("hero-canvas");
  if (canvas && !reduce) {
    const ctx = canvas.getContext("2d");
    let w, h, dpr, particles = [], raf, mouse = { x: -999, y: -999 };
    const accent = getComputedStyle(root).getPropertyValue("--emerald").trim() || "#2bd47d";

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.floor((w * h) / 16000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.6,
        a: Math.random() * 0.5 + 0.2
      }));
    }

    function step() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 120) { p.x += dx / dist * 0.6; p.y += dy / dist * 0.6; }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = accent; ctx.globalAlpha = p.a; ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < 130) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = accent; ctx.globalAlpha = (1 - d / 130) * 0.18; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(step);
    }

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener("mouseleave", () => { mouse.x = -999; mouse.y = -999; });
    window.addEventListener("resize", resize);
    resize(); step();

    // pause when offscreen
    const heroIO = new IntersectionObserver(es => {
      es.forEach(en => {
        if (en.isIntersecting) { if (!raf) step(); }
        else { cancelAnimationFrame(raf); raf = null; }
      });
    }, { threshold: 0 });
    heroIO.observe(canvas);
  }

  /* ---------- Rotating hero word ---------- */
  const rot = document.querySelector("[data-rotate]");
  if (rot && !reduce) {
    const words = JSON.parse(rot.dataset.rotate);
    let i = 0;
    setInterval(() => {
      i = (i + 1) % words.length;
      rot.style.opacity = 0;
      setTimeout(() => { rot.textContent = words[i]; rot.style.opacity = 1; }, 280);
    }, 2600);
  }
})();
