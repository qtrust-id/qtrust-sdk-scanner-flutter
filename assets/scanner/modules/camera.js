"use strict";

import { state, ScanType } from "./state.js";
import { dbg } from "./debug.js";
import { computeViewfinderCrop } from "./capture.js";

var video = document.getElementById("video");
var canvas = document.getElementById("canvas");
var status = document.getElementById("status");
var zoomControls = document.getElementById("zoom-controls");
var zoomLevelEl = document.getElementById("zoom-level");
var btnFlash = document.getElementById("btn-flash");

var FACING_MODE = "environment";

export function openCamera() {
    dbg("openCamera: facingMode=" + FACING_MODE);
    status.textContent = "Opening camera...";

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        dbg("ERROR: getUserMedia not available (secure context: " + window.isSecureContext + ")");
        status.textContent = "Camera API not available";
        return Promise.reject(new Error("getUserMedia not supported"));
    }

    dbg("calling getUserMedia...");
    return navigator.mediaDevices.getUserMedia({
        video: { facingMode: FACING_MODE, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
    }).then(function (s) {
        dbg("got stream, tracks=" + s.getTracks().length);
        state.stream = s;
        video.srcObject = state.stream;
        // Reveal only once real frames flow — keeps the WebView play-button
        // overlay hidden while the video is still paused/buffering.
        video.addEventListener("playing", function onPlaying() {
            video.removeEventListener("playing", onPlaying);
            video.classList.add("playing");
        });
        return video.play().then(function () {
            var vw = video.videoWidth || 640;
            var vh = video.videoHeight || 480;
            dbg("play() ok, " + vw + "x" + vh);

            if (state.scanType === ScanType.BARCODE) {
                state.captureCrop = computeViewfinderCrop(vw, vh);
                if (state.captureCrop && state.captureCrop.w > 0 && state.captureCrop.h > 0) {
                    state.captureWidth = state.captureCrop.w;
                    state.captureHeight = state.captureCrop.h;
                    dbg("viewfinder crop: " + state.captureCrop.x + "," + state.captureCrop.y +
                        " " + state.captureCrop.w + "x" + state.captureCrop.h);
                } else {
                    state.captureCrop = null;
                    state.captureWidth = Math.min(640, vw);
                    state.captureHeight = Math.round(vh * (state.captureWidth / vw));
                }
            } else {
                state.captureCrop = null;
                state.captureWidth = vw;
                state.captureHeight = vh;
            }
            canvas.width = state.captureWidth;
            canvas.height = state.captureHeight;
            dbg("capture: " + state.captureWidth + "x" + state.captureHeight);

            status.textContent = "Scanning...";
        });
    }).then(function () {
        initZoomCapabilities();
    }).catch(function (err) {
        dbg("ERROR getUserMedia: " + err.name + " - " + err.message);
        status.textContent = "Camera: " + err.message;
        throw err;
    });
}

function initZoomCapabilities() {
    if (zoomControls) zoomControls.style.display = "none";
    state.currentZoom = 1;
    state.hasNativeZoom = false;

    if (!state.stream) { updateZoomUI(); return; }
    var track = state.stream.getVideoTracks()[0];
    if (!track) { updateZoomUI(); return; }
    var caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom) {
        state.hasNativeZoom = true;
        state.minZoom = caps.zoom.min || 1;
        state.maxZoom = caps.zoom.max || 1;
        state.currentZoom = track.getSettings().zoom || state.minZoom;
        state.zoomStep = Math.max(0.1, (state.maxZoom - state.minZoom) / 10);
        dbg("zoom native: min=" + state.minZoom + " max=" + state.maxZoom);
    } else {
        state.minZoom = 1;
        state.maxZoom = 5;
        state.zoomStep = 0.5;
        dbg("zoom: CSS fallback mode");
    }
    updateZoomUI();
}

export function applyZoom(level) {
    state.currentZoom = Math.max(state.minZoom, Math.min(state.maxZoom, level));
    state.currentZoom = Math.round(state.currentZoom * 10) / 10;

    if (state.hasNativeZoom && state.stream) {
        var track = state.stream.getVideoTracks()[0];
        if (track) {
            track.applyConstraints({ advanced: [{ zoom: state.currentZoom }] }).catch(function (err) {
                dbg("zoom error: " + err.message);
            });
        }
    } else {
        video.style.transform = "scale(" + state.currentZoom + ")";
    }
    updateZoomUI();
}

function updateZoomUI() {
    if (zoomLevelEl) zoomLevelEl.textContent = state.currentZoom.toFixed(1) + "x";
}

export function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(function (t) { t.stop(); });
        state.stream = null;
    }
    // Re-hide so a fresh start doesn't flash the paused-video play overlay.
    video.classList.remove("playing");
    video.srcObject = null;
}

export function toggleFlash() {
    if (!state.stream) return;
    var track = state.stream.getVideoTracks()[0];
    state.flashOn = !state.flashOn;
    track.applyConstraints({ advanced: [{ torch: state.flashOn }] }).then(function () {
        btnFlash.classList.toggle("active", state.flashOn);
    }).catch(function () {
        state.flashOn = false;
        btnFlash.classList.remove("active");
    });
}
