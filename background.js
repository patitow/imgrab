importScripts("shared.js");

const getSettings = () => chrome.storage.sync.get(DEFAULTS);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

let nextRuleId = 1;

// Regras de sessão sobrevivem ao service worker, mas não ao restart do browser.
chrome.runtime.onStartup.addListener(async () => {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
});

async function addRefererRule(url, referer) {
  const id = (nextRuleId = (nextRuleId % 100000) + 1);
  const origin = new URL(referer).origin;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "referer", operation: "set", value: referer },
            { header: "origin", operation: "set", value: origin },
          ],
        },
        condition: {
          urlFilter: "|" + url.split("#")[0] + "|",
          resourceTypes: ["other", "xmlhttprequest", "image", "media"],
        },
      },
    ],
  });
  return id;
}

const removeRule = (id) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});

function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    const onChanged = async (delta) => {
      if (delta.id !== downloadId || !delta.state || delta.state.current === "in_progress") return;
      chrome.downloads.onChanged.removeListener(onChanged);
      const [item] = await chrome.downloads.search({ id: downloadId });
      resolve(item);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item && item.state !== "in_progress") {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(item);
      }
    });
  });
}

// Tenta baixar com um Referer específico. Retorna {ok, error, filename}.
async function tryDownload(url, filename, referer, s) {
  let ruleId = null;
  try {
    if (referer) ruleId = await addRefererRule(url, referer);
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: s.conflict,
      saveAs: s.conflict === "prompt",
    });
    const item = await waitForDownload(downloadId);

    if (item.state !== "complete") {
      const canceled = /USER_CANCELED/.test(item.error || "");
      return { ok: false, canceled, error: canceled ? t("errCanceled") : item.error || t("errInterrupted") };
    }

    // O servidor pode responder com JSON/HTML de erro: confere o tipo do arquivo.
    const mime = item.mime || "";
    if (mime && !/^(image|video|audio)\//.test(mime) && mime !== "application/octet-stream") {
      await chrome.downloads.removeFile(downloadId).catch(() => {});
      await chrome.downloads.erase({ id: downloadId });
      return { ok: false, error: t("errNotImage", mime) };
    }
    return { ok: true, filename: item.filename };
  } catch (e) {
    const canceled = /cancel/i.test(String(e.message));
    return { ok: false, canceled, error: String(e.message || e) };
  } finally {
    if (ruleId !== null) removeRule(ruleId);
  }
}

const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp" };

function fixExt(filename, mime) {
  const want = MIME_EXT[mime];
  if (!want) return filename;
  const m = filename.match(/\.([a-z0-9]{2,5})$/i);
  const have = m && m[1].toLowerCase().replace("jpeg", "jpg");
  if (have === want) return filename;
  return m ? filename.slice(0, -m[0].length) + "." + want : filename + "." + want;
}

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Buscar a imagem com Referer customizado e salvá-la como blob.",
  });
}

// Busca a imagem (fetch com Referer forçado) e salva via blob: URL.
async function fetchAndSave(url, filename, referer, s) {
  let ruleId = null;
  let blobUrl = null;
  try {
    await ensureOffscreen();
    if (referer) ruleId = await addRefererRule(url, referer);
    const r = await chrome.runtime.sendMessage({ target: "offscreen", type: "fetch", url });
    if (ruleId !== null) {
      await removeRule(ruleId);
      ruleId = null;
    }
    if (!r?.ok) return { ok: false, error: r?.error || t("errFetch") };
    blobUrl = r.blobUrl;
    const res = await tryDownload(blobUrl, fixExt(filename, r.mime), null, s);
    return res;
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    if (ruleId !== null) removeRule(ruleId);
    if (blobUrl) chrome.runtime.sendMessage({ target: "offscreen", type: "revoke", url: blobUrl }).catch(() => {});
  }
}

async function nextCounter(s) {
  const { counter } = await chrome.storage.session.get("counter");
  const n = counter ?? s.counterStart;
  await chrome.storage.session.set({ counter: n + s.counterStep });
  return String(n).padStart(Math.max(1, s.counterDigits), "0");
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
  } catch {}
}

// X/Twitter serve miniaturas por padrão (name=small/large); pede a original.
function upgradeUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/") && u.searchParams.get("name") !== "orig") {
      u.searchParams.set("name", "orig");
      return u.href;
    }
  } catch {}
  return url;
}

async function runDownload(url, pageUrl, title) {
  url = upgradeUrl(url);
  const s = await getSettings();
  const counter = s.renameEnabled && s.pattern.includes("%counter%") ? await nextCounter(s) : "";
  const filename = renderFilename(s, { url, pageUrl, title, counter });

  // Ordem: Referer da origem da imagem (resolve a maioria dos anti-hotlink),
  // Referer da página, e por fim sem alteração.
  const referers = [];
  if (/^https?:/.test(url)) {
    const origin = new URL(url).origin + "/";
    referers.push(origin);
    if (pageUrl && /^https?:/.test(pageUrl) && new URL(pageUrl).origin + "/" !== origin) referers.push(pageUrl);
  }
  referers.push(null);

  let last;
  const errors = [];
  for (const ref of referers) {
    // Com Referer: fetch + blob (a regra de header só vale de forma confiável no fetch).
    // Sem Referer (último recurso, ou data:/blob:): download direto.
    last = ref ? await fetchAndSave(url, filename, ref, s) : await tryDownload(url, filename, null, s);
    if (last.ok || last.canceled) break;
    errors.push(last.error);
  }
  if (!last.ok && !last.canceled) last.error = errors.join(" | ");
  if (last.ok && s.notify) notify(t("notifDoneTitle"), last.filename.split(/[\\/]/).pop());
  if (!last.ok && !last.canceled && s.notify) notify(t("notifFailTitle"), last.error);
  return last;
}

// ---- Mensagens do content script ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "download") {
    runDownload(msg.url, sender.tab?.url || msg.pageUrl, sender.tab?.title || msg.title).then(sendResponse);
    return true;
  }
});

// ---- Menu de contexto ----
async function rebuildMenus() {
  const s = await getSettings();
  await chrome.contextMenus.removeAll();
  if (s.ctxImage) chrome.contextMenus.create({ id: "dl-image", title: t("menuImage"), contexts: ["image"] });
  if (s.ctxSelection) chrome.contextMenus.create({ id: "dl-selection", title: t("menuSelection"), contexts: ["selection"] });
}
chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);
chrome.storage.onChanged.addListener((changes) => {
  if ("ctxImage" in changes || "ctxSelection" in changes) rebuildMenus();
});

const toastTab = (tabId, text, kind) =>
  chrome.tabs.sendMessage(tabId, { type: "toast", text, kind }, { frameId: 0 }).catch(() => {});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "dl-image" && info.srcUrl) {
    const r = await runDownload(info.srcUrl, tab.url, tab.title);
    toastTab(tab.id, r.ok ? t("toastDone") : t("toastFailed", r.error), r.ok ? "ok" : "err");
  } else if (info.menuItemId === "dl-selection") {
    const urls = await chrome.tabs
      .sendMessage(tab.id, { type: "getSelectionImages" }, { frameId: info.frameId || 0 })
      .catch(() => []);
    if (!urls?.length) return toastTab(tab.id, t("toastNoImages"), "err");
    let ok = 0;
    for (const u of urls) if ((await runDownload(u, tab.url, tab.title)).ok) ok++;
    toastTab(tab.id, t("toastBatch", ok, urls.length), ok ? "ok" : "err");
  }
});

// ---- Hover Hotkey ----
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "download-hovered") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "hotkey" }).catch(() => {});
});
