# Changelog

## 1.1.0

- Add `QtrustScannerController` for non-callback result consumption, matching
  the native SDKs:
  - **Stream** — listen to `controller.results` for every decode.
  - **One-shot** — `await controller.next()` for a single result.
- Add a cancellation error code surfaced when the scanner is closed mid-scan.
- Remove the unused signed `sdk-manifest.json` from bundled assets (OTA
  infrastructure dropped; decode runs fully on-device).

## 1.0.3

- Initial public release of the QTrust Scanner Flutter SDK.
- `QtrustScannerView` widget hosting the bundled scanner web UI over a
  localhost secure origin (offline-capable).
- Cloud (WebSocket) and on-device decode backends with automatic fallback.
- QR and barcode scan types via `ScanType`.
- Typed results (`ScanResult`) and errors (`ScannerError`) over a native bridge.
- Vendor configuration (`VendorConfig`): skip tutorial, theme, locale, hint
  text, and symbology overrides.
