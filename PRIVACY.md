# Privacy Policy — Imgrab

_Last updated: 2026-09-30_

Imgrab is a browser extension that downloads images you choose to download.

## Data collection

Imgrab **does not collect, store, transmit or sell any personal data**. It has no analytics, no telemetry, no
accounts, no remote servers and no third-party services.

## What the extension accesses

- **Page content**: it reads the images on the page you are viewing (their URLs and dimensions) only to show the
  download button and to know which image to download. This never leaves your browser.
- **Network requests**: the only request Imgrab makes is fetching the image file you asked to download, from the
  server that hosts it. It sets the `Referer` and `Origin` headers of that request so sites that block hotlinking
  deliver the image. Cookies are not sent (`credentials: "omit"`).
- **Settings**: your preferences (button style, file naming pattern, domain lists, etc.) are stored with
  `chrome.storage.sync`, so the browser may sync them across your own devices through your browser account. The
  developer has no access to them.
- **Downloads**: files are saved to your Downloads folder through the browser's downloads API.

## Children

Imgrab does not knowingly collect information from anyone, including children.

## Changes

If this policy changes, the updated version will be published in this repository with a new date.

## Contact

Matheus Souza de Oliveira (Patitow Dev) — open an issue at https://github.com/patitow/imgrab/issues.
