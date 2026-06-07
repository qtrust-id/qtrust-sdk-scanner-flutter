/// Kinds of failure that can occur during a scan session.
enum ScannerErrorKind {
  /// Scanner page or assets failed to load.
  connectionFailed,

  /// Camera permission was denied by the user.
  permissionDenied,

  /// Scan timed out before a result was received.
  timeout,

  /// Server returned an error.
  serverError,

  /// The user dismissed the scanner before a result was produced.
  cancelled,
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

  const ScannerError.cancelled([
    String message = 'Scanner was cancelled by the user.',
  ]) : this(ScannerErrorKind.cancelled, message);

  final ScannerErrorKind kind;
  final String message;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScannerError &&
          runtimeType == other.runtimeType &&
          kind == other.kind &&
          message == other.message;

  @override
  int get hashCode => Object.hash(kind, message);

  @override
  String toString() => 'ScannerError(${kind.name}): $message';
}
