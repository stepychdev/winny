// ─── Color Utilities ─────────────────────────────────────
// Extracted from JackpotWheel.tsx for shared use and testability.

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

export function lighten(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = pct / 100;
  return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}

export function darken(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - pct / 100;
  return rgbToHex(r * f, g * f, b * f);
}

// ─── Easing ──────────────────────────────────────────────

export const EASE_EXPONENT = 3.5;

/**
 * Smooth monotonic deceleration — no overshoot or correction.
 * Mimics natural friction: starts at full speed, gradually slows to a stop.
 * Derivative at t=0 equals EASE_EXPONENT (used for velocity matching).
 */
export function landingEase(t: number): number {
  return 1 - Math.pow(1 - t, EASE_EXPONENT);
}

// ─── Wheel Segment Builder ───────────────────────────────

export const SEGMENT_COLORS = [
  '#4f46e5', '#0d59f2', '#0891b2', '#059669',
  '#d97706', '#dc2626', '#9333ea', '#e11d48',
  '#2563eb', '#0d9488', '#ca8a04', '#7c3aed',
];

export interface SegmentData {
  startAngle: number;
  endAngle: number;
  color: string;
  label: string;
  pct: number;
}

interface SegmentParticipant {
  color: string;
  displayName: string;
  usdcAmount: number;
}

export function buildSegments(participants: SegmentParticipant[]): SegmentData[] {
  const total = participants.reduce((s, p) => s + p.usdcAmount, 0) || 1;
  let angle = 0;
  return participants.map((p, i) => {
    const sweep = (p.usdcAmount / total) * Math.PI * 2;
    const seg: SegmentData = {
      startAngle: angle,
      endAngle: angle + sweep,
      color: p.color || SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      label: p.displayName,
      pct: (p.usdcAmount / total) * 100,
    };
    angle += sweep;
    return seg;
  });
}
