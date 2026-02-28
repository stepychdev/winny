import { useRef, useEffect, useMemo, useCallback } from 'react';
import type { Participant } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { formatUsdcCompact } from '../lib/format';
import {
  lighten, darken,
  landingEase, EASE_EXPONENT,
  buildSegments,
  type SegmentData,
} from '../lib/wheelUtils';

// ─── Props (unchanged) ───────────────────────────────────
interface JackpotWheelProps {
  participants: Participant[];
  totalUsdc: number;
  spinning: boolean;
  winnerIndex: number | null;
  onSpinComplete: () => void;
}

// ─── Constants ───────────────────────────────────────────
const CANVAS_SIZE = 400;
const CENTER = CANVAS_SIZE / 2;
const OUTER_R = 165;
const INNER_R = 95;
const PIN_COUNT = 36; // kept for tick sound calculation
const LANDING_DURATION = 6000;

// ─── Types ───────────────────────────────────────────────
type WheelPhase = 'idle' | 'spinning' | 'landing' | 'celebration';

interface AnimState {
  phase: WheelPhase;
  angle: number;
  velocity: number;
  targetAngle: number;
  startAngle: number;
  landingStart: number;
  celebrationStart: number;
  lastPinIdx: number;
  idleTime: number;
  particles: ConfettiParticle[];
}

interface ConfettiParticle {
  x: number; y: number;
  vx: number; vy: number;
  size: number; color: string;
  rot: number; rotV: number;
  life: number;
}

// SegmentData imported from ../lib/wheelUtils

// ─── Sound System ────────────────────────────────────────
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playTick() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.04);
  } catch {}
}

function playWinSound() {
  try {
    const ctx = getAudioCtx();
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch {}
}

// ─── Drawing Functions ───────────────────────────────────
// buildSegments imported from ../lib/wheelUtils

function drawDonutSegment(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  startAngle: number, endAngle: number,
  outerR: number, innerR: number,
  color: string, strokeColor: string,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, startAngle, endAngle);
  ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
  ctx.closePath();

  // 3D gradient — top lighter, bottom darker
  const grad = ctx.createLinearGradient(cx, cy - outerR, cx, cy + outerR);
  grad.addColorStop(0, lighten(color, 20));
  grad.addColorStop(0.45, color);
  grad.addColorStop(1, darken(color, 25));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawSegments(ctx: CanvasRenderingContext2D, segments: SegmentData[], isDark: boolean) {
  const stroke = isDark ? '#1e293b' : '#ffffff';
  for (const seg of segments) {
    drawDonutSegment(ctx, CENTER, CENTER, seg.startAngle, seg.endAngle, OUTER_R, INNER_R, seg.color, stroke);
  }

  // Labels
  ctx.save();
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 3;
  for (const seg of segments) {
    if (seg.pct < 6) continue;
    const mid = (seg.startAngle + seg.endAngle) / 2;
    const r = (OUTER_R + INNER_R) / 2;
    const x = CENTER + Math.cos(mid) * r;
    const y = CENTER + Math.sin(mid) * r;

    ctx.save();
    ctx.translate(x, y);
    // Rotate text to follow segment angle, keep readable
    let textAngle = mid;
    if (textAngle > Math.PI / 2 && textAngle < Math.PI * 1.5) {
      textAngle += Math.PI;
    }
    ctx.rotate(textAngle);
    ctx.fillText(seg.label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}


function drawInnerCircle(ctx: CanvasRenderingContext2D, isDark: boolean) {
  ctx.save();

  // Inner circle fill with depth gradient
  const grad = ctx.createRadialGradient(
    CENTER - INNER_R * 0.2, CENTER - INNER_R * 0.2, 0,
    CENTER, CENTER, INNER_R
  );
  if (isDark) {
    grad.addColorStop(0, '#2d3a4d');
    grad.addColorStop(1, '#1e293b');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#f1f5f9');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, INNER_R, 0, Math.PI * 2);
  ctx.fill();

  // Border ring
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

function drawEmptyWheel(ctx: CanvasRenderingContext2D, isDark: boolean) {
  // Empty donut
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, OUTER_R, 0, Math.PI * 2);
  ctx.arc(CENTER, CENTER, INNER_R, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
  ctx.fill();
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawInnerCircle(ctx, isDark);
}

// ─── Overlay Drawing ─────────────────────────────────────

function drawPointer(ctx: CanvasRenderingContext2D, isDark: boolean) {
  ctx.save();
  const tipY = CENTER - OUTER_R - 6;
  const baseY = tipY - 22;
  const halfW = 11;

  // Glow
  ctx.shadowColor = isDark ? 'rgba(13,89,242,0.5)' : 'rgba(13,89,242,0.5)';
  ctx.shadowBlur = 10;

  // Triangle
  ctx.beginPath();
  ctx.moveTo(CENTER, tipY);
  ctx.lineTo(CENTER - halfW, baseY);
  ctx.lineTo(CENTER + halfW, baseY);
  ctx.closePath();

  const grad = ctx.createLinearGradient(CENTER, baseY, CENTER, tipY);
  if (isDark) {
    grad.addColorStop(0, '#60a5fa');
    grad.addColorStop(1, '#2563eb');
  } else {
    grad.addColorStop(0, '#0d59f2');
    grad.addColorStop(1, '#093cb0');
  }
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = isDark ? '#93c5fd' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawWinnerGlow(
  ctx: CanvasRenderingContext2D,
  segments: SegmentData[],
  winnerIdx: number,
  angle: number,
  pulseT: number,
) {
  if (winnerIdx < 0 || winnerIdx >= segments.length) return;
  const seg = segments[winnerIdx];
  const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(pulseT * 6));

  ctx.save();
  ctx.translate(CENTER, CENTER);
  ctx.rotate(angle);

  ctx.globalAlpha = pulse * 0.6;
  ctx.shadowColor = seg.color;
  ctx.shadowBlur = 20 + 15 * Math.sin(pulseT * 6);

  ctx.beginPath();
  ctx.arc(0, 0, OUTER_R + 3, seg.startAngle, seg.endAngle);
  ctx.arc(0, 0, INNER_R - 3, seg.endAngle, seg.startAngle, true);
  ctx.closePath();
  ctx.strokeStyle = seg.color;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();
}

function spawnConfetti(color: string): ConfettiParticle[] {
  const colors = [color, lighten(color, 30), '#ffd700', '#ffffff', '#f59e0b'];
  const particles: ConfettiParticle[] = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    particles.push({
      x: CENTER, y: CENTER,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 2,
      size: 3 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.3,
      life: 1,
    });
  }
  return particles;
}

function updateAndDrawConfetti(ctx: CanvasRenderingContext2D, particles: ConfettiParticle[]) {
  ctx.save();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    p.vx *= 0.99;
    p.rot += p.rotV;
    p.life -= 0.012;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.min(p.life, 1);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  ctx.restore();
}

// ─── Component ───────────────────────────────────────────

export function JackpotWheel({
  participants,
  totalUsdc,
  spinning,
  winnerIndex,
  onSpinComplete,
}: JackpotWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const prevWinnerIndexRef = useRef<number | null>(null);
  const wasSpinningRef = useRef(false);
  const onSpinCompleteRef = useRef(onSpinComplete);
  onSpinCompleteRef.current = onSpinComplete;

  // Ref to read participants without adding to effect deps
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  // Frozen segments used during landing/celebration to prevent visual mismatch
  const frozenSegmentsRef = useRef<SegmentData[] | null>(null);
  const frozenTextureRef = useRef<HTMLCanvasElement | null>(null);

  const animRef = useRef<AnimState>({
    phase: 'idle',
    angle: 0,
    velocity: 0,
    targetAngle: 0,
    startAngle: 0,
    landingStart: 0,
    celebrationStart: 0,
    lastPinIdx: -1,
    idleTime: 0,
    particles: [],
  });

  const segments = useMemo(() => buildSegments(participants), [participants]);

  // ─── Build cached wheel texture ──────────────────────
  const textureRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  const rebuildTexture = useCallback((segs: SegmentData[], parts: Participant[]) => {
    const w = CANVAS_SIZE * dpr;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = w;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    if (parts.length === 0) {
      drawEmptyWheel(ctx, isDark);
    } else {
      drawSegments(ctx, segs, isDark);
      drawInnerCircle(ctx, isDark);
    }
    return canvas;
  }, [isDark, dpr]);

  useEffect(() => {
    // Don't rebuild texture during landing/celebration — use frozen one
    const phase = animRef.current.phase;
    if (phase === 'landing' || phase === 'celebration') return;
    textureRef.current = rebuildTexture(segments, participants);
  }, [rebuildTexture, segments, participants]);

  // ─── Track spinning phase (merged into "Start spinning" effect below) ──

  // ─── Trigger landing ─────────────────────────────────
  useEffect(() => {
    const prev = prevWinnerIndexRef.current;
    prevWinnerIndexRef.current = winnerIndex;
    const anim = animRef.current;

    // Trigger landing when either:
    // - winnerIndex transitions from null -> non-null while we were spinning (original behavior), or
    // - spinning just finished but winnerIndex is present (covers clients that received winner earlier)
    const shouldTriggerLanding = (
      // original: new winner appeared while we were spinning
      (prev === null && winnerIndex !== null && wasSpinningRef.current) ||
      // new: we were spinning and spinning prop ended while winnerIndex already set
      (prev === winnerIndex && winnerIndex !== null && wasSpinningRef.current && !spinning)
    );

    if (shouldTriggerLanding && anim.phase !== 'landing') {
      wasSpinningRef.current = false;

      // Freeze segments & texture at the moment landing starts
      const frozenParts = participantsRef.current;
      const frozenSegs = buildSegments(frozenParts);
      frozenSegmentsRef.current = frozenSegs;
      frozenTextureRef.current = rebuildTexture(frozenSegs, frozenParts);
      textureRef.current = frozenTextureRef.current;

      // Calculate target angle — randomized within winner segment (80% inner band, 10% padding each side)
      const total = frozenParts.reduce((s, p) => s + p.usdcAmount, 0) || 1;
      let accAngle = 0;
      for (let i = 0; i < (winnerIndex ?? 0); i++) {
        accAngle += (frozenParts[i].usdcAmount / total) * Math.PI * 2;
      }
      const idx = winnerIndex ?? 0;
      const segAngle = (frozenParts[idx].usdcAmount / total) * Math.PI * 2;
      // Land anywhere within 10%–90% of the segment (avoid edges)
      const padding = 0.10;
      const randomT = padding + Math.random() * (1 - 2 * padding);
      const targetPoint = accAngle + segAngle * randomT;

      // Pointer is at -PI/2 (top), wheel rotates clockwise (positive angle)
      const desiredAngle = -Math.PI / 2 - targetPoint;
      const currentMod = ((anim.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const targetMod = ((desiredAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let delta = targetMod - currentMod;
      if (delta < 0) delta += Math.PI * 2;

      // Match the initial landing speed to the current spinning velocity
      // so the transition from free-spin to deceleration is seamless.
      // landingEase derivative at t=0 = EASE_EXPONENT, so:
      //   initialVelocity = totalDelta * EASE_EXPONENT / LANDING_DURATION_sec
      const currentVelRadSec = anim.velocity * 60; // ~rad/sec at 60fps
      const naturalTotal = currentVelRadSec * (LANDING_DURATION / 1000) / EASE_EXPONENT;
      const rawSpins = (naturalTotal - delta) / (Math.PI * 2);
      const spins = Math.max(Math.ceil(rawSpins), 4); // at least 4 full rotations
      const totalDelta = spins * Math.PI * 2 + delta;

      anim.targetAngle = anim.angle + totalDelta;
      anim.startAngle = anim.angle;
      anim.landingStart = performance.now();
      anim.phase = 'landing';
    }
  }, [winnerIndex, rebuildTexture, spinning]);

  // ─── Animation Loop ──────────────────────────────────
  useEffect(() => {
    let rafId: number;
    const mainCanvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!mainCanvas || !overlayCanvas) return;

    const mainCtx = mainCanvas.getContext('2d')!;
    const overlayCtx = overlayCanvas.getContext('2d')!;

    // Set canvas size for DPR
    const cssSize = CANVAS_SIZE;
    const pxSize = cssSize * dpr;
    mainCanvas.width = pxSize;
    mainCanvas.height = pxSize;
    overlayCanvas.width = pxSize;
    overlayCanvas.height = pxSize;

    const loop = (now: number) => {
      const anim = animRef.current;
      const dt = 1 / 60; // normalized frame time

      // ── Update ──
      switch (anim.phase) {
        case 'idle': {
          anim.idleTime = now * 0.001;
          anim.angle += 0.001; // very slow rotation
          break;
        }
        case 'spinning': {
          if (!spinning) {
            // spinning prop turned off but no winner yet — go back to idle
            anim.velocity *= 0.98;
            if (anim.velocity < 0.001) {
              anim.phase = 'idle';
              anim.velocity = 0;
            }
            anim.angle += anim.velocity;
          } else {
            anim.velocity = Math.min(anim.velocity + 0.008 * dt * 60, 0.25);
            anim.angle += anim.velocity;
          }
          break;
        }
        case 'landing': {
          const elapsed = now - anim.landingStart;
          const t = Math.min(elapsed / LANDING_DURATION, 1);
          const eased = landingEase(t);
          anim.angle = anim.startAngle + (anim.targetAngle - anim.startAngle) * eased;

          if (t >= 1 && anim.phase === 'landing') {
            anim.angle = anim.startAngle + (anim.targetAngle - anim.startAngle); // exact target
            anim.phase = 'celebration';
            anim.celebrationStart = now;
            anim.velocity = 0;
            // Spawn confetti using frozen segments
            const activeSegs = frozenSegmentsRef.current ?? segments;
            const winIdx = winnerIndex ?? 0;
            const color = activeSegs[winIdx]?.color || '#ffd700';
            anim.particles = spawnConfetti(color);
            playWinSound();
            // Fire onSpinComplete on actual animation end
            onSpinCompleteRef.current();
          }
          break;
        }
        case 'celebration': {
          // Stay on winner angle, particles decay
          if (anim.particles.length === 0 && now - anim.celebrationStart > 3000) {
            anim.phase = 'idle';
            // Unfreeze segments — allow texture to update with fresh data
            frozenSegmentsRef.current = null;
            frozenTextureRef.current = null;
          }
          break;
        }
      }

      // Tick sound — detect pin crossing
      if (anim.phase === 'spinning' || anim.phase === 'landing') {
        const pointerAngle = -Math.PI / 2;
        const normalizedAngle = (((-anim.angle + pointerAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const pinIdx = Math.floor(normalizedAngle / (Math.PI * 2 / PIN_COUNT));
        if (pinIdx !== anim.lastPinIdx) {
          anim.lastPinIdx = pinIdx;
          playTick();
        }
      }

      // ── Draw Main Canvas ──
      mainCtx.save();
      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.clearRect(0, 0, pxSize, pxSize);

      // Scale + optional idle breathing
      mainCtx.scale(dpr, dpr);
      const breathScale = anim.phase === 'idle'
        ? 1 + 0.008 * Math.sin(anim.idleTime * 2)
        : 1;

      mainCtx.translate(CENTER, CENTER);
      mainCtx.scale(breathScale, breathScale);
      mainCtx.rotate(anim.angle);
      mainCtx.translate(-CENTER, -CENTER);

      if (textureRef.current) {
        mainCtx.drawImage(textureRef.current, 0, 0, pxSize, pxSize, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
      mainCtx.restore();

      // ── Draw Overlay ──
      overlayCtx.save();
      overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      overlayCtx.clearRect(0, 0, pxSize, pxSize);
      overlayCtx.scale(dpr, dpr);

      // Pointer
      drawPointer(overlayCtx, isDark);

      // Winner glow (use frozen segments if available for consistency)
      if (anim.phase === 'celebration' && winnerIndex !== null) {
        const pulseT = (now - anim.celebrationStart) / 1000;
        const activeSegs = frozenSegmentsRef.current ?? segments;
        drawWinnerGlow(overlayCtx, activeSegs, winnerIndex, anim.angle, pulseT);
      }

      // Confetti
      if (anim.particles.length > 0) {
        updateAndDrawConfetti(overlayCtx, anim.particles);
      }

      overlayCtx.restore();

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [dpr, isDark, segments, spinning, winnerIndex]);

  // ─── Start spinning phase when prop changes ──────────
  useEffect(() => {
    if (!spinning) return;
    wasSpinningRef.current = true;
    const anim = animRef.current;
    if (anim.phase === 'idle') {
      anim.phase = 'spinning';
      anim.velocity = 0.02;
    } else if (anim.phase === 'celebration' || anim.phase === 'landing') {
      // New round started while previous round's animation is still playing.
      // Cut it short and start the new spin immediately.
      anim.phase = 'spinning';
      anim.velocity = 0.02;
      anim.particles = [];
      frozenSegmentsRef.current = null;
      frozenTextureRef.current = null;
      // Rebuild texture with current (new round) participants
      textureRef.current = rebuildTexture(segments, participants);
    }
    // If anim.phase is already 'spinning' (e.g. decelerating), the animation
    // loop will re-accelerate automatically since the `spinning` prop is true.
  }, [spinning]);

  // ─── Render ──────────────────────────────────────────
  const hasParticipants = participants.length > 0;

  return (
    <div className="relative flex items-center justify-center" style={{ width: '100%', maxWidth: 400 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1' }}
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0"
        style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1', pointerEvents: 'none' }}
      />
      {/* Center text overlay (HTML for crisp rendering) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          {hasParticipants ? (
            <>
              <div className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                ${formatUsdcCompact(totalUsdc)}
              </div>
              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                USDC
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-400 dark:text-slate-500">
                Waiting
              </div>
              <div className="text-[10px] text-slate-300 dark:text-slate-600">
                for players
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
