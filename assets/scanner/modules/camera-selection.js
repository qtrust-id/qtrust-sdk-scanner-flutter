"use strict";

var SECONDARY_LENS = /ultra|0\.5|telephoto|\btele\b|depth|truedepth|macro|mono/i;
var VIRTUAL_LENS = /dual|triple|tripple/i;
var BACK_LENS = /back|rear|environment|belakang/i;
var MAIN_WIDE_LENS = /\bwide\b/i;
var ANDROID_CAMERA_ID = /camera2?\s+(\d+)/i;

/**
 * Pick a rear camera only when its label gives stronger evidence than the
 * currently active camera. A tie is ambiguous and must keep the current stream.
 * @param {MediaDeviceInfo[]} devices
 * @param {string|null} currentId
 * @returns {string|null}
 */
export function pickMainLens(devices, currentId) {
    var cams = devices.filter(function (d) { return d.kind === "videoinput"; });
    if (cams.length < 2 || !cams.some(function (c) { return c.label; })) return null;

    var back = cams.filter(function (c) { return BACK_LENS.test(c.label); });
    var pool = back.length ? back : cams;

    function score(label) {
        var s = 0;
        var androidId = label.match(ANDROID_CAMERA_ID);
        if (SECONDARY_LENS.test(label)) s -= 100;
        if (VIRTUAL_LENS.test(label)) s += 30;
        if (MAIN_WIDE_LENS.test(label) && !/ultra/i.test(label)) s += 20;
        // Android Camera2 normally reserves the lowest rear ID for the main
        // camera and exposes extra physical lenses under higher IDs.
        if (androidId) s += Math.max(0, 10 - Number(androidId[1]));
        return s;
    }

    var current = pool.find(function (c) { return c.deviceId === currentId; });
    var currentScore = current ? score(current.label) : 0;
    var best = null;
    var bestScore = currentScore;

    pool.forEach(function (c) {
        var candidateScore = score(c.label);
        if (candidateScore > bestScore) {
            bestScore = candidateScore;
            best = c;
        }
    });
    return best ? best.deviceId : null;
}
