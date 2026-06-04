"use strict";

var debugEl = document.getElementById("debug");

/**
 * Append timestamped message to debug overlay.
 * Visible only when ?debug=1 is in URL.
 */
export function dbg(msg) {
    var line = new Date().toLocaleTimeString() + " " + msg;
    if (debugEl) {
        debugEl.textContent += line + "\n";
        debugEl.scrollTop = debugEl.scrollHeight;
    }
}
