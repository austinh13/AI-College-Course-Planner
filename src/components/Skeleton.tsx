import "./Skeleton.css";

export default function Skeleton({ width = "100%", height = "1em", className = "" }: { width?: string; height?: string; className?: string }) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

