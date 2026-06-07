/// QTrust Scanner — Flutter SDK.
///
/// On-device QR & barcode scanner. Drop [QtrustScannerView] into your widget
/// tree and pass a [ScannerConfig]. Results are available in three styles,
/// matching the native SDKs:
///
/// 1. **Callback** — pass `onResult`/`onError` to [QtrustScannerView].
/// 2. **Stream** — attach a [QtrustScannerController] and listen to
///    [QtrustScannerController.results].
/// 3. **One-shot** — attach a controller and `await`
///    [QtrustScannerController.next].
///
/// The SDK bundles the scanner web UI locally and serves it over a localhost
/// secure origin. Decoding runs fully on-device via the bundled zxing-wasm
/// decoder — no server URL or network is involved.
library qtrust_scanner;

export 'src/scan_result.dart';
export 'src/scan_type.dart';
export 'src/scanner_config.dart';
export 'src/scanner_controller.dart';
export 'src/scanner_error.dart';
export 'src/scanner_view.dart';
