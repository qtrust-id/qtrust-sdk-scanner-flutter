"use strict";

// Fire-and-forget scan telemetry.
//
// This page is the single source of truth for every platform (iOS/Android
// WebView, React Native, and the web SDK iframe all load this same bundle), so
// telemetry lives here once instead of being reimplemented per SDK. On every
// successful decode we POST the scanned value to the observation endpoint.
//
// Contract: hit-and-forget. The request is never awaited, never blocks result
// delivery, and every error is swallowed — telemetry must not affect scanning.

var TELEMETRY_URL = "https://staging-ce-app-sdk-api.qtrust.id/v1/sdk/scan";
var TELEMETRY_API_KEY = "qtrust-sdk-web-key-2026";
var APP_VERSION = "1.2.4";

// Suppress duplicate reports for the same value within this window. decodeFrame
// can hit the same code on consecutive frames until the host tears down, so
// without this one physical scan would emit several identical telemetry POSTs.
var DEDUP_WINDOW_MS = 3000;

var lastValue = null;
var lastAt = 0;
var sessionId = null;

// Per-page-load UUID used as scanner_id for every report (anonymous, not tied
// to vendor identity).
function getSessionId() {
    if (sessionId) return sessionId;
    var id;
    try {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            id = crypto.randomUUID();
        }
    } catch (e) { /* secure-context guard — fall through */ }
    if (!id) {
        var rnd = function () { return Math.floor(Math.random() * 0x10000).toString(16); };
        id = rnd() + rnd() + "-" + rnd() + "-" + rnd() + "-" + rnd() + "-" + rnd() + rnd() + rnd();
    }
    sessionId = "sdk-web-" + id;
    return sessionId;
}

// Identify the host platform from the bridge surface the page is running under.
// RN reuses the native WebViews, so it reports as its underlying OS.
function detectSource() {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scannerBridge) {
        return "sdk-ios";
    }
    if (window.ScannerBridge) return "sdk-android";
    return "sdk-web";
}

/**
 * Report a successful scan. Fire-and-forget; safe to call on every result.
 * @param {{ data: string, format: string }} result
 */
export function reportScan(result) {
    try {
        if (!result || !result.data) return;

        var now = Date.now();
        if (result.data === lastValue && (now - lastAt) < DEDUP_WINDOW_MS) return;
        lastValue = result.data;
        lastAt = now;

        var payload = {
            scanner_id: getSessionId(),
            value: result.data,
            source: detectSource(),
            scan_date: new Date().toISOString(),
            metadata: {
                format: result.format,
                app_version: APP_VERSION,
            },
        };

        if (typeof fetch !== "function") return;
        fetch(TELEMETRY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": TELEMETRY_API_KEY,
            },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(function () { /* swallow — telemetry never affects scanning */ });
    } catch (e) {
        /* swallow — telemetry never affects scanning */
    }
}
