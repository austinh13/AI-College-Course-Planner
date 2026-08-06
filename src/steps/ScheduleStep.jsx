import { useEffect, useState } from "react";
import { generateSchedules } from "../lib/scheduleCourses";
import ScheduleCalendar from "../components/ScheduleCalendar";
import "./ScheduleStep.css";

export default function ScheduleStep({ courses, constraints, onBack }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log("[ScheduleStep] courses:", courses);
    if (!courses.length) return;
    let cancelled = false;
    setResult(null);
    setError(null);

    generateSchedules({ courses, constraints })
      .then((data) => {
        console.log("[ScheduleStep] result:", data);
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        console.error("[ScheduleStep] generateSchedules failed:", err);
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [courses, constraints]);

  if (!courses.length) {
    return (
      <div className="step-panel s5-panel">
        <h1 className="step-panel__title">No courses to schedule yet.</h1>
        <p className="step-panel__hint">Go back and pick your next-term courses first.</p>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back to recommended courses
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="step-panel s5-panel">
        <h1 className="step-panel__title">Couldn't build a schedule.</h1>
        <p className="step-panel__hint">{error}</p>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="step-panel s5-panel">
        <p className="step-panel__eyebrow">Possible schedules</p>
        <h1 className="step-panel__title">Checking every combination…</h1>
      </div>
    );
  }

  const { total, blockedBy, excluded, example, truncated } = result;

  return (
    <div className="step-panel s5-panel">
      <p className="step-panel__eyebrow">Possible schedules</p>
      <h1 className="step-panel__title">
        {total.toLocaleString()} possible
        <br />
        schedule{total === 1 ? "" : "s"}.
      </h1>

      {blockedBy && (
        <p className="step-panel__hint">
          No section of <strong>{blockedBy}</strong> fits your time constraints — loosen your days off, time
          blocks, or lunch window and try again.
        </p>
      )}

      {!blockedBy && total === 0 && (
        <p className="step-panel__hint">
          None of the remaining courses' sections fit together without a conflict. Try loosening your time
          constraints.
        </p>
      )}

      {truncated && (
        <p className="step-panel__hint">
          That's a lot of combinations — the count above stopped at a safety limit and may be a slight
          undercount.
        </p>
      )}

      {excluded.length > 0 && (
        <div className="s5-excluded">
          <p className="s5-excluded__title">Couldn't auto-schedule {excluded.length} course(s):</p>
          <ul>
            {excluded.map((item) => (
              <li key={item.code}>
                <span className="s5-excluded__code">{item.code}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {example && (
        <div className="s5-example">
          <p className="s5-example__title">One example:</p>
          <ScheduleCalendar example={example} />
          <ul className="s5-cards">
            {example.map(({ code, section }) => (
              <li className="s5-card" key={code}>
                <span className="s5-card__tag">{code}</span>
                <p className="s5-card__label">{section.label}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="step-panel__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back to recommended courses
        </button>
      </div>
    </div>
  );
}
