(() => {
  let S = { ...DEFAULTS };

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const loadSettings = () => {
    try {
      chrome.storage.sync.get(DEFAULTS).then((s) => (S = s)).catch(() => {});
    } catch {}
  };
  loadSettings();
  try {
    chrome.storage.onChanged.addListener(loadSettings);
  } catch {}

  const t = (key, ...subs) => {
    try {
      return chrome.i18n.getMessage(key, subs.map(String)) || key;
    } catch {
      return key;
    }
  };
  const STALE = "__stale__";

  // ---------- Detecção de imagens ----------
  const bgUrl = (el) => {
    const m = getComputedStyle(el).backgroundImage.match(/url\((["']?)(.*?)\1\)/);
    return m ? m[2] : null;
  };

  function imageOf(el) {
    if (!el || !el.tagName) return null;
    if (el.tagName === "IMG") return { url: el.currentSrc || el.src, el };
    if (el.tagName === "VIDEO" && el.poster) return { url: el.poster, el };
    if (el instanceof SVGImageElement && el.href?.baseVal) return { url: el.href.baseVal, el };
    if (el instanceof HTMLElement && el !== document.body && el !== document.documentElement) {
      const bg = bgUrl(el);
      if (bg) return { url: bg, el };
    }
    return null;
  }

  // Varre a pilha de elementos sob o ponto: acha imagens mesmo com overlays por cima.
  function findImage(x, y, target) {
    const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [target];
    for (const el of stack) {
      const f = imageOf(el);
      if (f && f.url) return f;
    }
    return null;
  }

  const absUrl = (u) => new URL(u, location.href).href;

  // Restrições de tamanho e domínio (não valem para o Hover Hotkey, exceto domínios).
  function passes(f) {
    const r = f.el.getBoundingClientRect();
    const w = f.el.naturalWidth || r.width;
    const h = f.el.naturalHeight || r.height;
    if (w < S.minSize || h < S.minSize) return false;
    if (!listAllows(S.pageMode, S.pageDomains, location.hostname)) return false;
    try {
      const u = new URL(f.url, location.href);
      if (/^https?:$/.test(u.protocol) && !listAllows(S.imageMode, S.imageDomains, u.hostname)) return false;
    } catch {}
    return true;
  }

  // ---------- UI (toast + botão) em shadow DOM ----------
  let host, toastEl, btn, toastTimer;
  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .toast{position:fixed;right:16px;bottom:16px;max-width:360px;padding:8px 14px;border-radius:6px;font:13px system-ui,sans-serif;color:#fff;background:#222;opacity:0;transition:opacity .2s;pointer-events:none}
      .toast.show{opacity:.95}.toast.err{background:#b3261e}.toast.ok{background:#1b6e3c}
      .btn{position:fixed;display:none;border:0;padding:0;cursor:pointer;color:#fff;align-items:center;justify-content:center;transition:opacity .15s}
      .btn svg{width:60%;height:60%;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
      .btn.original{background:#000;border-radius:6px}
      .btn.alt{background:#1a73e8;border-radius:50%}
      .btn.drag{outline:3px solid #fff}
    </style><div class="toast"></div>
    <button class="btn" title="Download"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button>`;
    toastEl = root.querySelector(".toast");
    btn = root.querySelector(".btn");
    btn.title = t("menuImage");
    (document.body || document.documentElement).appendChild(host);

    btn.addEventListener("mouseenter", () => {
      clearTimeout(hideTimer);
      btn.style.opacity = 1;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.opacity = S.hoverOpacity / 100;
      scheduleHide();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (hoverImg) download({ url: hoverImg.currentSrc || hoverImg.src, el: hoverImg });
    });
    btn.addEventListener("dragenter", (e) => {
      if (!S.hoverDrop) return;
      e.preventDefault();
      clearTimeout(hideTimer);
      btn.classList.add("drag");
    });
    btn.addEventListener("dragover", (e) => S.hoverDrop && e.preventDefault());
    btn.addEventListener("dragleave", () => btn.classList.remove("drag"));
    btn.addEventListener("drop", (e) => {
      btn.classList.remove("drag");
      if (!S.hoverDrop) return;
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      const uri = (dt.getData("text/uri-list") || "").split("\n").find((l) => l && !l.startsWith("#"));
      const text = (dt.getData("text/plain") || "").trim();
      const url = uri || (/^(https?:|data:image)/.test(text) ? text : null) || (hoverImg && (hoverImg.currentSrc || hoverImg.src));
      if (url) download({ url, el: hoverImg });
    });
  }

  function toast(text, kind = "") {
    ensureHost();
    toastEl.textContent = text;
    toastEl.className = "toast show " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = "toast"), 2800);
  }

  // ---------- Download ----------
  function grey(el, on) {
    if (!S.greyOut || !el || !el.style) return;
    if (on) {
      el.__dlPrev = [el.style.opacity, el.style.filter];
      el.style.opacity = "0.4";
      el.style.filter = "grayscale(1)";
    } else if (el.__dlPrev) {
      [el.style.opacity, el.style.filter] = el.__dlPrev;
      delete el.__dlPrev;
    }
  }

  async function download(f) {
    if (!f || !f.url) return;
    if (!alive()) return toast(t("toastStale"), "err");
    let url;
    try {
      url = absUrl(f.url);
    } catch {
      return;
    }
    grey(f.el, true);
    toast(t("toastDownloading"));
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: "download", url, pageUrl: location.href, title: document.title });
    } catch (e) {
      r = { ok: false, error: /invalidated|Receiving end/i.test(e.message) ? STALE : e.message };
    } finally {
      grey(f.el, false);
    }
    if (r?.ok) toast(t("toastDone"), "ok");
    else toast(r?.error === STALE ? t("toastStale") : t("toastFailed", r?.error || t("errUnknown")), "err");
  }

  // ---------- Botão ao passar o mouse ----------
  let hoverImg = null;
  let hideTimer;
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    if (S.hoverPersist) return;
    hideTimer = setTimeout(() => btn && (btn.style.display = "none"), 400);
  };

  function showButtonFor(img) {
    if (!S.hoverEnabled || !alive()) return;
    const f = { url: img.currentSrc || img.src, el: img };
    if (!f.url || !passes(f)) return;
    ensureHost();
    hoverImg = img;
    clearTimeout(hideTimer);
    const r = img.getBoundingClientRect();
    const L = Math.max(r.left, 0), T = Math.max(r.top, 0);
    const R = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight);
    const size = S.hoverSize, pad = 6;
    const pos = {
      "top-left": [L + pad, T + pad],
      "top-right": [R - size - pad, T + pad],
      "bottom-left": [L + pad, B - size - pad],
      "bottom-right": [R - size - pad, B - size - pad],
      center: [(L + R - size) / 2, (T + B - size) / 2],
    }[S.hoverPos] || [L + pad, T + pad];
    btn.className = "btn " + (S.hoverSkin === "alt" ? "alt" : "original");
    Object.assign(btn.style, {
      display: "flex",
      width: size + "px",
      height: size + "px",
      left: pos[0] + "px",
      top: pos[1] + "px",
      opacity: S.hoverOpacity / 100,
    });
  }

  // ---------- Rastreamento do cursor ----------
  let lastX = 0, lastY = 0, lastTarget = null, inside = false, raf = 0;

  document.addEventListener(
    "mouseover",
    (e) => {
      if (e.target === host) return;
      lastTarget = e.target;
      inside = true;
      if (e.target instanceof HTMLImageElement) showButtonFor(e.target);
    },
    true
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      if (e.target === hoverImg) scheduleHide();
    },
    true
  );
  document.addEventListener(
    "mousemove",
    (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      inside = true;
      if (!S.aggressive || !S.hoverEnabled || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const f = findImage(lastX, lastY, lastTarget);
        if (f && f.el.tagName === "IMG") showButtonFor(f.el);
      });
    },
    { capture: true, passive: true }
  );
  document.documentElement.addEventListener("mouseleave", () => (inside = false));
  document.addEventListener("scroll", () => btn && (btn.style.display = "none"), true);

  // ---------- Gatilhos de mouse ----------
  let lastHit = { t: 0, url: "" };

  function triggered(e, f) {
    const now = Date.now();
    const again = lastHit.url === f.url && now - lastHit.t <= S.triggerDelay;
    lastHit = again ? { t: 0, url: "" } : { t: now, url: f.url };
    return again;
  }

  function mouseTrigger(e, expectButton, single) {
    if (e.target === host || !alive()) return false;
    if (S.requireShift && !e.shiftKey) return false;
    const f = findImage(e.clientX, e.clientY, e.target);
    if (!f || !passes(f)) return false;
    if (!single && !triggered(e, f)) {
      // primeiro clique do duplo: só registra (contextmenu é suprimido pelo chamador)
      return "first";
    }
    download(f);
    return true;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || (S.trigger !== "single-left" && S.trigger !== "double-left")) return;
      const r = mouseTrigger(e, 0, S.trigger === "single-left");
      if (r === true) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  document.addEventListener(
    "dblclick",
    (e) => {
      // evita seleção/zoom nativo quando duplo clique é o gatilho
      if (S.trigger !== "double-left" || e.target === host) return;
      const f = findImage(e.clientX, e.clientY, e.target);
      if (f && passes(f) && (!S.requireShift || e.shiftKey)) e.preventDefault();
    },
    true
  );
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (S.trigger !== "single-right" && S.trigger !== "double-right") return;
      const r = mouseTrigger(e, 2, S.trigger === "single-right");
      if (r) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // ---------- Mensagens do background ----------
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "toast") {
        toast(msg.text, msg.kind);
      } else if (msg.type === "hotkey") {
        if (!inside) return;
        const f = S.aggressive ? findImage(lastX, lastY, lastTarget) : imageOf(lastTarget);
        if (f && f.url) download(f);
      } else if (msg.type === "getSelectionImages") {
        const sel = getSelection();
        const urls = new Set();
        for (let i = 0; sel && i < sel.rangeCount; i++) {
          const range = sel.getRangeAt(i);
          document.querySelectorAll("img").forEach((img) => {
            const f = { url: img.currentSrc || img.src, el: img };
            if (f.url && range.intersectsNode(img) && passes(f)) urls.add(absUrl(f.url));
          });
        }
        sendResponse([...urls]);
      }
    });
  } catch {}
})();
