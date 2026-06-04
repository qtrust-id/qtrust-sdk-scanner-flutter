/// Theme for the scanner UI.
enum ScannerTheme {
  dark(0),
  light(1);

  const ScannerTheme(this.value);

  /// Integer value sent to the scanner web layer.
  final int value;
}

/// Display locale for scanner UI text.
enum ScannerLocale {
  id(0),
  en(1);

  const ScannerLocale(this.value);

  /// Integer value sent to the scanner web layer.
  final int value;
}

/// Vendor-specific configuration passed to the scanner web layer.
class VendorConfig {
  const VendorConfig({
    this.vendorId = '',
    this.textHintScan = '',
    this.theme = ScannerTheme.dark,
    this.locale = ScannerLocale.id,
    this.skipTutorial = true,
  });

  /// Vendor identifier.
  final String vendorId;

  /// Custom scan instruction text (empty = default per scan type).
  final String textHintScan;

  /// Scanner UI theme.
  final ScannerTheme theme;

  /// Scanner UI locale.
  final ScannerLocale locale;

  /// true = skip tutorial screen (default), false = show tutorial before scan.
  final bool skipTutorial;

  /// Returns a copy with the given fields replaced. Preserves immutability.
  VendorConfig copyWith({
    String? vendorId,
    String? textHintScan,
    ScannerTheme? theme,
    ScannerLocale? locale,
    bool? skipTutorial,
  }) {
    return VendorConfig(
      vendorId: vendorId ?? this.vendorId,
      textHintScan: textHintScan ?? this.textHintScan,
      theme: theme ?? this.theme,
      locale: locale ?? this.locale,
      skipTutorial: skipTutorial ?? this.skipTutorial,
    );
  }

  /// JSON shape consumed by `window.ScannerInit`'s `config` field.
  Map<String, dynamic> toJson() => {
        'vendorId': vendorId,
        'textHintScan': textHintScan,
        'theme': theme.value,
        'locale': locale.value,
        'skipTutorial': skipTutorial,
      };
}

/// Configuration for a [Scanner] instance.
class ScannerConfig {
  const ScannerConfig({
    required this.apiKey,
    this.baseUrl = defaultBaseUrl,
    this.timeout = defaultTimeout,
    this.vendorConfig = const VendorConfig(),
  });

  /// API key for authenticating with the scanner service.
  final String apiKey;

  /// Base HTTPS URL of the scanner service.
  final String baseUrl;

  /// Maximum time to wait for a scan result (used by one-shot [Scanner.scan]).
  final Duration timeout;

  /// Vendor-specific settings.
  final VendorConfig vendorConfig;

  /// Returns a copy with the given fields replaced. Preserves immutability.
  ScannerConfig copyWith({
    String? apiKey,
    String? baseUrl,
    Duration? timeout,
    VendorConfig? vendorConfig,
  }) {
    return ScannerConfig(
      apiKey: apiKey ?? this.apiKey,
      baseUrl: baseUrl ?? this.baseUrl,
      timeout: timeout ?? this.timeout,
      vendorConfig: vendorConfig ?? this.vendorConfig,
    );
  }

  static const String defaultBaseUrl = 'https://scan.qtrust.id';
  static const Duration defaultTimeout = Duration(seconds: 30);
}
