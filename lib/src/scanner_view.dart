import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'internal/scanner_bridge.dart';
import 'scan_result.dart';
import 'scan_type.dart';
import 'scanner_config.dart';
import 'scanner_controller.dart';
import 'scanner_error.dart';

/// Hosts the scanner WebView and surfaces decoded results via callbacks.
///
/// The widget owns the camera lifecycle: it tears the WebView down on dispose,
/// so callers never have to stop it manually.
///
/// ```dart
/// QtrustScannerView(
///   config: ScannerConfig(),
///   type: ScanType.qr,
///   onResult: (r) => print(r.data),
///   onError: (e) => print(e.message),
/// )
/// ```
///
/// The host app must hold OS camera permission before this widget mounts
/// (Android: `CAMERA` runtime permission; iOS: `NSCameraUsageDescription` +
/// granted access). The WebView-level permission request is auto-granted.
class QtrustScannerView extends StatefulWidget {
  const QtrustScannerView({
    super.key,
    required this.config,
    required this.type,
    this.onResult,
    this.onError,
    this.onReady,
    this.onClose,
    this.controller,
  }) : assert(
          onResult != null || controller != null,
          'Provide onResult (callback style) or a controller (stream/one-shot '
          'style) so decoded results have somewhere to go.',
        );

  /// Scanner configuration (timeout, vendor settings).
  final ScannerConfig config;

  /// Type of code to scan.
  final ScanType type;

  /// Called for each decoded result. Optional when [controller] is supplied.
  final void Function(ScanResult result)? onResult;

  /// Called when an error occurs.
  final void Function(ScannerError error)? onError;

  /// Called once the scanner is initialized and connected.
  final void Function()? onReady;

  /// Called when the scanner is closed from within the web UI.
  final void Function()? onClose;

  /// Optional controller exposing stream ([QtrustScannerController.results])
  /// and one-shot ([QtrustScannerController.next]) APIs. The view feeds
  /// results, errors, and close events into it while mounted.
  final QtrustScannerController? controller;

  /// Loading overlay timeout — reveal the WebView even if `onReady` never fires.
  static const Duration _loadingTimeout = Duration(seconds: 15);

  /// Brief settle delay after `onReady` before crossfading the WebView in.
  static const Duration _revealDelay = Duration(milliseconds: 500);

  /// Localhost port for the bundled asset server. Serving over `localhost`
  /// (a secure context on both platforms) is required: `getUserMedia` is blocked
  /// under a raw `file://` origin on Android.
  static const int _serverPort = 9436;

  /// Asset directory of the vendored web bundle, resolved as a package path so
  /// it works when the SDK is consumed as a dependency. Used as the localhost
  /// server's document root — requests then map to `/index.html`, `/scanner.css`,
  /// etc. with no `./`-prefix ambiguity for package assets.
  static const String _documentRoot = 'packages/qtrust_scanner/assets/scanner';

  @override
  State<QtrustScannerView> createState() => _QtrustScannerViewState();
}

class _QtrustScannerViewState extends State<QtrustScannerView> {
  static final InAppLocalhostServer _server = InAppLocalhostServer(
    port: QtrustScannerView._serverPort,
    documentRoot: QtrustScannerView._documentRoot,
    shared: true,
  );

  /// Reference count across all live [_QtrustScannerViewState] instances.
  /// The server is started when the count goes 1→ running and stopped when
  /// it drops back to 0, preventing both double-starts and leaks.
  static int _serverRefCount = 0;

  late final ScannerBridge _bridge;
  late final UnmodifiableListView<UserScript> _userScripts;
  Future<WebUri>? _bootstrap;
  InAppWebViewController? _controller;
  bool _ready = false;
  bool _revealing = false;
  bool _hasResult = false;

  /// Fires [ScannerError.timeout] if no result is received within
  /// [ScannerConfig.timeout]. Cancelled on first result or on dispose.
  Timer? _timeoutTimer;

  @override
  void initState() {
    super.initState();
    _userScripts = UnmodifiableListView<UserScript>([
      UserScript(
        source: bootShimJs(widget.type),
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
      ),
      UserScript(
        source: bridgeShimJs,
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
      ),
      UserScript(
        source: _blackBgJs,
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
      ),
    ]);
    _bridge = ScannerBridge(
      onResult: _handleResult,
      onError: _handleError,
      onReady: _handleReady,
      onClose: _handleClose,
    );
    _bootstrap = _start();

    // Fallback reveal — never leave the user staring at a spinner forever.
    Future<void>.delayed(QtrustScannerView._loadingTimeout, () {
      if (mounted && !_ready) setState(() => _ready = true);
    });

    // config.timeout: emit a timeout error if no result arrives in time.
    _timeoutTimer = Timer(widget.config.timeout, () {
      if (!mounted || _hasResult) return;
      _timeoutTimer = null;
      _handleError(
        const ScannerError.timeout(
          'No scan result received within the configured timeout.',
        ),
      );
      if (mounted && !_ready) setState(() => _ready = true);
    });
  }

  void _handleResult(ScanResult result) {
    _hasResult = true;
    _timeoutTimer?.cancel();
    _timeoutTimer = null;
    widget.onResult?.call(result);
    widget.controller?.emitResult(result);
  }

  /// Fans an error out to both the callback and the controller sinks.
  void _handleError(ScannerError error) {
    widget.onError?.call(error);
    widget.controller?.emitError(error);
  }

  /// Fans a user-initiated close out to the callback and the controller sinks.
  /// The controller surfaces it as [ScannerError.cancelled].
  void _handleClose() {
    widget.onClose?.call();
    widget.controller?.emitClose();
  }

  Future<WebUri> _start() async {
    try {
      _serverRefCount++;
      if (!_server.isRunning()) {
        await _server.start();
      }
      final url = 'http://localhost:${QtrustScannerView._serverPort}/index.html'
          '?type=${widget.type.value}&mode=sdk&skip_tutorial=1';
      return WebUri(url);
    } on Exception catch (e) {
      if (mounted) {
        _handleError(
          ScannerError.connectionFailed('Scanner server failed to start: $e'),
        );
        setState(() => _ready = true);
      }
      rethrow;
    }
  }

  void _handleReady() {
    if (!mounted || _revealing) return;
    widget.onReady?.call();
    _revealing = true;
    Future<void>.delayed(QtrustScannerView._revealDelay, () {
      if (mounted) setState(() => _ready = true);
    });
  }

  @override
  void dispose() {
    _timeoutTimer?.cancel();
    _timeoutTimer = null;
    _bridge.tearDown();
    // Navigate away to release the camera stream promptly. Without this, the
    // prior getUserMedia track can linger and stall the next scan session
    // (black screen + slow start on re-entry).
    _controller?.stopLoading();
    _controller?.loadUrl(urlRequest: URLRequest(url: WebUri('about:blank')));
    _serverRefCount--;
    if (_serverRefCount <= 0) {
      _serverRefCount = 0;
      if (_server.isRunning()) {
        unawaited(_server.close());
      }
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          FutureBuilder<WebUri>(
            future: _bootstrap,
            builder: (context, snapshot) {
              if (!snapshot.hasData) return const SizedBox.shrink();
              return AnimatedOpacity(
                opacity: _ready ? 1 : 0,
                duration: const Duration(milliseconds: 250),
                child: _buildWebView(snapshot.data!),
              );
            },
          ),
          IgnorePointer(
            ignoring: _ready,
            child: AnimatedOpacity(
              opacity: _ready ? 0 : 1,
              duration: const Duration(milliseconds: 250),
              child: const ColoredBox(
                color: Colors.black,
                child: Center(
                  child: CircularProgressIndicator(color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWebView(WebUri url) {
    return InAppWebView(
      initialUrlRequest: URLRequest(url: url),
      initialUserScripts: _userScripts,
      initialSettings: InAppWebViewSettings(
        transparentBackground: true,
        javaScriptEnabled: true,
        mediaPlaybackRequiresUserGesture: false,
        allowsInlineMediaPlayback: true,
      ),
      onWebViewCreated: (controller) {
        _controller = controller;
        controller.addJavaScriptHandler(
          handlerName: kBridgeHandlerName,
          callback: _bridge.handle,
        );
      },
      onPermissionRequest: (controller, request) async {
        // Grant the WebView-level camera request. OS-level permission must
        // already be held by the host app.
        return PermissionResponse(
          resources: request.resources,
          action: PermissionResponseAction.GRANT,
        );
      },
      onLoadStop: (controller, url) async {
        // Only call ScannerInit on the expected scanner origin. Navigating to
        // about:blank (on dispose) or any error page would produce a silent
        // JS TypeError because window.ScannerInit is not defined there.
        final host = url?.host ?? '';
        final port = url?.port ?? 0;
        if (host != 'localhost' || port != QtrustScannerView._serverPort) {
          return;
        }
        final js = _buildInitJs();
        await controller.evaluateJavascript(source: js);
        // Re-check mounted after the async gap — the widget may have been
        // disposed while the JS evaluation was in flight.
        if (!mounted) return;
      },
      onReceivedError: (controller, request, error) {
        if (request.isForMainFrame != true) return;
        _handleError(
          ScannerError.connectionFailed(
            'Page load failed: ${error.description}',
          ),
        );
        if (mounted && !_ready) setState(() => _ready = true);
      },
      onReceivedHttpError: (controller, request, response) {
        if (request.isForMainFrame != true) return;
        final code = response.statusCode ?? 0;
        _handleError(
          ScannerError.connectionFailed('Failed to load scanner (HTTP $code)'),
        );
        if (mounted && !_ready) setState(() => _ready = true);
      },
    );
  }

  /// Builds the `window.ScannerInit(payload)` call. The payload is JSON-encoded
  /// so every vendor string is fully escaped — hand-rolled quoting could break
  /// the literal or inject code.
  String _buildInitJs() {
    final payload = jsonEncode({
      'type': widget.type.value,
      'config': widget.config.vendorConfig.toJson(),
    });
    return 'window.ScannerInit($payload);';
  }

  static const String _blackBgJs =
      "document.documentElement.style.background='#000';"
      "document.body.style.background='#000';";
}
