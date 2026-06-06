/// Bounding box of a detected code within the camera frame.
class BoundingBox {
  const BoundingBox({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  final int x;
  final int y;
  final int width;
  final int height;

  /// Parses the `bounding_box` object emitted by the scanner web layer.
  /// Missing or non-numeric fields fall back to `0` — the result must never
  /// throw on a partial box, since the decoded [ScanResult.data] is still valid.
  factory BoundingBox.fromJson(Map<String, dynamic> json) {
    int asInt(Object? v) => v is num ? v.toInt() : 0;
    return BoundingBox(
      x: asInt(json['x']),
      y: asInt(json['y']),
      width: asInt(json['width']),
      height: asInt(json['height']),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BoundingBox &&
          runtimeType == other.runtimeType &&
          x == other.x &&
          y == other.y &&
          width == other.width &&
          height == other.height;

  @override
  int get hashCode => Object.hash(x, y, width, height);
}

/// Decoded scan result from the scanner service.
class ScanResult {
  const ScanResult({
    required this.data,
    required this.format,
    required this.boundingBox,
  });

  /// The decoded content (URL, text, number, etc.).
  final String data;

  /// The barcode format (e.g. "QR_CODE", "EAN_13").
  final String format;

  /// Location of the detected code in the camera frame.
  final BoundingBox boundingBox;

  /// Parses the result object emitted as `ScannerBridge.onResult(json)`.
  factory ScanResult.fromJson(Map<String, dynamic> json) {
    final box = json['bounding_box'];
    return ScanResult(
      data: (json['data'] ?? '').toString(),
      format: (json['format'] ?? '').toString(),
      boundingBox: box is Map<String, dynamic>
          ? BoundingBox.fromJson(box)
          : const BoundingBox(x: 0, y: 0, width: 0, height: 0),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScanResult &&
          runtimeType == other.runtimeType &&
          data == other.data &&
          format == other.format &&
          boundingBox == other.boundingBox;

  @override
  int get hashCode => Object.hash(data, format, boundingBox);
}
