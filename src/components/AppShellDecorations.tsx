import { useState } from "react";

const SPARKLE_PATH =
  "M0 -5 Q0.9 -0.9 5 0 Q0.9 0.9 0 5 Q-0.9 0.9 -5 0 Q-0.9 -0.9 0 -5 Z";

const STEP_ITEMS = [
  { n: "01", label: "About you" },
  { n: "02", label: "Time constraints" },
  { n: "03", label: "Academic history" },
  { n: "04", label: "Recommended courses" },
  { n: "05", label: "Schedule" },
];

const GRID_STARS = [
  [60, 60, 0.6, 0.4], [180, 140, 0.5, 0.35], [320, 80, 0.9, 0.6],
  [420, 220, 0.55, 0.4], [560, 60, 1.1, 0.75], [700, 160, 0.6, 0.45],
  [80, 260, 0.5, 0.35], [220, 320, 0.8, 0.55], [380, 380, 0.6, 0.4],
  [500, 300, 1.0, 0.7], [640, 380, 0.55, 0.4], [740, 420, 0.7, 0.5],
  [140, 420, 0.5, 0.35], [300, 460, 0.6, 0.4], [460, 440, 0.5, 0.35],
  [620, 460, 0.85, 0.55], [40, 180, 0.5, 0.3],
];

export function ScheduleGridBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 opacity-90"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {GRID_STARS.map(([x, y, scale, opacity], i) => (
        <path
          key={i}
          d={SPARKLE_PATH}
          transform={`translate(${x} ${y}) scale(${scale})`}
          fill="var(--paper-100)"
          opacity={opacity}
        />
      ))}
    </svg>
  );
}

export function CometFlyby() {
  const [delay] = useState(() => (13 + Math.random() * 10).toFixed(2));

  return (
    <div
      className="comet-flyby"
      style={{ animationDelay: `${delay}s` }}
      aria-hidden="true"
    />
  );
}

export function StepIndicator({ current, furthest = current, onNavigate }: { current: number; furthest?: number; onNavigate?: (index: number) => void }) {
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0 text-[0.8rem] sm:gap-3">
      {STEP_ITEMS.map((step, i) => {
        const unlocked = i <= furthest;
        const isActive = i === current;
        const isDone = i < current;
        return (
          <li key={step.n} className="flex items-center">
            <button
              type="button"
              className={[
                "flex items-center gap-2 rounded-full border px-2.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] transition-all duration-200",
                unlocked ? "cursor-pointer" : "cursor-default",
                isActive
                  ? "border-[#e87500]/40 bg-[#e87500]/10 text-[#f4d2b1] shadow-[0_0_0_1px_rgba(232,117,0,0.15)]"
                  : isDone
                    ? "border-[#5fe0b7]/25 bg-[#5fe0b7]/8 text-[#dffcf5]"
                    : "border-transparent bg-transparent text-[#8a8d8f]",
                unlocked && !isActive ? "hover:border-white/10 hover:bg-white/5 hover:text-[#f2f5f3]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!unlocked}
              onClick={() => onNavigate && onNavigate(i)}
            >
              <span className="font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{step.n}</span>
              <span className="hidden sm:inline" style={{ fontFamily: "var(--font-mono)" }}>{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

