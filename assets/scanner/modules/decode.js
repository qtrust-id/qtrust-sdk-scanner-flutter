"use strict";

// On-device decode backend (offline fallback).
//
// The primary path is cloud decode over WebSocket (see websocket.js). When the
// cloud is unreachable, the page falls back to decoding frames locally with a
// vendored zxing-wasm build (assets/zxing/). Both backends emit the SAME result
// shape so consumers (native SDK / web SDK) don't care which produced it:
//   { data, format, bounding_box: { x, y, width, height } }

import { state, ScanType } from "./state.js";
import { dbg } from "./debug.js";
// Statically bundled by esbuild — the vendored zxing reader and its wasm are
// inlined into the single classic bundle so on-device decode works fully
// offline under file:// (WKWebView blocks ES-module and file:// fetch of the
// wasm, so neither a dynamic import nor locateFile would resolve there).
import { readBarcodes, prepareZXingModule } from "../assets/zxing/reader/index.js";
import zxingWasmBinary from "../assets/zxing/zxing_reader.wasm";

// ── Wasm instantiation state ───────────────────────────
var wasmLoadPromise = null;

// Single in-flight decode guard — readBarcodes is async; at low fps a slow
// frame must not let the next frame stack a second concurrent decode.
var decoding = false;

// Result callback, injected from main.js (shared with the WS path).
var onResultCb = null;

// ── Symbology sets ─────────────────────────────────────
// Mirror the server defaults in cloud/internal/decoder/zxingcpp.go so offline
// parity matches online. zxing-wasm accepts both canonical names ("QRCode")
// and HRI labels ("EAN-13"), so the per-vendor formats string passes through.
var QR_FORMATS = ["QRCode", "MicroQRCode", "Aztec", "DataMatrix"];
var BARCODE_FORMATS = ["PDF417", "EAN-13", "EAN-8", "Code128", "Code39", "Codabar", "ITF", "UPC-A", "UPC-E"];

// Map zxing-wasm canonical result formats to the SCREAMING_SNAKE convention the
// protocol has used since the ZBar backend (matches server normalizeFormatName,
// which upper-cases the HRI label and replaces space/dash with underscore).
var FORMAT_MAP = {
    QRCode: "QR_CODE",
    MicroQRCode: "MICRO_QR_CODE",
    Aztec: "AZTEC",
    DataMatrix: "DATA_MATRIX",
    PDF417: "PDF417",
    EAN13: "EAN_13",
    EAN8: "EAN_8",
    Code128: "CODE_128",
    Code39: "CODE_39",
    Codabar: "CODABAR",
    ITF: "ITF",
    UPCA: "UPC_A",
    UPCE: "UPC_E",
};

/**
 * Inject the result handler (same one the WS path uses).
 * @param {{ onResult: function(Object): void }} cbs
 */
export function setDecodeCallbacks(cbs) {
    onResultCb = cbs.onResult;
}

/** @returns {boolean} true when the on-device backend is active. */
export function isWasmMode() {
    return state.decodeMode === "wasm";
}

/**
 * Switch to on-device decode and ensure the wasm module is loaded.
 * Idempotent — repeated calls after a successful load resolve instantly.
 * @returns {Promise<boolean>} true if the backend is ready to decode.
 */
export async function enableWasmFallback() {
    state.decodeMode = "wasm";
    if (state.wasmReady) return true;
    try {
        await loadWasm();
        state.wasmReady = true;
        dbg("wasm decode ready");
        return true;
    } catch (err) {
        dbg("wasm load failed: " + (err ? err.message : "unknown"));
        return false;
    }
}

// Instantiate the bundled wasm from its inlined bytes (no network, no file://
// fetch). fireImmediately resolves once the wasm is instantiated, so wasmReady
// reflects a genuinely usable decoder rather than a deferred one.
function loadWasm() {
    if (wasmLoadPromise) return wasmLoadPromise;
    wasmLoadPromise = prepareZXingModule({
        overrides: { wasmBinary: zxingWasmBinary },
        fireImmediately: true,
    });
    return wasmLoadPromise;
}

// Reader options derived from current scan type / vendor formats override.
function readerOptions() {
    var formats;
    if (state.config.formats) {
        formats = state.config.formats.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
        formats = state.scanType === ScanType.BARCODE ? BARCODE_FORMATS : QR_FORMATS;
    }
    return {
        formats: formats,
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
        maxNumberOfSymbols: 1,
    };
}

function mapFormat(wasmFormat) {
    return FORMAT_MAP[wasmFormat] || String(wasmFormat || "UNKNOWN").toUpperCase();
}

// Axis-aligned bounding box from the four corner points.
function toBoundingBox(pos) {
    if (!pos) return { x: 0, y: 0, width: 0, height: 0 };
    var xs = [pos.topLeft, pos.topRight, pos.bottomLeft, pos.bottomRight].map(function (p) { return p ? p.x : 0; });
    var ys = [pos.topLeft, pos.topRight, pos.bottomLeft, pos.bottomRight].map(function (p) { return p ? p.y : 0; });
    var minX = Math.min.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    return {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.round(Math.max.apply(null, xs) - minX),
        height: Math.round(Math.max.apply(null, ys) - minY),
    };
}

function toResult(r) {
    return {
        data: r.text,
        format: mapFormat(r.format),
        bounding_box: toBoundingBox(r.position),
    };
}

/**
 * Decode a single captured frame on-device. Fire-and-forget: internally
 * throttled so overlapping calls at the capture fps are dropped, not queued.
 * @param {ImageData} imageData
 */
export async function decodeFrame(imageData) {
    if (!readBarcodes || decoding) return;
    decoding = true;
    try {
        var results = await readBarcodes(imageData, readerOptions());
        var hit = null;
        for (var i = 0; i < (results ? results.length : 0); i++) {
            if (results[i].isValid && results[i].text) { hit = results[i]; break; }
        }
        if (hit && onResultCb) onResultCb(toResult(hit));
    } catch (err) {
        dbg("wasm decode error: " + (err ? err.message : "unknown"));
    } finally {
        decoding = false;
    }
}
