"use strict";

/**
 * Capture Worker — encodes video frames off the main thread.
 *
 * Receives ImageBitmap via postMessage, draws to OffscreenCanvas,
 * encodes as JPEG blob, and returns a binary frame buffer:
 *
 *   [8 bytes: Float64 timestamp] [N bytes: JPEG data]
 *
 * The binary buffer is sent directly over WebSocket — no base64,
 * no JSON wrapper. ~33% smaller than the base64+JSON approach.
 */

var HEADER_SIZE = 8; // Float64 timestamp

self.onmessage = function (e) {
    var bitmap = e.data.bitmap;
    var quality = e.data.quality;
    var timestamp = e.data.timestamp;

    var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    var ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    canvas.convertToBlob({ type: "image/jpeg", quality: quality }).then(function (blob) {
        return blob.arrayBuffer();
    }).then(function (jpegBuffer) {
        // Build binary frame: [timestamp][jpeg]
        var frame = new ArrayBuffer(HEADER_SIZE + jpegBuffer.byteLength);
        var view = new DataView(frame);
        view.setFloat64(0, timestamp, false); // big-endian

        var frameBytes = new Uint8Array(frame);
        frameBytes.set(new Uint8Array(jpegBuffer), HEADER_SIZE);

        self.postMessage(frame, [frame]); // transfer ownership
    });
};
