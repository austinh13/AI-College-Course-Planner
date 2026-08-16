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
      className="grid-backdrop"
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

// `furthest` is the highest stage index the user has unlocked by
// completing everything before it. Steps up to and including that are
// clickable; anything past it is shown but inert (not yet reachable).
export function StepIndicator({ current, furthest = current, onNavigate }) {
  return (
    <ol className="step-indicator">
      {STEP_ITEMS.map((step, i) => {
        const unlocked = i <= furthest;
        return (
          <li
            key={step.n}
            className={[
              i === current ? "is-active" : i < current ? "is-done" : "",
              unlocked ? "is-clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              type="button"
              className="step-indicator__button"
              disabled={!unlocked}
              onClick={() => onNavigate && onNavigate(i)}
            >
              <span className="step-indicator__num">{step.n}</span>
              <span className="step-indicator__label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
