"use strict";

import { state, ScanType } from "./modules/state.js";
import { dbg } from "./modules/debug.js";
import { bridgeResult, bridgeError, bridgeClose, bridgeReady } from "./modules/bridge.js";
import { openCamera, toggleFlash, applyZoom, stopCamera } from "./modules/camera.js";
import { tryStartCapture, stopCapture } from "./modules/capture.js";
import { setDecodeCallbacks, ensureDecoder } from "./modules/decode.js";
import { initEmbed, teardownEmbed } from "./modules/embed.js";
import {
    showScanner, showHome, showResultOnHome,
    showFlash, showTutorial, applyViewfinderMode,
    initHomeScreen, initTutorialScreen, initResultScreen
} from "./modules/ui.js";

// ── Debug overlay ──────────────────────────────────────
(function () {
    var p = new URLSearchParams(location.search);
    if (p.get("debug") === "1") {
        var el = document.getElementById("debug");
        if (el) el.classList.add("visible");
    }
})();

// ── Cross-module wiring ────────────────────────────────
// decode.js cannot import ui.js (would create circular dep), so the result
// callback is injected here.
function handleResult(data) {
    // SDK mode (native WebView + web-SDK iframe) hands the raw result to the host
    // and lets it own result presentation. Skip the white flash overlay — it
    // reads as a distracting screen blink when the host owns the UI.
    if (state.isSDKMode) {
        bridgeResult(data);
        return;
    }
    showFlash();
    // Standalone web demo — show the raw scan data inline on home. The dedicated
    // result page is retired (it rendered placeholder vendor data, not the scan).
    showResultOnHome(data);
    showHome();
}

setDecodeCallbacks({ onResult: handleResult });

// ── Scanner flow (PARALLEL init) ───────────────────────
// Camera open and on-device decoder load run simultaneously.
// Capture starts only when BOTH are ready (ready gate in capture.js).

function startScannerFlow() {
    // Idempotent — the web SDK fires sdk_init on start + iframe load + sdk_ready
    // to beat load-order races, so ScannerInit can land 2–3×. Re-entry while
    // already running is a no-op; otherwise the second getUserMedia aborts the
    // first video.play() ("play() interrupted by a new load request").
    if (state.scanActive) {
        dbg("startScannerFlow: already active, skip");
        return;
    }
    state.scanActive = true;
    dbg("startScannerFlow: type=" + state.scanType);
    state.cameraReady = false;
    // Per-session latch — clear the ready signal from a prior scan.
    state.readySignaled = false;
    state.fps = state.scanType === ScanType.BARCODE ? 10 : 5;
    applyViewfinderMode();

    // Camera — marks cameraReady on success
    openCamera().then(function () {
        // RACE: stop() may have fired while getUserMedia was in flight.
        // camera.js already releases the stream in that case; mirror the guard
        // here so we don't flip cameraReady=true and drive a dead capture loop.
        if (!state.scanActive) return;
        dbg("camera open OK");
        state.cameraReady = true;
        tryStartCapture();
    }).catch(function (err) {
        dbg("ERROR camera: " + (err ? err.message : "unknown"));
        // Reset so a later init can retry after a transient camera failure.
        state.scanActive = false;
        bridgeError("camera error: " + (err ? err.message : "unknown"));
    });

    // On-device decoder — marks wasmReady once the zxing-wasm module loads.
    ensureDecoder().then(function (ok) {
        if (!state.scanActive) return;  // stopped while loading — don't resurrect
        if (ok) {
            bridgeReady();
            tryStartCapture();
        } else {
            bridgeError("decoder unavailable");
        }
    });
}

// ── Proceed to scanner (shared by tutorial + skip path) ─
function proceedToScanner() {
    showScanner();
    startScannerFlow();
}

// ── Mode routing ───────────────────────────────────────
var homeScreen = document.getElementById("home-screen");
var scannerContainer = document.getElementById("scanner-container");
var tutorialScreen = document.getElementById("tutorial-screen");

if (state.isSDKMode) {
    // SDK mode — hide all screens at boot, ScannerInit decides which to show
    document.body.classList.add("sdk-mode");
    homeScreen.classList.add("hidden");
    if (tutorialScreen) tutorialScreen.classList.add("hidden");
    scannerContainer.classList.add("hidden");
} else {
    homeScreen.classList.remove("hidden");
    scannerContainer.classList.add("hidden");
    if (tutorialScreen) tutorialScreen.classList.add("hidden");
}

// ── Home screen ────────────────────────────────────────
// Flow: Home → Tutorial → Scanner (or Home → Scanner if skip_tutorial=1)
initHomeScreen(function () {
    if (state.config.skipTutorial) {
        proceedToScanner();
    } else {
        showTutorial();
    }
});

// ── Tutorial screen ────────────────────────────────────
initTutorialScreen(
    function () { proceedToScanner(); },   // "Mulai Scan" → scanner
    function () {                          // back → close (SDK) or home (web)
        if (state.isSDKMode) {
            bridgeClose();
        } else {
            showHome();
        }
    }
);

// ── Result screen ──────────────────────────────────────
initResultScreen(
    function () { proceedToScanner(); },  // "Scan Lagi" → restart scanner
    function () {                         // "Lapor" → bridge close (SDK) or home (web)
        if (state.isSDKMode) {
            bridgeClose();
        } else {
            showHome();
        }
    }
);

// ── Button listeners ───────────────────────────────────
var btnBack = document.getElementById("btn-back");
var btnFlashEl = document.getElementById("btn-flash");
var btnZoomIn = document.getElementById("btn-zoom-in");
var btnZoomOut = document.getElementById("btn-zoom-out");

// Null-guard each button — SDK-only builds may omit some controls from the HTML.
if (btnBack) {
    btnBack.addEventListener("click", function () {
        if (state.isSDKMode) {
            bridgeClose();
        } else {
            showHome();
        }
    });
}

if (btnFlashEl) {
    btnFlashEl.addEventListener("click", toggleFlash);
}
if (btnZoomIn) {
    btnZoomIn.addEventListener("click", function () { applyZoom(state.currentZoom + state.zoomStep); });
}
if (btnZoomOut) {
    btnZoomOut.addEventListener("click", function () { applyZoom(state.currentZoom - state.zoomStep); });
}

// ── Native bridge API ──────────────────────────────────
/**
 * Called by host app: ScannerInit({ type, config })
 * @param {Object} opts
 * @param {number}  opts.type      — ScanType enum (0=QR, 1=BARCODE)
 * @param {Object} [opts.config]   — Vendor config
 * @param {string} [opts.config.vendorId]
 * @param {string} [opts.config.textHintScan]
 * @param {number}  [opts.config.theme]  — Theme enum (0=DARK, 1=LIGHT)
 * @param {number}  [opts.config.locale] — Locale enum (0=ID, 1=EN)
 * @param {boolean} [opts.config.skipTutorial] — true=skip tutorial (default), false=show tutorial
 * @param {string} [opts.config.formats]       — per-vendor symbology override, e.g. "PDF417|QRCode" (empty=default per type)
 */
window.ScannerInit = function (opts) {
    dbg("ScannerInit: type=" + opts.type);
    if (typeof opts.type === "number") {
        state.scanType = opts.type;
    }

    // Merge vendor config
    if (opts.config && typeof opts.config === "object") {
        var c = opts.config;
        if (c.vendorId !== undefined) state.config.vendorId = c.vendorId;
        if (c.textHintScan !== undefined) state.config.textHintScan = c.textHintScan;
        if (typeof c.theme === "number") state.config.theme = c.theme;
        if (typeof c.locale === "number") state.config.locale = c.locale;
        if (typeof c.skipTutorial === "boolean") state.config.skipTutorial = c.skipTutorial;
        if (typeof c.formats === "string") state.config.formats = c.formats;
        // Redact vendorId from debug output — it is a vendor credential.
        var dbgCfg = Object.assign({}, state.config, { vendorId: state.config.vendorId ? "[set]" : "" });
        dbg("ScannerInit: config=" + JSON.stringify(dbgCfg));
    }

    // Start scanner flow based on config
    if (state.isSDKMode) {
        if (state.config.skipTutorial) {
            proceedToScanner();
        } else {
            // Show tutorial and signal ready so native removes loading overlay
            showTutorial();
            bridgeReady();
        }
    }
};

/**
 * Runtime config update — callable anytime after page load.
 * Called by host app: ScannerUpdateConfig({ textHintScan, theme, ... })
 * @param {Object} updates — partial config to merge
 */
window.ScannerUpdateConfig = function (updates) {
    if (!updates || typeof updates !== "object") {
        dbg("ERROR: ScannerUpdateConfig expects object");
        return;
    }
    var c = updates;
    if (c.vendorId !== undefined) state.config.vendorId = c.vendorId;
    if (c.textHintScan !== undefined) state.config.textHintScan = c.textHintScan;
    if (typeof c.theme === "number") state.config.theme = c.theme;
    if (typeof c.locale === "number") state.config.locale = c.locale;
    if (typeof c.skipTutorial === "boolean") state.config.skipTutorial = c.skipTutorial;
    if (typeof c.formats === "string") state.config.formats = c.formats;
    dbg("ScannerUpdateConfig: " + JSON.stringify(state.config));
};

// ── Boot ───────────────────────────────────────────────
dbg("page loaded, secure=" + window.isSecureContext + " proto=" + location.protocol + " mode=" + state.mode);

if (state.isSDKMode) {
    // SDK mode — defer scanner start until ScannerInit delivers config.
    // startScannerFlow() is called inside ScannerInit after config is merged.
    dbg("SDK mode — waiting for ScannerInit...");
}

// ── Embed (web SDK) bridge ─────────────────────────────
// When loaded in an iframe (?embed=1) the parent page IS the host — it owns the
// "home" UI. This page is a headless scanner surface driven over postMessage.
// initEmbed wires the SDK handshake; sdk_init arrives as window.ScannerInit.
initEmbed(function onStop() {
    // qtrust:sdk_stop — fully tear down so a later sdk_init can cleanly restart.
    stopCapture();
    stopCamera();
    state.scanActive = false;  // allow a subsequent sdk_init to start fresh
    teardownEmbed();           // remove the message listener to prevent leaks
});
