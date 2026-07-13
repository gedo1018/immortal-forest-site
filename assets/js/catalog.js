/* =========================================================
   仙人森林 · IMMORTAL FOREST — product catalog renderer
   Data-driven. Loads /api/products (a Cloudflare Function that
   reads the Feishu sheet in real time; it falls back to the
   committed /products.json when Feishu is unreachable).
   Falls back to window.PRODUCTS (assets/js/products-data.js) when offline.
   Language is derived from <html lang>.
   ========================================================= */
(async function () {
  "use strict";
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  const lang = (root.lang || "zh-CN").toLowerCase().startsWith("en") ? "en" : "zh";

  const CAT_LABELS = {
    zh: { stationery: "文具纸张", device: "办公设备", furniture: "家具收纳", digital: "数字办公", consumable: "清洁耗材" },
    en: { stationery: "Stationery", device: "Devices", furniture: "Furniture", digital: "Digital Office", consumable: "Cleaning" }
  };
  const ICONS = {
    stationery: '<path d="M12 19l7-7 3 3-7 7-3-3Z"/><path d="m2 12 3-3 7 7-3 3-7-7Z"/><path d="m7 5 3-3 7 7-3 3-7-7Z"/>',
    device: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    furniture: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    digital: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    consumable: '<path d="M9 3h6v4l-2 2v3l3 3v6H8v-6l3-3V9L9 7Z"/><path d="M7 3v2M17 3v2"/>'
  };

  // ---- data source: /api/products (Cloudflare Function -> Feishu) ----
  let data = [];
  try {
    const res = await fetch("/api/products", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      data = Array.isArray(json) ? json : (json.products || []);
    }
  } catch (e) { /* offline or function missing -> use fallback */ }

  // legacy local-editor draft preview (?draft=1) — kept for compatibility
  if (new URLSearchParams(location.search).has("draft")) {
    try {
      const d = JSON.parse(localStorage.getItem("if-admin-products") || "null");
      if (Array.isArray(d) && d.length) data = d;
    } catch (e) { /* ignore */ }
  }

  if (!data.length) data = window.PRODUCTS || [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  // Bilingual category label: prefer per-product catLabel (from Feishu),
  // fall back to built-in CAT_LABELS, then to the raw code.
  function catLabelOf(p) {
    const L = p.catLabel || {};
    if (L[lang]) return L[lang];
    const labels = CAT_LABELS[lang] || CAT_LABELS.zh;
    if (labels[p.cat]) return labels[p.cat];
    return p.cat;
  }
  function thumb(p) {
    // Always render the branded placeholder layer underneath.
    // The real image (if any) sits on top; on load failure we hide it and the
    // placeholder shows through — so a broken/external URL never shows a broken icon.
    const ph = '<span class="thumb-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[p.cat] || ICONS.stationery) + "</svg></span>";
    if (p.img) {
      return ph + '<img class="thumb-img" src="' + esc(p.img) + '" alt="' + esc((p[lang] || p.zh).name) + '" loading="lazy" decoding="async">';
    }
    return ph;
  }
  function specLine(p) {
    const s = p.spec || {};
    if (!s.moq && !s.lead && !s.term) return "";
    const t = lang === "en"
      ? "MOQ <b>" + esc(s.moq) + "</b> · Lead <b>" + esc(s.lead) + "</b> · <b>" + esc(s.term) + "</b>"
      : "MOQ <b>" + esc(s.moq) + "</b> · 交期 <b>" + esc(s.lead) + "</b> · <b>" + esc(s.term) + "</b>";
    return '<div class="spec">' + t + "</div>";
  }
  function cardHTML(p) {
    const L = p[lang] || p.zh;
    return '<article class="prod spotlight reveal" data-cat="' + esc(p.cat) + '">' +
      '<div class="thumb">' + thumb(p) + "</div>" +
      '<span class="tag">' + esc(catLabelOf(p)) + "</span>" +
      "<h3>" + esc(L.name) + "</h3>" +
      "<p>" + esc(L.desc) + "</p>" +
      '<div class="price">' + esc(L.price) + "</div>" +
      specLine(p) +
      "</article>";
  }

  grid.innerHTML = data.map(cardHTML).join("");
  const cards = Array.prototype.slice.call(grid.querySelectorAll(".prod"));

  // Image error fallback: if an (external/R2) image fails to load, hide it so the
  // branded placeholder layer behind it shows through instead of a broken-image icon.
  grid.querySelectorAll(".thumb-img").forEach(img => {
    img.addEventListener("error", () => {
      const t = img.closest(".thumb");
      if (t) t.classList.add("img-fail");
    });
  });

  // ---- scroll reveal ----
  if (reduce || !("IntersectionObserver" in window)) {
    cards.forEach(c => c.classList.add("in"));
  } else {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    cards.forEach(c => io.observe(c));
  }

  // ---- spotlight follow ----
  if (!reduce && window.matchMedia("(pointer:fine)").matches) {
    cards.forEach(card => {
      card.addEventListener("mousemove", e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }

  // ---- category filter (dynamic: generated from live data) ----
  const filterBar = document.getElementById("filterBar");
  if (filterBar) {
    // Extract unique categories from data, preserving first-seen order;
    // also remember each category's bilingual label (first product wins).
    const seen = {};
    const cats = [];
    const catLabelsMap = {};
    for (const p of data) {
      const c = p.cat;
      if (c && !seen[c]) { seen[c] = true; cats.push(c); }
      if (c && (p.catLabel && (p.catLabel.zh || p.catLabel.en)) && !catLabelsMap[c]) {
        catLabelsMap[c] = p.catLabel;
      }
    }

    // Build dynamic filter buttons (after the "全部" button)
    const frag = document.createDocumentFragment();
    cats.forEach(c => {
      const btn = document.createElement("button");
      btn.className = "filter";
      btn.dataset.cat = c;
      btn.textContent = catLabelOf({ cat: c, catLabel: catLabelsMap[c] });
      frag.appendChild(btn);
    });
    filterBar.appendChild(frag);

    // Bind click events to ALL filters (including "全部")
    const filters = filterBar.querySelectorAll(".filter");
    filters.forEach(f => f.addEventListener("click", () => {
      filters.forEach(x => x.classList.remove("active"));
      f.classList.add("active");
      const cat = f.dataset.cat;
      cards.forEach(c => c.classList.toggle("hide", !(cat === "all" || c.dataset.cat === cat)));
    }));
  }
})();
