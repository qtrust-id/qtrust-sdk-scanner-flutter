import 'dart:convert';

import '../scan_result.dart';
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
    } catch (e) {}
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
String bootShimJs(int scanType) =>
    'window.__SCANNER_BOOT__={mode:"sdk",type:$scanType};';

/// Routes bridge messages from the WebView to typed callbacks. One instance per
/// scan session; [tearDown] drops all callbacks so a destroyed view emits
/// nothing further.
class ScannerBridge {
  ScannerBridge({
    this.onResult,
    this.onError,
    this.onReady,
    this.onClose,
  });

  void Function(ScanResult result)? onResult;
  void Function(ScannerError error)? onError;
  void Function()? onReady;
  void Function()? onClose;

  /// Handles a `{type, payload}` envelope from the JS shim. `args` is the
  /// argument list passed to the flutter_inappwebview handler; the first entry
  /// is the envelope map.
  void handle(List<dynamic> args) {
    if (args.isEmpty) return;
    final envelope = args.first;
    if (envelope is! Map) return;

    final type = envelope['type'];
    final payload = envelope['payload'];

    switch (type) {
      case 'result':
        _handleResult(payload);
        break;
      case 'error':
        onError
            ?.call(ScannerError.serverError(payload?.toString() ?? 'unknown'));
        break;
      case 'ready':
        onReady?.call();
        break;
      case 'close':
        onClose?.call();
        break;
    }
  }

  void _handleResult(Object? payload) {
    // Cloud sends `JSON.stringify(data)`, so payload is a JSON string. Validate
    // at this boundary — malformed JSON surfaces as a serverError, never throws.
    try {
      final decoded = jsonDecode(payload?.toString() ?? '');
      if (decoded is! Map<String, dynamic>) {
        onError?.call(
          const ScannerError.serverError('Malformed result: not an object'),
        );
        return;
      }
      onResult?.call(ScanResult.fromJson(decoded));
    } on FormatException catch (e) {
      onError?.call(
        ScannerError.serverError('Failed to parse result: ${e.message}'),
      );
    }
  }

  /// Drops all callbacks. Idempotent.
  void tearDown() {
    onResult = null;
    onError = null;
    onReady = null;
    onClose = null;
  }
}
