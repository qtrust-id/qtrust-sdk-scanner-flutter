import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:qtrust_scanner/qtrust_scanner.dart';
// ignore: invalid_use_of_internal_member, implementation_imports
import 'package:qtrust_scanner/src/internal/scanner_bridge.dart';

void main() {
  group('ScannerBridge.handle', () {
    test('dispatches result envelope to onResult', () {
      // Arrange
      ScanResult? received;
      final bridge = ScannerBridge(onResult: (r) => received = r);
      final envelope = {
        'type': 'result',
        'payload': jsonEncode({
          'data': '12345',
          'format': 'EAN_13',
          'bounding_box': {'x': 0, 'y': 0, 'width': 0, 'height': 0},
        }),
      };

      // Act
      bridge.handle([envelope]);

      // Assert
      expect(received, isNotNull);
      expect(received!.data, '12345');
      expect(received!.format, 'EAN_13');
    });

    test('routes error envelope to onError as serverError', () {
      ScannerError? error;
      final bridge = ScannerBridge(onError: (e) => error = e);

      bridge.handle([
        {'type': 'error', 'payload': 'socket closed'},
      ]);

      expect(error, isNotNull);
      expect(error!.kind, ScannerErrorKind.serverError);
      expect(error!.message, 'socket closed');
    });

    test('malformed result JSON surfaces as serverError, never throws', () {
      ScannerError? error;
      ScanResult? result;
      final bridge = ScannerBridge(
        onResult: (r) => result = r,
        onError: (e) => error = e,
      );

      bridge.handle([
        {'type': 'result', 'payload': 'not-json{'},
      ]);

      expect(result, isNull);
      expect(error, isNotNull);
      expect(error!.kind, ScannerErrorKind.serverError);
    });

    test('fires onReady and onClose for lifecycle envelopes', () {
      var ready = false;
      var closed = false;
      final bridge = ScannerBridge(
        onReady: () => ready = true,
        onClose: () => closed = true,
      );

      bridge.handle([
        {'type': 'ready', 'payload': null},
      ]);
      bridge.handle([
        {'type': 'close', 'payload': null},
      ]);

      expect(ready, isTrue);
      expect(closed, isTrue);
    });

    test('tearDown drops callbacks so later envelopes are no-ops', () {
      var fired = false;
      final bridge = ScannerBridge(onReady: () => fired = true);

      bridge.tearDown();
      bridge.handle([
        {'type': 'ready', 'payload': null},
      ]);

      expect(fired, isFalse);
    });

    test('ignores empty or non-map args', () {
      final bridge = ScannerBridge(onResult: (_) => fail('should not fire'));

      bridge.handle([]);
      bridge.handle(['garbage']);
    });
  });
}
