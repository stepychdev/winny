import { useEffect, useRef, useState } from 'react';

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}

export function AnimatedNumber({ value, duration = 500, format }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;

    if (from === to) return;

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setDisplay(from + (to - from) * easeOut(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const text = format ? format(display) : String(Math.round(display));

  return <>{text}</>;
}
