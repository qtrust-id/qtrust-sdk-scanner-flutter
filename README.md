# QTrust Scanner — Flutter SDK

Cloud-based QR & barcode scanner for Flutter. Drop in a widget, pass your API
key, and receive decoded results via callback.

The SDK vendors the scanner web UI locally and serves it over a `localhost`
secure origin inside a WebView. Scanning works offline; the page still tries the
cloud WebSocket first and only falls back to the on-device decoder when the
cloud is unreachable. This mirrors the Android (`sdk-android`) and iOS
(`sdk-ios`) SDKs — all three vendor the same web bundle from `cloud/web`.

## Why a WebView + localhost

`getUserMedia` (camera) is blocked under a raw `file://` origin on Android, and
ES modules need a real origin too. Serving the bundled assets over
`http://localhost` — a secure context on both Android and iOS — unlocks both.
The SDK starts a shared [`InAppLocalhostServer`][server] automatically.

[server]: https://pub.dev/documentation/flutter_inappwebview/latest/

## Install

```yaml
dependencies:
  qtrust_scanner:
    path: ../sdk-flutter   # or a published/git ref
```

`flutter_inappwebview` comes transitively.

## Platform setup

### Android

Add the camera permission to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

`minSdkVersion 21+`. The host app must hold the `CAMERA` runtime permission
**before** mounting the scanner (use `permission_handler` or equivalent). The
WebView-level camera request is auto-granted by the SDK.

### iOS

Add to `ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Scan QR codes and barcodes.</string>
```

`platform :ios, '15.0'` or higher in the Podfile.

## Usage

```dart
import 'package:qtrust_scanner/qtrust_scanner.dart';

QtrustScannerView(
  config: ScannerConfig(
    apiKey: 'sk_live_...',
    // baseUrl, timeout, vendorConfig are optional
  ),
  type: ScanType.qr,            // or ScanType.barcode
  onResult: (result) {
    print('${result.format}: ${result.data}');
  },
  onError: (error) => print(error.message),
  onReady: () => print('scanner connected'),
  onClose: () => Navigator.of(context).pop(),
)
```

The widget owns the camera lifecycle — it tears the WebView down on `dispose`,
so you never stop it manually.

### One-shot scan

The widget delivers a stream of results. For a single result, pop on the first
callback (see `example/lib/main.dart`):

```dart
final result = await Navigator.of(context).push<ScanResult>(
  MaterialPageRoute(
    builder: (_) => Scaffold(
      body: QtrustScannerView(
        config: config,
        type: ScanType.qr,
        onResult: (r) => Navigator.of(context).pop(r),
        onClose: () => Navigator.of(context).pop(),
      ),
    ),
  ),
);
```

## Configuration

`ScannerConfig`:

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | — (required) | API key for the scanner service |
| `baseUrl` | `https://scan.qtrust.id` | Cloud service base URL |
| `timeout` | `30s` | Max wait for a result (one-shot flows) |
| `vendorConfig` | `VendorConfig()` | Vendor UI settings |

`VendorConfig`: `vendorId`, `textHintScan`, `theme` (`ScannerTheme.dark`/`light`),
`locale` (`ScannerLocale.id`/`en`), `skipTutorial` (default `true`).

## API surface

- `QtrustScannerView` — the widget.
- `ScannerConfig`, `VendorConfig`, `ScannerTheme`, `ScannerLocale`.
- `ScanType` — `qr`, `barcode`.
- `ScanResult` — `data`, `format`, `boundingBox`.
- `ScannerError` — `kind` (`connectionFailed`, `permissionDenied`, `timeout`,
  `serverError`), `message`.

## Keeping web assets in sync

The web bundle under `assets/scanner/` is vendored from `cloud/web` (the single
source of truth). Regenerate all SDK copies — including this one — with:

```bash
scripts/sync-web-assets.sh          # rebuild + copy
scripts/sync-web-assets.sh --check  # CI: fail if any copy is stale
```

## Example

```bash
cd example
flutter create .    # scaffold android/ ios/ once
flutter run
```

Add the platform permissions above before running.
