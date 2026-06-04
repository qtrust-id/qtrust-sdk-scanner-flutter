import 'package:flutter/material.dart';
import 'package:qtrust_scanner/qtrust_scanner.dart';

void main() => runApp(const ExampleApp());

/// Replace with your actual API key.
const String _apiKey = 'sk_live_test';

/// WebSocket scanner backend — same host the iOS/Android samples target.
/// `onReady` only fires after this server auths the API key; an unreachable
/// host stalls behind the offline-fallback timeout (slow start).
const String _baseUrl = 'https://scanner.noersy.my.id';

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'QTrust Scanner Example',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

/// Result-consumption idioms mirrored from the iOS/Android samples.
enum ApiStyle {
  /// One-shot: push the scanner and pop the first result back.
  callback('Callback', 'QtrustScannerView(onResult:)', Color(0xFF3380FF)),

  /// Stream: stay on the scanner, surface every decode live.
  stream('Stream', 'onResult fires per scan', Color(0xFF33C773)),

  /// Async/await: await the pushed route for a single result.
  oneShot('Async/Await', 'await Navigator result', Color(0xFF9457EB));

  const ApiStyle(this.title, this.subtitle, this.color);

  final String title;
  final String subtitle;
  final Color color;
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  ScanType _type = ScanType.qr;
  bool _skipTutorial = true;
  ScanResult? _lastResult;

  Future<void> _startScan(ApiStyle style) async {
    // The scanner WebView triggers the native camera prompt itself via
    // getUserMedia (NSCameraUsageDescription on iOS, CAMERA on Android).
    final config = ScannerConfig(
      apiKey: _apiKey,
      baseUrl: _baseUrl,
      vendorConfig: VendorConfig(skipTutorial: _skipTutorial),
    );
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ScanPage(
          config: config,
          type: _type,
          style: style,
          onResult: (result) => setState(() => _lastResult = result),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surfaceContainerLowest,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'QTrust Scanner',
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                'Cloud-based QR & Barcode Scanner',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 24),
              const _SectionLabel('SCAN TYPE'),
              const SizedBox(height: 8),
              _Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: SegmentedButton<ScanType>(
                    segments: const [
                      ButtonSegment(value: ScanType.qr, label: Text('QR Code')),
                      ButtonSegment(
                        value: ScanType.barcode,
                        label: Text('Barcode'),
                      ),
                    ],
                    selected: {_type},
                    onSelectionChanged: (s) => setState(() => _type = s.first),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              _Card(
                child: SwitchListTile(
                  value: _skipTutorial,
                  onChanged: (v) => setState(() => _skipTutorial = v),
                  title: const Text('Skip Tutorial'),
                  subtitle: const Text('Langsung ke scanner tanpa tutorial'),
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                ),
              ),
              const SizedBox(height: 20),
              const _SectionLabel('API STYLE'),
              const SizedBox(height: 8),
              for (final style in ApiStyle.values) ...[
                _ApiStyleButton(style: style, onTap: () => _startScan(style)),
                const SizedBox(height: 8),
              ],
              if (_lastResult != null) ...[
                const SizedBox(height: 12),
                const _SectionLabel('LAST RESULT'),
                const SizedBox(height: 8),
                _ResultCard(result: _lastResult!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            letterSpacing: 0.5,
            fontWeight: FontWeight.w600,
          ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }
}

class _ApiStyleButton extends StatelessWidget {
  const _ApiStyleButton({required this.style, required this.onTap});

  final ApiStyle style;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: style.color,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      style.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      style.subtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                color: Colors.white.withValues(alpha: 0.6),
                size: 18,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final ScanResult result;

  @override
  Widget build(BuildContext context) {
    final box = result.boundingBox;
    return _Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _ResultRow('Data', result.data),
            _ResultRow('Format', result.format),
            _ResultRow(
              'Bounding Box',
              '(${box.x}, ${box.y}) ${box.width}×${box.height}',
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style:
                  theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}

class ScanPage extends StatefulWidget {
  const ScanPage({
    super.key,
    required this.config,
    required this.type,
    required this.style,
    required this.onResult,
  });

  final ScannerConfig config;
  final ScanType type;
  final ApiStyle style;
  final void Function(ScanResult result) onResult;

  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  // The scanner decodes every frame and fires onResult repeatedly. Latch the
  // first decode so we pop exactly once — otherwise the queued results over-pop
  // (back gets "stuck"). All API styles return on the first result, matching the
  // iOS/Android samples; the style only illustrates the consumption idiom.
  bool _handled = false;

  void _onResult(ScanResult result) {
    if (_handled) return;
    _handled = true;
    widget.onResult(result);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: QtrustScannerView(
        config: widget.config,
        type: widget.type,
        onResult: _onResult,
        onError: (error) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error.message)),
          );
        },
        onClose: () {
          if (_handled) return;
          _handled = true;
          Navigator.of(context).pop();
        },
      ),
    );
  }
}
