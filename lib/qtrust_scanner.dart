/// QTrust Scanner — Flutter SDK.
///
/// On-device QR & barcode scanner. Drop [QtrustScannerView] into your widget
/// tree, pass a [ScannerConfig], and receive decoded [ScanResult]s via callback.
///
/// The SDK bundles the scanner web UI locally and serves it over a localhost
/// secure origin. Decoding runs fully on-device via the bundled zxing-wasm
/// decoder — no server URL or network is involved.
library qtrust_scanner;

export 'src/scan_result.dart';
export 'src/scan_type.dart';
export 'src/scanner_config.dart';
export 'src/scanner_error.dart';
export 'src/scanner_view.dart';
