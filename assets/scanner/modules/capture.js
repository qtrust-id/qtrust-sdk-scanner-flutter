"use strict";

import { state } from "./state.js";
import { dbg } from "./debug.js";
import { decodeFrame } from "./decode.js";

var video = document.getElementById("video");
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");

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

/**
 * Ready gate — starts capture only when BOTH the camera and the on-device
 * decoder are ready. Called from camera.js (after openCamera) and main.js
 * (after the wasm decoder loads).
 */
export function tryStartCapture() {
    if (state.cameraReady && state.wasmReady) {
        dbg("ready — starting capture");
        startCapture();
    }
}

// ── Capture loop ───────────────────────────────────────
// Decode each frame on-device. Draw the (cropped) frame to the 2D canvas and
// hand the raw ImageData to zxing-wasm. decodeFrame is internally throttled, so
// a slow decode just drops the next frame.

function captureLoop() {
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
