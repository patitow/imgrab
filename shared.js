const DEFAULTS = {
  notify: false,
  greyOut: false,
  ctxImage: true,
  ctxSelection: true,

  requireShift: false,
  minSize: 105,
  pageDomains: "",
  pageMode: "blacklist",
  imageDomains: "",
  imageMode: "blacklist",

  hoverEnabled: true,
  hoverDrop: true,
  hoverSkin: "original",
  hoverSize: 36,
  hoverOpacity: 25,
  hoverPersist: false,
  hoverPos: "top-left",

  folder: "ImageDownloader",
  renameEnabled: false,
  pattern: "%original%",
  counterStart: 1,
  counterStep: 1,
  counterDigits: 1,

  conflict: "uniquify",
  trigger: "disabled",
  triggerDelay: 250,
  aggressive: false,
};

const sanitizeSeg = (s) =>
  String(s)
    .replace(/[<>:"\\|?*\x00-\x1f]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 100);

// "*" casa exatamente um nível; o domínio deve casar por inteiro.
function domainMatches(patterns, host) {
  host = (host || "").toLowerCase();
  return patterns.some((p) => {
    const re = p
      .toLowerCase()
      .split("*")
      .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^.]+");
    return new RegExp("^" + re + "$").test(host);
  });
}

// Lista vazia = sem restrição.
function listAllows(mode, text, host) {
  const patterns = String(text || "").split(/\s+/).filter(Boolean);
  if (!patterns.length || !host) return true;
  const hit = domainMatches(patterns, host);
  return mode === "whitelist" ? hit : !hit;
}

function renderFilename(s, c) {
  const now = c.now || new Date();
  const tryUrl = (u) => {
    try {
      return new URL(u);
    } catch {
      return null;
    }
  };
  const iu = tryUrl(c.url);
  const pu = tryUrl(c.pageUrl);
  const dirsOf = (u) =>
    u
      ? decodeURIComponentSafe(u.pathname)
          .split("/")
          .filter(Boolean)
      : [];

  let base = "image";
  let ext = "jpg";
  let imageDirs = [];
  if (/^data:image\//i.test(c.url)) {
    const m = c.url.match(/^data:image\/([a-z0-9]+)/i);
    if (m) ext = m[1].toLowerCase().replace("jpeg", "jpg");
  } else if (iu && /^https?:$/.test(iu.protocol)) {
    const segs = dirsOf(iu);
    const last = segs.pop() || iu.hostname;
    imageDirs = segs;
    const m = last.match(/^(.*)\.([a-z0-9]{2,5})$/i);
    base = m ? m[1] : last;
    if (m) ext = m[2].toLowerCase();
  }
  const pageDirs = dirsOf(pu);

  const t = {
    original: base,
    counter: c.counter ?? "",
    pagedomain: pu ? pu.hostname : "",
    pagedirs: pageDirs.join("/"),
    pagepath: pageDirs.join("."),
    imagedomain: iu ? iu.hostname : "",
    imagedirs: imageDirs.join("/"),
    imagepath: imageDirs.join("."),
    y: now.getFullYear(),
    M: now.getMonth() + 1,
    d: now.getDate(),
    h: now.getHours(),
    m: now.getMinutes(),
    s: now.getSeconds(),
    ms: now.getMilliseconds(),
    title: c.title || "",
  };

  const pattern = s.renameEnabled && s.pattern ? s.pattern : "%original%";
  const rendered = pattern.replace(/%(\w+)%/g, (m, k) => (k in t ? t[k] : m));
  const parts = rendered.split("/").map(sanitizeSeg).filter((p) => p && p !== "..");
  if (!parts.length) parts.push("image");
  parts[parts.length - 1] += "." + ext;

  const folder = String(s.folder || "")
    .split("/")
    .map(sanitizeSeg)
    .filter(Boolean);
  return [...folder, ...parts].join("/");
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
