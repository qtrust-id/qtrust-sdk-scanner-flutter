import 'dart:collection';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'internal/scanner_bridge.dart';
import 'scan_result.dart';
import 'scan_type.dart';
import 'scanner_config.dart';
import 'scanner_error.dart';

/// Hosts the scanner WebView and surfaces decoded results via callbacks.
///
/// The widget owns the camera lifecycle: it tears the WebView down on dispose,
/// so callers never have to stop it manually.
///
/// ```dart
/// QtrustScannerView(
///   config: ScannerConfig(apiKey: 'sk_live_...'),
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
    required this.onResult,
    this.onError,
    this.onReady,
    this.onClose,
  });

  /// Scanner service configuration (API key, base URL, vendor settings).
  final ScannerConfig config;

  /// Type of code to scan.
  final ScanType type;

  /// Called for each decoded result.
  final void Function(ScanResult result) onResult;

  /// Called when an error occurs.
  final void Function(ScannerError error)? onError;

  /// Called once the scanner is initialized and connected.
  final void Function()? onReady;

  /// Called when the scanner is closed from within the web UI.
  final void Function()? onClose;

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

  final ScannerBridge _bridge = ScannerBridge();
  Future<WebUri>? _bootstrap;
  InAppWebViewController? _controller;
  bool _ready = false;
  bool _revealing = false;

  @override
  void initState() {
    super.initState();
    _bridge
      ..onResult = widget.onResult
      ..onError = widget.onError
      ..onReady = _handleReady
      ..onClose = widget.onClose;
    _bootstrap = _start();

    // Fallback reveal — never leave the user staring at a spinner forever.
    Future<void>.delayed(QtrustScannerView._loadingTimeout, () {
      if (mounted && !_ready) setState(() => _ready = true);
    });
  }

  Future<WebUri> _start() async {
    if (!_server.isRunning()) {
      await _server.start();
    }
    final url = 'http://localhost:${QtrustScannerView._serverPort}/index.html'
        '?type=${widget.type.value}&mode=sdk&skip_tutorial=1';
    return WebUri(url);
  }

  void _handleReady() {
    widget.onReady?.call();
    if (!mounted || _revealing) return;
    _revealing = true;
    Future<void>.delayed(QtrustScannerView._revealDelay, () {
      if (mounted) setState(() => _ready = true);
    });
  }

  @override
  void dispose() {
    _bridge.tearDown();
    // Navigate away to release the camera stream promptly. Without this, the
    // prior getUserMedia track can linger and stall the next scan session
    // (black screen + slow start on re-entry).
    _controller?.stopLoading();
    _controller?.loadUrl(urlRequest: URLRequest(url: WebUri('about:blank')));
    super.dispose();
  }

  UnmodifiableListView<UserScript> get _userScripts =>
      UnmodifiableListView<UserScript>([
        UserScript(
          source: bootShimJs(widget.type.value),
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
      onLoadStop: (controller, _) async {
        await controller.evaluateJavascript(source: _buildInitJs());
      },
      onReceivedError: (controller, request, error) {
        if (request.isForMainFrame != true) return;
        widget.onError?.call(
          ScannerError.connectionFailed(
            'Page load failed: ${error.description}',
          ),
        );
        if (mounted && !_ready) setState(() => _ready = true);
      },
      onReceivedHttpError: (controller, request, response) {
        if (request.isForMainFrame != true) return;
        final code = response.statusCode ?? 0;
        final msg = switch (code) {
          401 => 'Invalid or missing API key',
          403 => 'Access forbidden',
          _ => 'Server error (HTTP $code)',
        };
        widget.onError?.call(ScannerError.connectionFailed(msg));
        if (mounted && !_ready) setState(() => _ready = true);
      },
    );
  }

  /// Builds the `window.ScannerInit(payload)` call. The payload is JSON-encoded
  /// so every string (API key, vendor fields) is fully escaped — hand-rolled
  /// quoting could break the literal or inject code.
  String _buildInitJs() {
    final payload = jsonEncode({
      'key': widget.config.apiKey,
      'serverUrl': widget.config.baseUrl,
      'type': widget.type.value,
      'config': widget.config.vendorConfig.toJson(),
    });
    return 'window.ScannerInit($payload);';
  }

  static const String _blackBgJs =
      "document.documentElement.style.background='#000';"
      "document.body.style.background='#000';";
}
