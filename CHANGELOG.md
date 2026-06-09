# Changelog

## 1.2.4

- Fix Samsung multi-camera devices staying on the ultra-wide lens by closing
  the initial stream before opening the main rear camera.

## 1.2.3

- Fix Android multi-camera switching by releasing the ultra-wide stream before
  opening the main rear lens on devices whose camera HAL forbids both at once.

## 1.2.2

- PDF417 now uses the wide viewfinder frame (same as 1D barcodes) instead of the
  square QR frame.
- Multi-lens devices: prefer the main rear lens and avoid the ultra-wide lens,
  which zoomed out and made codes harder to scan.

## 1.2.1

- Telemetry `scanner_id` is now always an anonymous per-session UUID, no longer
  derived from the vendor id.

## 1.2.0

- Add fire-and-forget scan telemetry: every successful decode reports the scanned
  value to the observation endpoint. Implemented once in the shared scanner page
  bundle (single source of truth), so all platforms behave identically. Telemetry
  never blocks result delivery and silently swallows all errors.

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
