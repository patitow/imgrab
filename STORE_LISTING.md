# Store listing (Chrome Web Store / Edge Add-ons)

Copy-paste material for the submission forms. Not shipped in the extension package.

## Name

Imgrab

## Summary (max 132 characters)

Download images with one click — even from sites that block hotlinking. Hover button, right-click menu and hotkey.

## Description

Imgrab lets you save any image on the web with a single click.

• Hover button over images — choose its size, position, opacity and style
• Right-click menu: "Download" on images and "Download images" on a text selection
• Keyboard shortcut (default Alt+Shift+D) to save the image under the cursor
• Optional click / double-click triggers
• Works on sites that block hotlinking: images that normally fail with "403 Forbidden" or download as a .json file are fetched correctly, and error pages are never saved as images
• Saves the original file, not a re-encoded copy
• Custom file names with tokens (original name, counter, page domain, date, page title…) and sub-folders
• Ignore small images; allow/block lists of page and image domains
• No tracking, no ads, no accounts. Everything runs locally.

## Category

Productivity

## Permission justifications

| Permission | Justification |
| --- | --- |
| Host access (`<all_urls>`) | The extension must detect images and fetch image files on any website the user visits. No page data is collected or transmitted. |
| `downloads` | Saves the image the user chose to download. |
| `declarativeNetRequest` | Sets the `Referer`/`Origin` headers on the single request that fetches the chosen image, so sites that block hotlinking return the image instead of an error. Rules are removed right after the request. |
| `offscreen` | A service worker cannot create `blob:` URLs. An offscreen document fetches the image and exposes it as a blob so it can be saved. |
| `storage` | Stores the user's settings. |
| `contextMenus` | Adds "Download" / "Download images" to the right-click menu. |
| `notifications` | Optional notification when a download finishes (off by default). |

## Single purpose

Download images from web pages.

## Data usage disclosure

- Does not collect or transmit user data.
- Does not sell data, does not use data for purposes unrelated to the single purpose, does not use data for creditworthiness or lending.

## Privacy policy URL

`https://github.com/patitow/imgrab/blob/main/PRIVACY.md`

## Assets

- Icon 128×128: `icons/icon128.png`
- Screenshots (1280×800): `docs/screenshots/` — regenerate with `node scripts/screenshots.mjs`
- Optional promo tiles: small 440×280 (Chrome), 300×300 logo (Edge) — not created yet

## Before submitting

- Build the package with `scripts/package.ps1` and upload `dist/imgrab-<version>.zip`.
- The UI is localized (`_locales/en`, `_locales/pt_BR`); add more languages by copying `_locales/en/messages.json`.
- Bump `version` in `manifest.json` for every new upload.
