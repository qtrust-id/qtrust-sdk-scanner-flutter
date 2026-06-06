"use strict";

var debugEl = document.getElementById("debug");

// Maximum number of lines retained in the debug overlay to prevent unbounded growth.
var DBG_MAX_LINES = 200;

/**
 * Append timestamped message to debug overlay.
 * Visible only when ?debug=1 is in URL.
 * Older lines are trimmed once the buffer exceeds DBG_MAX_LINES.
 */
export function dbg(msg) {
    var line = new Date().toLocaleTimeString() + " " + msg;
    if (debugEl) {
        var current = debugEl.textContent;
        var lines = current ? current.split("\n") : [];
        lines.push(line);
        if (lines.length > DBG_MAX_LINES) {
            lines = lines.slice(lines.length - DBG_MAX_LINES);
        }
        debugEl.textContent = lines.join("\n") + "\n";
        debugEl.scrollTop = debugEl.scrollHeight;
    }
}
