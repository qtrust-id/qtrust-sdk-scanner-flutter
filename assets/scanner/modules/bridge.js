"use strict";

import { state } from "./state.js";
import { emitEmbed, EmbedMsg } from "./embed.js";

/**
 * Host bridge — communicates scan results, errors, and lifecycle events to the
 * host: iOS (WKWebView), Android (WebView), or the web SDK parent page (iframe
 * postMessage). Each path fires independently so one page can serve any host.
 */

export function bridgeResult(data) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scannerBridge) {
        window.webkit.messageHandlers.scannerBridge.postMessage({ type: "result", data: data });
    }
    if (window.ScannerBridge && window.ScannerBridge.onResult) {
        window.ScannerBridge.onResult(JSON.stringify(data));
    }
    if (state.isEmbed) emitEmbed(EmbedMsg.RESULT, data);
}

export function bridgeError(message) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scannerBridge) {
        window.webkit.messageHandlers.scannerBridge.postMessage({ type: "error", message: message });
    }
    if (window.ScannerBridge && window.ScannerBridge.onError) {
        window.ScannerBridge.onError(message);
    }
    if (state.isEmbed) emitEmbed(EmbedMsg.ERROR, message);
}

export function bridgeReady() {
    // Fire at most once per scan session. Reset in startScannerFlow.
    if (state.readySignaled) return;
    state.readySignaled = true;
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scannerBridge) {
        window.webkit.messageHandlers.scannerBridge.postMessage({ type: "ready" });
    }
    if (window.ScannerBridge && window.ScannerBridge.onReady) {
        window.ScannerBridge.onReady();
    }
    if (state.isEmbed) emitEmbed(EmbedMsg.READY, {});
}

export function bridgeClose() {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scannerBridge) {
        window.webkit.messageHandlers.scannerBridge.postMessage({ type: "close" });
    }
    if (window.ScannerBridge && window.ScannerBridge.onClose) {
        window.ScannerBridge.onClose();
    }
    if (state.isEmbed) emitEmbed(EmbedMsg.CLOSE, {});
}
