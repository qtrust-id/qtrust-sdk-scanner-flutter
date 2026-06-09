"use strict";

// Page-visibility lifecycle — release and re-acquire the camera around
// background/foreground transitions.
//
// When the host app is backgrounded (the user opens the native camera/scanner,
// takes a call, locks the screen…) the OS seizes the camera and mutes/ends the
// getUserMedia MediaStreamTrack. The <video> element is left holding a dead
// track, so on return it shows a frozen last frame while the capture loop keeps
// redrawing it — the scanner "freezes". WKWebView and modern Android System
// WebView both dispatch the Page Visibility API events on these transitions, so
// handling them here fixes every platform from the single shared web bundle.
//
// Strategy: on hidden, fully stop capture + camera (releases the hardware so the
// foreground app gets a clean handle); on visible, re-open the camera and
// restart capture. The on-device decoder stays loaded (wasmReady), so resume
// only needs to re-acquire the stream.

import { state } from "./state.js";
import { dbg } from "./debug.js";
import { openCamera, stopCamera } from "./camera.js";
import { tryStartCapture, stopCapture } from "./capture.js";
import { bridgeError } from "./bridge.js";

function onHidden() {
    // Only act on a live scan session — ignore transitions on home/tutorial.
    if (!state.scanActive || state.suspendedForVisibility) return;
    dbg("lifecycle: hidden — releasing camera");
    state.suspendedForVisibility = true;
    // The stream is about to be muted/ended by the OS; drop it now so resume
    // re-acquires a fresh one instead of reusing a dead track.
    state.cameraReady = false;
    stopCapture();
    stopCamera();
}

function onVisible() {
    // Resume only what we ourselves suspended — never resurrect a session the
    // app explicitly stopped while backgrounded.
    if (!state.scanActive || !state.suspendedForVisibility) return;
    state.suspendedForVisibility = false;
    dbg("lifecycle: visible — re-acquiring camera");
    openCamera().then(function () {
        // RACE: the session may have been stopped between visible and the
        // getUserMedia resolve. camera.js already releases the stream in that
        // case; mirror the guard so we don't drive a dead capture loop.
        if (!state.scanActive) return;
        state.cameraReady = true;
        tryStartCapture();
    }).catch(function (err) {
        dbg("lifecycle: camera re-acquire failed: " + (err ? err.message : "unknown"));
        bridgeError("camera error: " + (err ? err.message : "unknown"));
    });
}

/**
 * Wire the Page Visibility listener. Idempotent-safe to call once at boot.
 */
export function initLifecycle() {
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
            onHidden();
        } else if (document.visibilityState === "visible") {
            onVisible();
        }
    });
    dbg("lifecycle: visibility handler installed");
}
