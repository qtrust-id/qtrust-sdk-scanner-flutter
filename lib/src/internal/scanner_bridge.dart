import 'dart:convert';

import 'package:meta/meta.dart';

import '../scan_result.dart';
import '../scan_type.dart';
import '../scanner_error.dart';

/// Name of the JavaScript handler registered on the WebView. The injected
/// [bridgeShimJs] defines `window.ScannerBridge` (the contract cloud
/// `modules/bridge.js` already calls) and forwards every call here.
const String kBridgeHandlerName = 'ScannerBridge';

/// Document-start script that re-creates the native `window.ScannerBridge`
/// surface on top of flutter_inappwebview's single-handler bridge. Cloud
/// `bridge.js` calls `window.ScannerBridge.onResult/onError/onReady/onClose`;
/// each forwards a `{type, payload}` envelope to [kBridgeHandlerName].
const String bridgeShimJs = '''
(function () {
  function send(type, payload) {
    try {
      window.flutter_inappwebview.callHandler('$kBridgeHandlerName', {
        type: type,
        payload: payload,
      });
    } catch (e) {
      console.error('[ScannerBridge] callHandler failed:', e);
    }
  }
  window.ScannerBridge = {
    onResult: function (json) { send('result', json); },
    onError: function (message) { send('error', message); },
    onReady: function () { send('ready', null); },
    onClose: function () { send('close', null); },
  };
})();
''';

/// Document-start script injecting `window.__SCANNER_BOOT__` so the page boots
/// headless in SDK mode (no home/tutorial screens). Mirrors the iOS boot shim.
String bootShimJs(ScanType scanType) =>
    'window.__SCANNER_BOOT__={mode:"sdk",type:${scanType.value}};';

/// Routes bridge messages from the WebView to typed callbacks. One instance per
/// scan session; [tearDown] drops all callbacks so a destroyed view emits
/// nothing further.
@internal
class ScannerBridge {
  ScannerBridge({
    void Function(ScanResult result)? onResult,
    void Function(ScannerError error)? onError,
    void Function()? onReady,
    void Function()? onClose,
  })  : _onResult = onResult,
        _onError = onError,
        _onReady = onReady,
        _onClose = onClose;

  void Function(ScanResult result)? _onResult;
  void Function(ScannerError error)? _onError;
  void Function()? _onReady;
  void Function()? _onClose;

  bool _torn = false;

  // Convenience setters kept for backwards-compatibility with the widget's
  // initState wiring. Write is a no-op after tearDown.
  set onResult(void Function(ScanResult result)? fn) {
    if (!_torn) _onResult = fn;
  }

  set onError(void Function(ScannerError error)? fn) {
    if (!_torn) _onError = fn;
  }

  set onReady(void Function()? fn) {
    if (!_torn) _onReady = fn;
  }

  set onClose(void Function()? fn) {
    if (!_torn) _onClose = fn;
  }

  /// Handles a `{type, payload}` envelope from the JS shim. `args` is the
  /// argument list passed to the flutter_inappwebview handler; the first entry
  /// is the envelope map.
  void handle(List<dynamic> args) {
    if (_torn) return;
    if (args.isEmpty) return;
    final envelope = args.first;
    if (envelope is! Map) return;

    final type = envelope['type'];
    final payload = envelope['payload'];

    if (type is! String) {
      _onError?.call(
        ScannerError.serverError('Unexpected bridge envelope type: $type'),
      );
      return;
    }

    switch (type) {
      case 'result':
        _handleResult(payload);
      case 'error':
        _onError?.call(
          ScannerError.serverError(payload?.toString() ?? 'unknown'),
        );
      case 'ready':
        _onReady?.call();
      case 'close':
        _onClose?.call();
      default:
        _onError?.call(
          ScannerError.serverError('Unknown bridge message type: $type'),
        );
    }
  }

  void _handleResult(Object? payload) {
    // Cloud sends `JSON.stringify(data)`, so payload is a JSON string. Validate
    // at this boundary — malformed JSON surfaces as a serverError, never throws.
    try {
      final decoded = jsonDecode(payload?.toString() ?? '');
      if (decoded is! Map<String, dynamic>) {
        _onError?.call(
          const ScannerError.serverError('Malformed result: not an object'),
        );
        return;
      }
      _onResult?.call(ScanResult.fromJson(decoded));
    } on FormatException catch (e) {
      _onError?.call(
        ScannerError.serverError('Failed to parse result: ${e.message}'),
      );
    }
  }

  /// Drops all callbacks. Idempotent.
  void tearDown() {
    _torn = true;
    _onResult = null;
    _onError = null;
    _onReady = null;
    _onClose = null;
  }
}
