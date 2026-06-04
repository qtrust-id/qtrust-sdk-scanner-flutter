"use strict";

// Boot config — native iOS loads the page from a file:// URL, which cannot
// reliably carry a query string (WKWebView fails the navigation with a spurious
// network error). The host injects window.__SCANNER_BOOT__ via a documentStart
// user script instead. Falls back to URL query params (Android https origin and
// the web build) when the global is absent.
var boot = (typeof window !== "undefined" && window.__SCANNER_BOOT__) || {};
var params = new URLSearchParams(location.search);

/**
 * Read a boot value, preferring the injected boot config over the URL query.
 * @param {string} name
 * @returns {string|number|null}
 */
function bootParam(name) {
    return boot[name] !== undefined && boot[name] !== null ? boot[name] : params.get(name);
}

// ── Enums ─────────────────────────────────────────────
/** @enum {number} */
export var ScanType = { QR: 0, BARCODE: 1 };
/** @enum {number} */
export var Theme = { DARK: 0, LIGHT: 1 };
/** @enum {number} */
export var Locale = { ID: 0, EN: 1 };

/** Map ScanType enum to WS query param string */
export var SCAN_TYPE_NAMES = ["qr", "barcode"];

/**
 * Parse legacy string param ("qr"/"barcode") or int to ScanType enum.
 * @param {string|null} raw
 * @returns {number}
 */
function parseScanType(raw) {
    if (raw === "barcode" || raw === "1" || raw === 1) return ScanType.BARCODE;
    return ScanType.QR;
}

/**
 * Shared mutable state — single source of truth across all modules.
 * Only mutate via module functions, never from outside the app.
 */
export var state = {
    scanType: parseScanType(bootParam("type")),
    mode: bootParam("mode") || "home",
    apiKey: bootParam("key") || "",
    serverUrl: "",
    isSDKMode: false,

    // Embed (web SDK) — loaded inside an iframe with ?embed=1. The web SDK
    // drives this page via postMessage instead of injected JS. See embed.js
    // and sdk-web/PROTOCOL.md.
    isEmbed: false,
    parentOrigin: "",  // locked origin of the embedding parent page

    // Vendor config — set via ScannerInit({ config }) or ScannerUpdateConfig()
    config: {
        vendorId: "",
        textHintScan: "",  // empty = use default per scanType
        theme: Theme.DARK,
        locale: Locale.ID,
        skipTutorial: false,  // SDK overrides to true via ScannerInit
        // Per-vendor symbology override, e.g. "PDF417|QRCode". Empty = server
        // default per scanType (PDF417 for barcode, QR family for qr).
        formats: bootParam("formats") || "",
    },

    // Camera
    stream: null,
    flashOn: false,
    currentZoom: 1,
    minZoom: 1,
    maxZoom: 1,
    zoomStep: 0.5,
    hasNativeZoom: false,

    // WebSocket
    ws: null,
    fps: 5,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,

    // Decode backend — "ws" = cloud decode (primary), "wasm" = on-device
    // zxing-wasm fallback, used when the cloud is unreachable (offline mode).
    decodeMode: "ws",
    wasmReady: false,

    // Auth-rejection latch — set when the server reachably rejects the key
    // (WS close 4001/4029). Once set, offline fallback is forbidden for the rest
    // of the session, even if a connect-timeout fallback raced ahead of the
    // close frame. Prevents bypassing API-key auth via the offline path.
    authRejected: false,

    // Ready-signal latch — bridgeReady() must fire at most once per scan session
    // (auth_ok and a later goOffline could otherwise both signal ready).
    readySignaled: false,

    // Capture
    captureTimer: null,
    captureWidth: 0,
    captureHeight: 0,
    captureCrop: null,

    // Ready gate — parallel init requires both before capture starts
    cameraReady: false,
    wsAuthed: false,

    // Idempotency guard — a repeated ScannerInit (the web SDK fires sdk_init on
    // start + iframe load + sdk_ready to beat load-order races) must NOT re-open
    // the camera, or the second getUserMedia aborts the first video.play().
    scanActive: false,
};

// Embedded web SDK runs as a headless scanner surface — the consumer page is
// the host (their own "home"), exactly like native: embed implies SDK mode.
state.isEmbed = bootParam("embed") === "1";
state.isSDKMode = state.mode === "sdk" || state.isEmbed;

// Default server URL from current host when served over HTTP
if (location.protocol !== "file:") {
    state.serverUrl = location.protocol + "//" + location.host;
}
