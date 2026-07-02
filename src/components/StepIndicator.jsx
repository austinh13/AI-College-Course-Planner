const STEPS = [
  { n: "01", label: "About you" },
  { n: "02", label: "Time constraints" },
];

export default function StepIndicator({ current }) {
  return (
    <ol className="step-indicator">
      {STEPS.map((step, i) => (
        <li
          key={step.n}
          className={
            i === current ? "is-active" : i < current ? "is-done" : ""
          }
        >
          <span className="step-indicator__num">{step.n}</span>
          <span className="step-indicator__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
