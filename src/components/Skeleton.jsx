import "./Skeleton.css";

// Single shimmering placeholder block. `width`/`height` accept any CSS
// size value (defaults suit a line of text).
export default function Skeleton({ width = "100%", height = "1em", className = "" }) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
