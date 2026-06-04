import 'package:flutter_test/flutter_test.dart';
import 'package:qtrust_scanner/qtrust_scanner.dart';

void main() {
  group('ScanResult.fromJson', () {
    test('parses full result with bounding box', () {
      // Arrange
      final json = {
        'data': 'https://ahm.to/zx21G3Zb',
        'format': 'QR_CODE',
        'bounding_box': {'x': 1, 'y': 2, 'width': 3, 'height': 4},
      };

      // Act
      final result = ScanResult.fromJson(json);

      // Assert
      expect(result.data, 'https://ahm.to/zx21G3Zb');
      expect(result.format, 'QR_CODE');
      expect(result.boundingBox.x, 1);
      expect(result.boundingBox.height, 4);
    });

    test('falls back to zero box when bounding_box is missing', () {
      final result = ScanResult.fromJson({'data': 'x', 'format': 'EAN_13'});

      expect(result.boundingBox.x, 0);
      expect(result.boundingBox.width, 0);
    });

    test('coerces missing data and format to empty strings', () {
      final result = ScanResult.fromJson(<String, dynamic>{});

      expect(result.data, '');
      expect(result.format, '');
    });
  });
}
