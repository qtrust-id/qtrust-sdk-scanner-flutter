import 'package:flutter_test/flutter_test.dart';
import 'package:qtrust_scanner/qtrust_scanner.dart';

ScanResult _result(String data) => ScanResult(
      data: data,
      format: 'QR_CODE',
      boundingBox: const BoundingBox(x: 0, y: 0, width: 1, height: 1),
    );

void main() {
  group('QtrustScannerController', () {
    test('stream delivers every emitted result', () async {
      final controller = QtrustScannerController();
      addTearDown(controller.dispose);

      final received = <String>[];
      final sub = controller.results.listen((r) => received.add(r.data));

      controller.emitResult(_result('a'));
      controller.emitResult(_result('b'));
      await Future<void>.delayed(Duration.zero);

      expect(received, ['a', 'b']);
      await sub.cancel();
    });

    test('next() resolves with the first result', () async {
      final controller = QtrustScannerController();
      addTearDown(controller.dispose);

      final future = controller.next();
      controller.emitResult(_result('first'));

      final result = await future;
      expect(result.data, 'first');
    });

    test('next() throws the emitted error', () async {
      final controller = QtrustScannerController();
      addTearDown(controller.dispose);

      final future = controller.next();
      controller.emitError(const ScannerError.timeout('timed out'));

      await expectLater(
        future,
        throwsA(
          isA<ScannerError>()
              .having((e) => e.kind, 'kind', ScannerErrorKind.timeout),
        ),
      );
    });

    test('next() throws cancelled when the scanner is closed', () async {
      final controller = QtrustScannerController();
      addTearDown(controller.dispose);

      final future = controller.next();
      controller.emitClose();

      await expectLater(
        future,
        throwsA(
          isA<ScannerError>()
              .having((e) => e.kind, 'kind', ScannerErrorKind.cancelled),
        ),
      );
    });

    test('emit after dispose is a no-op and does not throw', () async {
      final controller = QtrustScannerController();
      controller.dispose();

      expect(controller.isDisposed, isTrue);
      expect(() => controller.emitResult(_result('x')), returnsNormally);
      expect(
        () => controller.emitError(const ScannerError.timeout('t')),
        returnsNormally,
      );
      expect(controller.emitClose, returnsNormally);
    });
  });
}
