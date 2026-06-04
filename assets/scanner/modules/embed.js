"use strict";

import { state } from "./state.js";
import { dbg } from "./debug.js";

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
 * @param {function} onStop — invoked when the parent sends qtrust:sdk_stop
 */
export function initEmbed(onStop) {
    if (!state.isEmbed) return;

    // Lock the parent origin from the referrer; sdk_init confirms it below.
    state.parentOrigin = referrerOrigin();

    window.addEventListener("message", function (event) {
        // Once the parent origin is known, reject everything else outright.
        if (state.parentOrigin && event.origin !== state.parentOrigin) {
            dbg("embed: drop msg from " + event.origin);
            return;
        }
        var msg = event.data;
        if (!msg || typeof msg.type !== "string") return;

        switch (msg.type) {
            case EmbedMsg.SDK_INIT:
                // Trust-on-first-use when referrer was blank: lock to this origin.
                if (!state.parentOrigin) state.parentOrigin = event.origin;
                dbg("embed: sdk_init from " + event.origin);
                if (typeof window.ScannerInit === "function") {
                    window.ScannerInit(msg.payload || {});
                }
                break;
            case EmbedMsg.SDK_STOP:
                dbg("embed: sdk_stop");
                if (typeof onStop === "function") onStop();
                break;
            default:
                break;
        }
    });

    // Announce readiness so the parent (re)sends sdk_init — covers the race
    // where the SDK called start() before this page finished loading.
    emitEmbed(EmbedMsg.SDK_READY, {});
    dbg("embed: sdk_ready -> " + (state.parentOrigin || "(no referrer)"));
}

/**
 * Post a protocol message to the parent page. Targets the locked parent origin
 * so result data never leaks to an unexpected ancestor. Falls back to "*" only
 * for the no-secret sdk_ready handshake when the referrer is unavailable.
 * @param {string} type — an EmbedMsg value
 * @param {*} payload
 */
export function emitEmbed(type, payload) {
    if (!state.isEmbed || !window.parent || window.parent === window) return;
    var target = state.parentOrigin || "*";
    window.parent.postMessage({ type: type, payload: payload === undefined ? {} : payload }, target);
}
