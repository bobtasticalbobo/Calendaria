// Single import point for Temporal, so the polyfill can be dropped once every
// webview Calendaria runs in ships Temporal natively.
export { Temporal } from "temporal-polyfill";
