"use strict";

import { state, ScanType } from "./state.js";
import { dbg } from "./debug.js";
import { isWasmMode, decodeFrame } from "./decode.js";

var video = document.getElementById("video");
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

// ── Feature detection ──────────────────────────────────
var HAS_OFFSCREEN_CANVAS = typeof OffscreenCanvas !== "undefined";
var HAS_CREATE_IMAGE_BITMAP = typeof createImageBitmap === "function";
var useBinaryPipeline = HAS_OFFSCREEN_CANVAS && HAS_CREATE_IMAGE_BITMAP;

// ── Worker setup ───────────────────────────────────────
var worker = null;
var workerReady = false;

if (useBinaryPipeline) {
    try {
        worker = new Worker("capture-worker.js");
        worker.onmessage = function (e) {
            // Worker returns ArrayBuffer — send binary over WS
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(e.data);
            }
        };
        worker.onerror = function (err) {
            dbg("worker error: " + err.message + " — falling back to legacy");
            useBinaryPipeline = false;
            workerReady = false;
        };
        workerReady = true;
        dbg("capture: binary pipeline (OffscreenCanvas + Worker)");
    } catch (err) {
        dbg("worker init failed: " + err.message + " — falling back to legacy");
        useBinaryPipeline = false;
    }
} else {
    dbg("capture: legacy pipeline (toDataURL + JSON)");
}

/**
 * Map viewfinder screen rect to video pixel coordinates.
 * Accounts for object-fit:cover scaling and cropping.
 */
export function computeViewfinderCrop(videoW, videoH) {
    var vfEl = document.getElementById("viewfinder");
    if (!vfEl) return null;

    var elW = video.clientWidth;
    var elH = video.clientHeight;
    if (elW === 0 || elH === 0) return null;

    var videoAspect = videoW / videoH;
    var elAspect = elW / elH;
    var scale, offsetX, offsetY;

    if (videoAspect > elAspect) {
        scale = elH / videoH;
        offsetX = (videoW * scale - elW) / 2;
        offsetY = 0;
    } else {
        scale = elW / videoW;
        offsetX = 0;
        offsetY = (videoH * scale - elH) / 2;
    }

    var vfRect = vfEl.getBoundingClientRect();
    var vidRect = video.getBoundingClientRect();

    var x = Math.round(((vfRect.left - vidRect.left) + offsetX) / scale);
    var y = Math.round(((vfRect.top - vidRect.top) + offsetY) / scale);
    var w = Math.round(vfRect.width / scale);
    var h = Math.round(vfRect.height / scale);

    // Clamp to video bounds
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(videoW - x, w);
    h = Math.min(videoH - y, h);

    return { x: x, y: y, w: w, h: h };
}

export function startCapture() {
    stopCapture();
    captureLoop();
}

export function stopCapture() {
    if (state.captureTimer) {
        clearTimeout(state.captureTimer);
        state.captureTimer = null;
    }
}

export function terminateWorker() {
    if (worker) {
        worker.terminate();
        worker = null;
        workerReady = false;
    }
}

/**
 * Ready gate — starts capture only when BOTH camera and WebSocket are ready.
 * Called from camera.js (after openCamera) and websocket.js (after auth_ok).
 */
export function tryStartCapture() {
    // Gate: camera + the CURRENTLY selected decode backend. Online needs WS
    // auth; offline fallback needs the wasm reader loaded. Checking the active
    // backend (not "either") avoids a stale wasmReady from a prior offline
    // session starting capture before the WS reauths on a later online restart.
    var backendReady = isWasmMode() ? state.wasmReady : state.wsAuthed;
    if (state.cameraReady && backendReady) {
        dbg("ready — starting capture (" + state.decodeMode + ")");
        startCapture();
    }
}

// ── Binary pipeline ────────────────────────────────────
// createImageBitmap crops directly from video (no canvas needed on main thread).
// Worker encodes JPEG via OffscreenCanvas — main thread stays free.

function captureBinary() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    var quality = state.scanType === ScanType.BARCODE ? 0.7 : 0.85;
    var timestamp = Date.now();
    var bitmapPromise;

    if (state.captureCrop) {
        bitmapPromise = createImageBitmap(video,
            state.captureCrop.x, state.captureCrop.y,
            state.captureCrop.w, state.captureCrop.h);
    } else {
        bitmapPromise = createImageBitmap(video);
    }

    bitmapPromise.then(function (bitmap) {
        // Transfer bitmap to worker — zero-copy
        worker.postMessage(
            { bitmap: bitmap, quality: quality, timestamp: timestamp },
            [bitmap]
        );
    }).catch(function (err) {
        dbg("createImageBitmap error: " + err.message);
    });

    state.captureTimer = setTimeout(captureLoop, 1000 / state.fps);
}

// ── Legacy pipeline (fallback) ─────────────────────────
// toDataURL + base64 + JSON — works on all browsers.

function captureLegacy() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    if (state.captureCrop) {
        ctx.drawImage(video,
            state.captureCrop.x, state.captureCrop.y, state.captureCrop.w, state.captureCrop.h,
            0, 0, state.captureWidth, state.captureHeight);
    } else {
        ctx.drawImage(video, 0, 0, state.captureWidth, state.captureHeight);
    }

    var quality = state.scanType === ScanType.BARCODE ? 0.7 : 0.85;
    var dataUrl = canvas.toDataURL("image/jpeg", quality);
    var base64 = dataUrl.split(",")[1];
    state.ws.send(JSON.stringify({ type: "frame", data: base64, timestamp: Date.now() }));
    state.captureTimer = setTimeout(captureLoop, 1000 / state.fps);
}

// ── WASM pipeline (offline fallback) ───────────────────
// Decode the frame on-device — no socket, no JPEG encode. Draw the (cropped)
// frame to the 2D canvas and hand the raw ImageData to zxing-wasm. decodeFrame
// is internally throttled, so a slow decode just drops the next frame.

function captureWasm() {
    if (state.captureCrop) {
        ctx.drawImage(video,
            state.captureCrop.x, state.captureCrop.y, state.captureCrop.w, state.captureCrop.h,
            0, 0, state.captureWidth, state.captureHeight);
    } else {
        ctx.drawImage(video, 0, 0, state.captureWidth, state.captureHeight);
    }

    var imageData = ctx.getImageData(0, 0, state.captureWidth, state.captureHeight);
    decodeFrame(imageData);
    state.captureTimer = setTimeout(captureLoop, 1000 / state.fps);
}

// ── Unified loop ───────────────────────────────────────

function captureLoop() {
    if (isWasmMode()) {
        captureWasm();
    } else if (useBinaryPipeline && workerReady) {
        captureBinary();
    } else {
        captureLegacy();
    }
}
