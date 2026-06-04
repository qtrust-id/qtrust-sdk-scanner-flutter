"use strict";

import { state, SCAN_TYPE_NAMES } from "./state.js";
import { dbg } from "./debug.js";
import { bridgeReady, bridgeError } from "./bridge.js";
import { stopCapture, tryStartCapture } from "./capture.js";
import { enableWasmFallback } from "./decode.js";

var status = document.getElementById("status");

// How long to wait for a successful auth before assuming the cloud is
// unreachable and switching to on-device decode.
var CONNECT_TIMEOUT_MS = 6000;
var connectTimer = null;
var reconnectTimer = null;

function clearConnectTimer() {
    if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
    }
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// Callbacks set by main.js — avoids circular import with ui.js
var _onAuthFail = null;
var _onRateLimit = null;
var _onResult = null;

export function setWSCallbacks(cbs) {
    _onAuthFail = cbs.onAuthFail;
    _onRateLimit = cbs.onRateLimit;
    _onResult = cbs.onResult;
}

export function connectWS() {
    if (!state.serverUrl) {
        dbg("ERROR: no serverUrl set");
        return;
    }

    // A fresh connect supersedes any pending reconnect attempt.
    clearReconnectTimer();

    // Known-offline at start — skip the socket attempt entirely and decode
    // on-device. navigator.onLine === false is a reliable negative signal.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
        goOffline("navigator offline");
        return;
    }

    // Close existing connection before opening new one — prevents orphaned
    // sockets when connectWS is called multiple times (e.g. startScannerFlow + ScannerInit).
    if (state.ws) {
        dbg("connectWS: closing existing WS before reconnect");
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
        state.ws = null;
    }

    var wsUrl = state.serverUrl.replace(/^http/, "ws") + "/ws?type=" + SCAN_TYPE_NAMES[state.scanType];
    // Per-vendor symbology override — backend restricts decode to these formats.
    if (state.config.formats) {
        wsUrl += "&formats=" + encodeURIComponent(state.config.formats);
    }
    dbg("connectWS: " + wsUrl);
    status.textContent = "Connecting...";
    state.ws = new WebSocket(wsUrl);

    // Guard against a socket that opens but never authenticates, or a host that
    // hangs without firing onerror/onclose — fall back to offline decode.
    clearConnectTimer();
    connectTimer = setTimeout(function () {
        if (!state.wsAuthed) goOffline("connect timeout");
    }, CONNECT_TIMEOUT_MS);

    state.ws.onopen = function () {
        dbg("WS open, sending auth");
        state.reconnectAttempts = 0;
        state.ws.send(JSON.stringify({ type: "auth", key: state.apiKey }));
    };

    state.ws.onmessage = function (e) {
        var msg;
        try {
            msg = JSON.parse(e.data);
        } catch (err) {
            dbg("ERROR: invalid WS message — " + (err ? err.message : "unknown"));
            return;
        }
        if (msg.type === "auth_ok") {
            dbg("auth OK");
            clearConnectTimer();
            status.textContent = "Scanning...";
            bridgeReady();
            state.wsAuthed = true;
            tryStartCapture();
            return;
        }
        if (msg.type === "result" && msg.data && typeof msg.data === "object") {
            // Validate required fields before passing to handler
            var raw = msg.data;
            if (typeof raw.data !== "string" || typeof raw.format !== "string") {
                dbg("ERROR: malformed result — missing data or format");
                return;
            }
            // Pass the validated payload straight through — preserve every field
            // (e.g. bounding_box) so native SDK consumers still receive them.
            dbg("result!");
            if (_onResult) _onResult(raw);
            return;
        }
        if (msg.type === "throttle" && typeof msg.fps === "number") { state.fps = msg.fps; return; }
        if (msg.type === "error") { dbg("server error: " + (msg.message || "unknown")); return; }
    };

    state.ws.onclose = function (e) {
        dbg("WS closed: " + e.code);
        clearConnectTimer();
        stopCapture();
        state.wsAuthed = false;
        // 4001 (invalid key) and 4029 (rate limited) are server-reachable
        // rejections, not connectivity failures — surface them, never silently
        // bypass auth by dropping into offline decode. Latch authRejected and
        // revert to ws mode so a connect-timeout fallback that raced ahead of
        // this close frame cannot keep the offline decoder running.
        if (e.code === 4001 || e.code === 4029) {
            state.authRejected = true;
            state.decodeMode = "ws";
            clearReconnectTimer();
            if (e.code === 4001) {
                status.textContent = "Invalid API key";
                bridgeError("invalid api key");
                if (!state.isSDKMode && _onAuthFail) _onAuthFail("Invalid API key. Please check and try again.");
            } else {
                status.textContent = "Rate limited";
                bridgeError("rate limited");
                if (!state.isSDKMode && _onRateLimit) _onRateLimit("Rate limited. Please wait and try again.");
            }
            return;
        }
        tryReconnect();
    };

    state.ws.onerror = function () { dbg("WS error"); };
}

export function closeWS() {
    clearConnectTimer();
    clearReconnectTimer();
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
        state.ws = null;
    }
    state.reconnectAttempts = 0;
    state.wsAuthed = false;
}

function tryReconnect() {
    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
        // Cloud unreachable after retries — switch to on-device decode rather
        // than dead-ending. This is the core online→offline fallback path.
        goOffline("reconnect exhausted");
        return;
    }
    state.reconnectAttempts++;
    var delay = Math.pow(2, state.reconnectAttempts - 1) * 1000;
    status.textContent = "Reconnecting (" + state.reconnectAttempts + "/" + state.maxReconnectAttempts + ")...";
    clearReconnectTimer();
    reconnectTimer = setTimeout(connectWS, delay);
}

/**
 * Transition from cloud decode to on-device decode. Idempotent — a no-op once
 * already offline. Tears down any socket, loads the wasm reader, and (re)starts
 * capture through the offline pipeline.
 * @param {string} reason — diagnostic label for the debug log
 * @returns {Promise<void>}
 */
export async function goOffline(reason) {
    if (state.decodeMode === "wasm") return;
    // Server reachably rejected the API key — offline decode is forbidden, it
    // would bypass auth. Surface as a lost connection instead.
    if (state.authRejected) {
        dbg("offline fallback blocked — auth was rejected");
        return;
    }
    clearConnectTimer();
    clearReconnectTimer();
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
        state.ws = null;
    }
    dbg("falling back to offline decode: " + reason);
    status.textContent = "Offline mode...";

    var ok = await enableWasmFallback();
    // The scanner may have been stopped (sdk_stop) while the wasm module loaded —
    // do not resurrect capture after an explicit teardown.
    if (!state.scanActive) {
        dbg("offline fallback aborted — scan no longer active");
        return;
    }
    if (ok) {
        bridgeReady();
        status.textContent = "Scanning (offline)...";
        tryStartCapture();
    } else {
        status.textContent = "Connection lost";
        bridgeError("offline decode unavailable");
    }
}
