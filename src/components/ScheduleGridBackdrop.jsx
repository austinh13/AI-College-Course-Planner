// Signature visual: a tilted timetable grid. The whole product is about
// slicing a week into blocks, so the backdrop is literally that grid,
// rotated off-axis and pushed to one side rather than centered.
export default function ScheduleGridBackdrop() {
  const rows = 6;
  const cols = 5;

  return (
    <svg
      className="grid-backdrop"
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g transform="rotate(-8 200 300)">
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1={-40}
            x2={440}
            y1={40 + i * 90}
            y2={40 + i * 90}
            stroke="var(--panel-600)"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <line
            key={`v-${i}`}
            x1={20 + i * 80}
            x2={20 + i * 80}
            y1={-20}
            y2={620}
            stroke="var(--panel-600)"
            strokeWidth="1"
          />
        ))}
        <rect x={100} y={220} width={80} height={90} fill="var(--mint-400)" opacity="0.16" />
        <rect x={260} y={130} width={80} height={90} fill="var(--amber-500)" opacity="0.14" />
      </g>
    </svg>
  );
}
