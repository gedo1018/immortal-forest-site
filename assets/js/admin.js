/* =========================================================
   仙人森林 · IMMORTAL FOREST — visual product admin
   Fills window.PRODUCTS-shaped objects, stores a draft in
   localStorage, and can export a drop-in products-data.js.
   ========================================================= */
(function () {
  "use strict";
  const KEY = "if-admin-products";
  const ICONS = {
    stationery: '<path d="M12 19l7-7 3 3-7 7-3-3Z"/><path d="m2 12 3-3 7 7-3 3-7-7Z"/><path d="m7 5 3-3 7 7-3 3-7-7Z"/>',
    device: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    furniture: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    digital: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    consumable: '<path d="M9 3h6v4l-2 2v3l3 3v6H8v-6l3-3V9L9 7Z"/><path d="M7 3v2M17 3v2"/>'
  };
  const CAT_LABELS = { stationery: "文具纸张", device: "办公设备", furniture: "家具收纳", digital: "数字办公", consumable: "清洁耗材" };

  let state = load();
  let imgData = "";

  const $ = id => document.getElementById(id);
  const form = $("product-form"), list = $("product-list"), count = $("count"),
        hint = $("hint"), imgInput = $("img"), preview = $("img-preview");

  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(d) ? d : []; }
    catch (e) { return []; }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderList() {
    count.textContent = state.length;
    if (!state.length) {
      list.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;padding:10px 0;">还没有产品，左侧填写后点「添加产品」。</p>';
      return;
    }
    list.innerHTML = state.map((p, i) => {
      const thumb = p.img
        ? '<img class="ic" src="' + p.img + '" alt="" />'
        : '<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[p.cat] || ICONS.stationery) + "</svg></span>";
      const name = (p.zh && p.zh.name) || (p.en && p.en.name) || "未命名";
      const sub = CAT_LABELS[p.cat] || p.cat;
      return '<div class="admin-card"><div>' + thumb + '</div>' +
        '<div class="meta"><b>' + esc(name) + '</b><span>' + esc(sub) + '</span></div>' +
        '<button class="del" data-i="' + i + '" title="删除" aria-label="删除">✕</button></div>';
    }).join("");
  }

  function setHint(msg, color) { hint.textContent = msg; hint.style.color = color || "var(--text-dim)"; }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const zhName = $("zh-name").value.trim(), enName = $("en-name").value.trim(), cat = $("cat").value;
    if (!zhName || !enName) { setHint("中文名称和英文名称为必填项。", "#ff6b6b"); return; }
    const p = {
      cat: cat,
      zh: { name: zhName, desc: $("zh-desc").value.trim(), price: $("zh-price").value.trim() },
      en: { name: enName, desc: $("en-desc").value.trim(), price: $("en-price").value.trim() },
      spec: { moq: $("moq").value.trim(), lead: $("lead").value.trim(), term: $("term").value.trim() },
      img: imgData
    };
    state.push(p); save(); renderList();
    form.reset(); imgData = ""; preview.hidden = true;
    setHint("已添加。继续添加，或导出 / 预览。", "var(--text-dim)");
  });

  list.addEventListener("click", e => {
    const b = e.target.closest(".del");
    if (!b) return;
    const i = +b.dataset.i;
    state.splice(i, 1); save(); renderList();
  });

  imgInput.addEventListener("change", () => {
    const f = imgInput.files[0];
    if (!f) return;
    if (f.size > 300000) setHint("图片较大（" + (f.size / 1024 | 0) + "KB），建议压到 200KB 内再上传，避免导出文件过大。", "#ffb86b");
    const r = new FileReader();
    r.onload = () => { imgData = r.result; preview.src = imgData; preview.hidden = false; };
    r.readAsDataURL(f);
  });

  $("export-btn").addEventListener("click", () => {
    if (!state.length) { setHint("还没有产品可导出。", "#ff6b6b"); return; }
    const blob = new Blob(["window.PRODUCTS = " + JSON.stringify(state, null, 2) + ";\n"], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "products-data.js"; a.click();
    URL.revokeObjectURL(a.href);
    setHint("已下载 products-data.js：把它放进项目 assets/js/ 覆盖原文件，重新部署即可上线。", "var(--text-dim)");
  });

  $("copy-btn").addEventListener("click", async () => {
    if (!state.length) { setHint("还没有产品可复制。", "#ff6b6b"); return; }
    try { await navigator.clipboard.writeText(JSON.stringify(state, null, 2)); setHint("已复制 JSON 到剪贴板，可发给我帮你合并上线。", "var(--text-dim)"); }
    catch (e) { setHint("复制失败，请改用「导出」下载文件。", "#ff6b6b"); }
  });

  $("import-file").addEventListener("change", () => {
    const f = $("import-file").files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (Array.isArray(d)) { state = d; save(); renderList(); setHint("已导入 " + d.length + " 个产品。"); }
        else setHint("JSON 格式不对：应为产品数组。", "#ff6b6b");
      } catch (e) { setHint("解析失败，请检查 JSON。", "#ff6b6b"); }
    };
    r.readAsText(f);
  });

  $("preview-zh").addEventListener("click", () => { save(); window.open("products.html?draft=1", "_blank"); });
  $("preview-en").addEventListener("click", () => { save(); window.open("en/products.html?draft=1", "_blank"); });

  $("clear-btn").addEventListener("click", () => {
    if (!state.length) return;
    if (confirm("确定清空所有已添加产品？此操作不可撤销。")) { state = []; save(); renderList(); setHint("已清空。"); }
  });

  renderList();
})();
