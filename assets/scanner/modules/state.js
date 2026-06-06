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

/** Map ScanType enum to canonical name string */
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

    // Embed (web SDK) — loaded inside an iframe with ?embed=1. The web SDK
    // drives this page via postMessage instead of injected JS. See embed.js
    // and sdk-web/PROTOCOL.md.
    // Folded into the literal so all initial values are visible in one place.
    isEmbed: bootParam("embed") === "1",
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

    // Capture frame rate (frames/sec handed to the on-device decoder).
    fps: 5,

    // On-device decode backend (zxing-wasm). Loaded lazily on first scan.
    wasmReady: false,

    // Ready-signal latch — bridgeReady() must fire at most once per scan session.
    readySignaled: false,

    // Capture
    captureTimer: null,
    captureWidth: 0,
    captureHeight: 0,
    captureCrop: null,

    // Ready gate — capture starts once the camera and decoder are both ready.
    cameraReady: false,

    // Idempotency guard — a repeated ScannerInit (the web SDK fires sdk_init on
    // start + iframe load + sdk_ready to beat load-order races) must NOT re-open
    // the camera, or the second getUserMedia aborts the first video.play().
    scanActive: false,
};

// Embedded web SDK runs as a headless scanner surface — the consumer page is
// the host (their own "home"), exactly like native: embed implies SDK mode.
// isEmbed is already initialised above (folded into the literal).
// isSDKMode depends on isEmbed, so it must be derived after the object exists.
state.isSDKMode = state.mode === "sdk" || state.isEmbed;
