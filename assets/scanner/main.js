"use strict";

import { state, ScanType } from "./modules/state.js";
import { dbg } from "./modules/debug.js";
import { bridgeResult, bridgeError, bridgeClose, bridgeReady } from "./modules/bridge.js";
import { openCamera, toggleFlash, applyZoom, stopCamera } from "./modules/camera.js";
import { tryStartCapture, stopCapture, terminateWorker } from "./modules/capture.js";
import { connectWS, setWSCallbacks, closeWS, goOffline } from "./modules/websocket.js";
import { setDecodeCallbacks } from "./modules/decode.js";
import { initEmbed } from "./modules/embed.js";
import {
    showScanner, showHome, showHomeWithError, showResultOnHome,
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
// websocket.js / decode.js cannot import ui.js (would create circular dep),
// so result/error callbacks are injected here. The result handler is identical
// for both decode backends (cloud WS and on-device wasm) — callers never need
// to know which produced the result.
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

setWSCallbacks({
    onAuthFail: function (msg) {
        showHomeWithError(msg);
    },
    onRateLimit: function (msg) {
        showHomeWithError(msg);
    },
    onResult: handleResult,
});

// Offline (on-device wasm) decode shares the same result handler.
setDecodeCallbacks({ onResult: handleResult });

// ── Scanner flow (PARALLEL init) ───────────────────────
// Camera open and WebSocket connect run simultaneously.
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
    state.wsAuthed = false;
    // Online is primary: each (re)start attempts the cloud first, falling back
    // to on-device decode only if it proves unreachable (see websocket.js).
    state.decodeMode = "ws";
    // Per-session latches — clear stale values from a prior scan so the reconnect
    // budget, ready signal, and auth-rejection guard all start fresh.
    state.reconnectAttempts = 0;
    state.readySignaled = false;
    state.authRejected = false;
    state.fps = state.scanType === ScanType.BARCODE ? 10 : 5;
    applyViewfinderMode();

    // Camera — marks cameraReady on success
    openCamera().then(function () {
        dbg("camera open OK");
        state.cameraReady = true;
        tryStartCapture();
    }).catch(function (err) {
        dbg("ERROR camera: " + (err ? err.message : "unknown"));
        // Reset so a later init can retry after a transient camera failure.
        state.scanActive = false;
        bridgeError("camera error: " + (err ? err.message : "unknown"));
    });

    // WebSocket — marks wsAuthed on auth_ok (inside websocket.js).
    // No server configured → go straight to on-device decode.
    if (state.serverUrl) {
        connectWS();
    } else {
        goOffline("no server url");
    }
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

btnBack.addEventListener("click", function () {
    if (state.isSDKMode) {
        bridgeClose();
    } else {
        showHome();
    }
});

btnFlashEl.addEventListener("click", toggleFlash);
btnZoomIn.addEventListener("click", function () { applyZoom(state.currentZoom + state.zoomStep); });
btnZoomOut.addEventListener("click", function () { applyZoom(state.currentZoom - state.zoomStep); });

// ── Native bridge API ──────────────────────────────────
/**
 * Called by host app: ScannerInit({ key, serverUrl, type, config })
 * @param {Object} opts
 * @param {string}  opts.key       — API key
 * @param {string}  opts.serverUrl — WebSocket server URL
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
    dbg("ScannerInit: serverUrl=" + opts.serverUrl + " type=" + opts.type);
    state.apiKey = opts.key || "";
    state.serverUrl = opts.serverUrl || "";
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
        dbg("ScannerInit: config=" + JSON.stringify(state.config));
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
    } else if (!state.wsAuthed) {
        connectWS();
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

// Legacy compat
window.ScannerSetAPIKey = function (key) {
    state.apiKey = key;
    if (state.serverUrl) { connectWS(); }
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
    terminateWorker();
    stopCamera();
    closeWS();
    state.scanActive = false;  // allow a subsequent sdk_init to start fresh
});
