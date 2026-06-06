"use strict";

import { state } from "./state.js";
import { dbg } from "./debug.js";

// Module-level reference to the active message listener so it can be removed
// on teardown and initEmbed is safe to call more than once.
var _activeMessageListener = null;

/**
 * Embed bridge — drives this page from the web SDK (parent window) over
 * postMessage when loaded inside an iframe with ?embed=1. The native iOS/Android
 * path (webkit / ScannerBridge) is untouched; this is the browser-host analog.
 *
 * Contract is shared with the web SDK — see sdk-web/PROTOCOL.md. Keep message
 * types in lockstep with sdk-web/src/constants.js.
 */
export var EmbedMsg = {
    // parent → iframe
    SDK_INIT: "qtrust:sdk_init",
    SDK_STOP: "qtrust:sdk_stop",
    // iframe → parent
    SDK_READY: "qtrust:sdk_ready",
    RESULT: "qtrust:result",
    ERROR: "qtrust:error",
    READY: "qtrust:ready",
    CLOSE: "qtrust:close",
};

/** Origin of the embedding page, from the referrer. "" if unavailable. */
function referrerOrigin() {
    try {
        if (document.referrer) return new URL(document.referrer).origin;
    } catch (_e) { /* malformed referrer — treat as unknown */ }
    return "";
}

/**
 * Initialize the embed bridge. No-op unless the page is embedded.
 *
 * SECURITY — trust model:
 *
 * Native / file:// path (iOS WKWebView, Android WebView):
 *   window.__SCANNER_BOOT__ is injected by the native bridge before the page
 *   runs. In that context postMessage-based sdk_init is NOT the trust root —
 *   the native host calls window.ScannerInit directly. We ignore sdk_init
 *   entirely when __SCANNER_BOOT__ is present so an attacker that manages to
 *   deliver a postMessage into a native WebView cannot bootstrap a rogue config.
 *
 * Web-embed path (iframe via sdk-web):
 *   The web SDK loads this page via srcdoc, which inherits the parent's origin.
 *   Because srcdoc inherits the parent origin, document.referrer is the same
 *   origin we already trust for postMessage. We also accept the explicit
 *   expectedOrigin field from __SCANNER_BOOT__ when set (future-proofing for
 *   cross-origin embed scenarios).
 *
 *   Trust-on-first-use is intentionally removed: if parentOrigin is "" after
 *   referrer resolution we do NOT lock to the first sdk_init sender. Instead we
 *   refuse to call ScannerInit so arbitrary-origin messages cannot bootstrap a
 *   rogue scan session. sdk_stop is still accepted (worst-case: stops a scan).
 *
 * @param {function} onStop — invoked when the parent sends qtrust:sdk_stop
 */
/**
 * Remove the current embed message listener if one is registered.
 * Called by the sdk_stop teardown path (main.js onStop) and before re-init
 * so the listener is never duplicated.
 */
export function teardownEmbed() {
    if (_activeMessageListener) {
        window.removeEventListener("message", _activeMessageListener);
        _activeMessageListener = null;
        dbg("embed: message listener removed");
    }
}

export function initEmbed(onStop) {
    if (!state.isEmbed) return;

    // Guard against double-add — remove any previously registered listener
    // before wiring a new one.
    teardownEmbed();

    // SECURITY: In native/file:// contexts __SCANNER_BOOT__ is injected by the
    // host bridge. postMessage sdk_init must not act as an alternative trust root
    // there — the native host calls ScannerInit directly.
    if (typeof window !== "undefined" && window.__SCANNER_BOOT__) {
        // Native mode. Wire sdk_stop only (lets host clean up via postMessage if
        // needed), but ignore sdk_init — config arrives via ScannerInit directly.
        _activeMessageListener = function (event) {
            var msg = event.data;
            if (!msg || typeof msg.type !== "string") return;
            if (msg.type === EmbedMsg.SDK_STOP) {
                dbg("embed(native): sdk_stop");
                if (typeof onStop === "function") onStop();
            }
        };
        window.addEventListener("message", _activeMessageListener);
        dbg("embed(native): __SCANNER_BOOT__ present — sdk_init via postMessage disabled");
        return;
    }

    // Web-embed path: resolve the trusted parent origin.
    // Prefer an explicit expectedOrigin from the boot config (set by sdk-web when
    // cross-origin embed is used), then fall back to the document referrer.
    var boot = (typeof window !== "undefined" && window.__SCANNER_BOOT__) || {};
    var expectedOrigin = boot.expectedOrigin || referrerOrigin();
    state.parentOrigin = expectedOrigin;

    _activeMessageListener = function (event) {
        // Reject messages from unexpected origins once parentOrigin is known.
        if (state.parentOrigin && event.origin !== state.parentOrigin) {
            dbg("embed: drop msg from " + event.origin + " (expected " + state.parentOrigin + ")");
            return;
        }
        var msg = event.data;
        if (!msg || typeof msg.type !== "string") return;

        switch (msg.type) {
            case EmbedMsg.SDK_INIT:
                // SECURITY: Do not lock trust from an unknown origin. If
                // parentOrigin is "" here it means we have no referrer and no
                // expectedOrigin — refuse to initialise rather than allowing any
                // sender to become the trusted host.
                if (!state.parentOrigin) {
                    dbg("embed: sdk_init rejected — parentOrigin unknown, cannot establish trust");
                    return;
                }
                dbg("embed: sdk_init from " + event.origin);
                if (typeof window.ScannerInit === "function") {
                    window.ScannerInit(msg.payload || {});
                }
                break;
            case EmbedMsg.SDK_STOP:
                // Accept sdk_stop from the known parent (or any origin if unknown
                // — worst case we stop a scan, which is safe).
                dbg("embed: sdk_stop");
                if (typeof onStop === "function") onStop();
                break;
            default:
                break;
        }
    };
    window.addEventListener("message", _activeMessageListener);

    // Announce readiness so the parent (re)sends sdk_init — covers the race
    // where the SDK called start() before this page finished loading.
    emitEmbed(EmbedMsg.SDK_READY, {});
    dbg("embed: sdk_ready -> " + (state.parentOrigin || "(no referrer)"));
}

/**
 * Post a protocol message to the parent page. Targets the locked parent origin
 * so result data never leaks to an unexpected ancestor.
 *
 * SECURITY: RESULT/ERROR/CLOSE carry decoded barcode data and must NEVER be
 * sent with targetOrigin "*". If parentOrigin is not yet known when one of
 * these data messages would be emitted, we drop it rather than wildcard-broadcast.
 * Only SDK_READY (which carries no sensitive data) may fall back to "*".
 *
 * @param {string} type — an EmbedMsg value
 * @param {*} payload
 */
export function emitEmbed(type, payload) {
    if (!state.isEmbed || !window.parent || window.parent === window) return;

    // Data-bearing messages must never go to "*".
    var isDataMsg = (type === EmbedMsg.RESULT || type === EmbedMsg.ERROR || type === EmbedMsg.CLOSE);
    if (isDataMsg && !state.parentOrigin) {
        dbg("embed: drop " + type + " — parentOrigin unknown, refusing wildcard postMessage");
        return;
    }

    var target = state.parentOrigin || "*";
    window.parent.postMessage({ type: type, payload: payload === undefined ? {} : payload }, target);
}
