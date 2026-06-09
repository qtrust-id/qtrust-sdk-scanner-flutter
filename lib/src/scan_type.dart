/// Type of code to scan.
///
/// The [value] is sent to the scanner web layer.
enum ScanType {
  /// QR codes (QR, Micro QR).
  qr(0),

  /// Linear 1D barcodes (EAN, UPC, Code128, Code39, Codabar, ITF).
  barcode(1),

  /// PDF417 stacked linear barcodes.
  pdf417(2),

  /// Aztec 2D codes.
  aztec(3),

  /// Data Matrix 2D codes.
  dataMatrix(4);

  const ScanType(this.value);

  /// Integer value sent to the scanner web layer.
  final int value;
}
