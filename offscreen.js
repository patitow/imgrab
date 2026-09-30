// Documento offscreen: faz o fetch (com as regras de Referer aplicadas) e expõe o resultado como blob: URL.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "revoke") {
    URL.revokeObjectURL(msg.url);
    return;
  }
  if (msg.type === "fetch") {
    (async () => {
      try {
        const r = await fetch(msg.url, { credentials: "omit" });
        const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!r.ok) return sendResponse({ ok: false, error: `HTTP ${r.status}` });
        if (type && !/^(image|video|audio)\//.test(type) && type !== "application/octet-stream")
          return sendResponse({ ok: false, error: `not an image (${type})` });
        const blob = await r.blob();
        sendResponse({ ok: true, blobUrl: URL.createObjectURL(blob), mime: type, size: blob.size });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }
});
