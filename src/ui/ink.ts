// Text colour that stays readable on a solid fill of any calendar or tag colour.

const DARK_INK = "#0b0b0b";
const LIGHT_INK = "#f2f2ee";

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (WCAG) of a #rgb or #rrggbb colour; null if it isn't one. */
export function luminance(color: string): number | null {
  let hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return 0.2126 * channel(hex.slice(0, 2)) + 0.7152 * channel(hex.slice(2, 4)) + 0.0722 * channel(hex.slice(4, 6));
}

/** Near-black or near-white, whichever contrasts more with the fill. */
export function inkOn(color: string | undefined): string {
  const l = color ? luminance(color) : null;
  if (l === null) return DARK_INK;
  const onDark = 1.05 / (l + 0.05);
  const onLight = (l + 0.05) / 0.05;
  return onLight >= onDark ? DARK_INK : LIGHT_INK;
}
