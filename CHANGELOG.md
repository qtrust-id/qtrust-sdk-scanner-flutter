# Changelog

## 1.0.3

- Initial public release of the QTrust Scanner Flutter SDK.
- `QtrustScannerView` widget hosting the bundled scanner web UI over a
  localhost secure origin (offline-capable).
- Cloud (WebSocket) and on-device decode backends with automatic fallback.
- QR and barcode scan types via `ScanType`.
- Typed results (`ScanResult`) and errors (`ScannerError`) over a native bridge.
- Vendor configuration (`VendorConfig`): skip tutorial, theme, locale, hint
  text, and symbology overrides.
