/// Kinds of failure that can occur during a scan session.
enum ScannerErrorKind {
  /// WebSocket or network connection failed.
  connectionFailed,

  /// Camera permission was denied by the user.
  permissionDenied,

  /// Scan timed out before a result was received.
  timeout,

  /// Server returned an error.
  serverError,
}

/// Error raised during a scan session.
///
/// Mirrors the native sealed `ScannerError` hierarchy via a single class with
/// a [kind] discriminator — idiomatic for Dart, where `switch` on an enum gives
/// the same exhaustiveness as the Kotlin/Swift cases.
class ScannerError implements Exception {
  const ScannerError(this.kind, this.message);

  const ScannerError.connectionFailed(String message)
      : this(ScannerErrorKind.connectionFailed, message);

  const ScannerError.permissionDenied(String message)
      : this(ScannerErrorKind.permissionDenied, message);

  const ScannerError.timeout(String message)
      : this(ScannerErrorKind.timeout, message);

  const ScannerError.serverError(String message)
      : this(ScannerErrorKind.serverError, message);

  final ScannerErrorKind kind;
  final String message;

  @override
  String toString() => 'ScannerError(${kind.name}): $message';
}
