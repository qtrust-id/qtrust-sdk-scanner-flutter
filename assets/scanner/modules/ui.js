"use strict";

import { state, ScanType } from "./state.js";
import { stopCapture } from "./capture.js";
import { stopCamera } from "./camera.js";

var homeScreen = document.getElementById("home-screen");
var scannerContainer = document.getElementById("scanner-container");
var tutorialScreen = document.getElementById("tutorial-screen");
var resultScreen = document.getElementById("result-screen");
var homeResultSection = document.getElementById("home-result");
var resultDataEl = document.getElementById("result-data");
var resultFormatEl = document.getElementById("result-format");
var flashOverlay = document.getElementById("flash-overlay");
var viewfinder = document.getElementById("viewfinder");
var scanInstructionText = document.getElementById("scan-instruction-text");

function hideAllScreens() {
    homeScreen.classList.add("hidden");
    scannerContainer.classList.add("hidden");
    if (tutorialScreen) tutorialScreen.classList.add("hidden");
    if (resultScreen) resultScreen.classList.add("hidden");
}

export function showScanner() {
    hideAllScreens();
    scannerContainer.classList.remove("hidden");
}

export function showTutorial() {
    hideAllScreens();
    if (tutorialScreen) tutorialScreen.classList.remove("hidden");
}

export function showHome() {
    stopCapture();
    stopCamera();
    state.cameraReady = false;
    state.scanActive = false;  // pipeline down — allow a fresh start
    hideAllScreens();
    homeScreen.classList.remove("hidden");
}

export function showResultOnHome(data) {
    if (!homeResultSection) return;
    homeResultSection.classList.remove("hidden");
    if (resultDataEl) resultDataEl.textContent = data.data || "";
    if (resultFormatEl) resultFormatEl.textContent = data.format || "";
}

// Idempotency flags — each init function must bind at most once.
var _resultScreenBound = false;
var _tutorialScreenBound = false;
var _homeScreenBound = false;

/**
 * Initialize result screen event listeners.
 * Idempotent — safe to call multiple times; listeners are bound only once.
 * @param {Function} onScanAgain — called when user taps "Scan Lagi"
 * @param {Function} onReport — called when user taps "Lapor"
 */
export function initResultScreen(onScanAgain, onReport) {
    if (_resultScreenBound) return;
    _resultScreenBound = true;

    var btnScanAgain = document.getElementById("btn-scan-again");
    var btnReport = document.getElementById("btn-result-report");

    if (btnScanAgain) {
        btnScanAgain.addEventListener("click", function () {
            if (onScanAgain) onScanAgain();
        });
    }
    if (btnReport) {
        btnReport.addEventListener("click", function () {
            if (onReport) onReport();
        });
    }
}

export function showFlash() {
    flashOverlay.classList.remove("hidden");
    flashOverlay.classList.add("flash");
    setTimeout(function () {
        flashOverlay.classList.remove("flash");
        setTimeout(function () { flashOverlay.classList.add("hidden"); }, 150);
    }, 100);
}

export function applyViewfinderMode() {
    var isBarcode = state.scanType === ScanType.BARCODE;
    if (viewfinder) viewfinder.classList.toggle("barcode-mode", isBarcode);
    if (scanInstructionText) {
        // Vendor override via config.textHintScan; fallback to default per scanType
        if (state.config.textHintScan) {
            scanInstructionText.textContent = state.config.textHintScan;
        } else {
            scanInstructionText.textContent = isBarcode
                ? "Arahkan ke Barcode pada kemasan"
                : "Arahkan ke QR Code pada kemasan";
        }
    }
}

/**
 * Initialize tutorial screen event listeners.
 * Idempotent — safe to call multiple times; listeners are bound only once.
 * @param {Function} onStartScan — called when user taps "Mulai Scan"
 * @param {Function} onBack — called when user taps back arrow
 */
export function initTutorialScreen(onStartScan, onBack) {
    if (_tutorialScreenBound) return;
    _tutorialScreenBound = true;

    var btnStart = document.getElementById("btn-tutorial-start");
    var btnBack = document.getElementById("btn-tutorial-back");

    if (btnStart) {
        btnStart.addEventListener("click", onStartScan);
    }
    if (btnBack) {
        btnBack.addEventListener("click", onBack);
    }
}

/**
 * Initialize home screen event listeners.
 * Idempotent — safe to call multiple times; listeners are bound only once.
 * @param {Function} onStartScan — called when user taps "Start Scanning"
 */
export function initHomeScreen(onStartScan) {
    if (_homeScreenBound) return;
    _homeScreenBound = true;

    var scanTypeBtns = document.querySelectorAll(".scan-type-btn");
    var btnStartScan = document.getElementById("btn-start-scan");
    var toggleSkipTutorial = document.getElementById("toggle-skip-tutorial");

    // Sync toggles with state defaults
    if (toggleSkipTutorial) {
        toggleSkipTutorial.checked = state.config.skipTutorial;
        toggleSkipTutorial.addEventListener("change", function () {
            state.config.skipTutorial = toggleSkipTutorial.checked;
        });
    }

    scanTypeBtns.forEach(function (btn) {
        if (parseInt(btn.getAttribute("data-type"), 10) === state.scanType) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }

        btn.addEventListener("click", function () {
            var parsed = parseInt(btn.getAttribute("data-type"), 10);
            // Validate parsed value against known ScanType set — ignore NaN or unknown.
            if (parsed !== ScanType.QR && parsed !== ScanType.BARCODE) return;
            scanTypeBtns.forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            state.scanType = parsed;
        });
    });

    if (btnStartScan) {
        btnStartScan.addEventListener("click", function () {
            onStartScan();
        });
    }
}
