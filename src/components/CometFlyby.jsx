import { useState } from "react";

// Periodic flourish: a comet streaks across the whole screen roughly
// every 26s, separate from the static comet-trail artwork in the
// backdrop. Pure CSS animation — no timer/JS needed to loop it.
// The initial delay is randomized within 13-23s so it doesn't fire
// the instant the page loads on every refresh.
export default function CometFlyby() {
  const [delay] = useState(() => (13 + Math.random() * 10).toFixed(2));

  return (
    <div
      className="comet-flyby"
      style={{ animationDelay: `${delay}s` }}
      aria-hidden="true"
    />
  );
}
