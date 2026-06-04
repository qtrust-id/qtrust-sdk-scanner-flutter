/// QTrust Scanner — Flutter SDK.
///
/// Cloud-based QR & barcode scanner. Drop [QtrustScannerView] into your widget
/// tree, pass a [ScannerConfig], and receive decoded [ScanResult]s via callback.
///
/// The SDK bundles the scanner web UI locally and serves it over a localhost
/// secure origin, so scanning works offline; it still tries the cloud WebSocket
/// first and only falls back to the on-device decoder when unreachable.
library qtrust_scanner;

export 'src/scan_result.dart';
export 'src/scan_type.dart';
export 'src/scanner_config.dart';
export 'src/scanner_error.dart';
export 'src/scanner_view.dart';
