// Ambient backdrop: a scatter of stars, nodding to UT Dallas' origin as
// a space-geophysics research center. The comet itself only appears in
// the periodic CometFlyby animation, not as a static fixture here.
//
// Stars are small 4-point sparkle shapes (not plain circles) so they
// actually read as stars. Uses a wide viewBox with "slice" (crop, not
// stretch) so the sparkle shapes stay proportional on any screen size
// instead of getting skewed into ellipses.
const SPARKLE_PATH =
  "M0 -5 Q0.9 -0.9 5 0 Q0.9 0.9 0 5 Q-0.9 0.9 -5 0 Q-0.9 -0.9 0 -5 Z";

export default function ScheduleGridBackdrop() {
  const stars = [
    [60, 60, 0.6, 0.4], [180, 140, 0.5, 0.35], [320, 80, 0.9, 0.6],
    [420, 220, 0.55, 0.4], [560, 60, 1.1, 0.75], [700, 160, 0.6, 0.45],
    [80, 260, 0.5, 0.35], [220, 320, 0.8, 0.55], [380, 380, 0.6, 0.4],
    [500, 300, 1.0, 0.7], [640, 380, 0.55, 0.4], [740, 420, 0.7, 0.5],
    [140, 420, 0.5, 0.35], [300, 460, 0.6, 0.4], [460, 440, 0.5, 0.35],
    [620, 460, 0.85, 0.55], [40, 180, 0.5, 0.3],
  ];

  return (
    <svg
      className="grid-backdrop"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {stars.map(([x, y, scale, opacity], i) => (
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
