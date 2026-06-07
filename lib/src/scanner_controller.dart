import 'dart:async';

import 'package:meta/meta.dart';

import 'scan_result.dart';
import 'scanner_error.dart';

/// Bridges [QtrustScannerView] callbacks into stream and one-shot APIs, so the
/// Flutter SDK offers the same three interaction styles as the native SDKs:
///
/// 1. **Callback** — pass `onResult`/`onError` directly to [QtrustScannerView].
/// 2. **Stream** — attach a controller and listen to [results] for every decode.
/// 3. **One-shot** — attach a controller and `await` [next] for a single result.
///
/// Attach exactly one controller to a single mounted [QtrustScannerView]. The
/// view feeds results, errors, and close events into the controller while it is
/// mounted. Call [dispose] when finished.
///
/// ```dart
/// final controller = QtrustScannerController();
///
/// // Stream:
/// controller.results.listen((r) => print(r.data));
///
/// // One-shot:
/// final result = await controller.next(); // throws ScannerError on failure
/// ```
class QtrustScannerController {
  final StreamController<ScanResult> _results =
      StreamController<ScanResult>.broadcast();

  /// Continuous stream of decoded results. Errors are surfaced as
  /// [ScannerError] events; a user-initiated close surfaces as
  /// [ScannerError.cancelled].
  Stream<ScanResult> get results => _results.stream;

  /// Resolves with the first decoded [ScanResult], then completes.
  ///
  /// Throws the underlying [ScannerError] if a failure (including a
  /// [ScannerErrorKind.timeout]) or a user-initiated close
  /// ([ScannerErrorKind.cancelled]) occurs before a result.
  Future<ScanResult> next() => _results.stream.first;

  /// Whether [dispose] has been called.
  bool get isDisposed => _results.isClosed;

  /// Feeds a decoded result. Called by [QtrustScannerView]; not for app use.
  @internal
  void emitResult(ScanResult result) {
    if (!_results.isClosed) _results.add(result);
  }

  /// Feeds an error. Called by [QtrustScannerView]; not for app use.
  @internal
  void emitError(ScannerError error) {
    if (!_results.isClosed) _results.addError(error);
  }

  /// Feeds a user-initiated close as [ScannerError.cancelled]. Called by
  /// [QtrustScannerView]; not for app use.
  @internal
  void emitClose() {
    if (!_results.isClosed) {
      _results.addError(const ScannerError.cancelled());
    }
  }

  /// Closes the underlying stream. Idempotent.
  void dispose() {
    if (!_results.isClosed) _results.close();
  }
}
