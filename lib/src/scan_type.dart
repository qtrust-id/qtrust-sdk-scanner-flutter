/// Type of code to scan.
///
/// The [value] is sent to the scanner web layer.
enum ScanType {
  /// QR codes.
  qr(0),

  /// Linear barcodes (EAN, UPC, Code128, etc.).
  barcode(1);

  const ScanType(this.value);

  /// Integer value sent to the scanner web layer.
  final int value;
}
