import { useEffect, useState } from "react";
import { generateSchedules } from "../lib/scheduleCourses";
import { rmpProfileUrl } from "../lib/professorRatings";
import ScheduleCalendar from "../components/ScheduleCalendar";
import "./ScheduleStep.css";

export default function ScheduleStep({ courses, constraints, isHonors, onBack }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [scheduleIndex, setScheduleIndex] = useState(0);

  useEffect(() => {
    console.log("[ScheduleStep] courses:", courses);
    if (!courses.length) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    setScheduleIndex(0);

    generateSchedules({ courses, constraints, isHonors })
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
  }, [courses, constraints, isHonors]);

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

  const { total, blockedBy, blockedReason, excluded, schedules, truncated } = result;
  const currentSchedule = schedules && schedules.length ? schedules[scheduleIndex] : null;

  return (
    <div className="step-panel s5-panel">
      <p className="step-panel__eyebrow">Possible schedules</p>
      <h1 className="step-panel__title">
        {total.toLocaleString()} possible
        <br />
        schedule{total === 1 ? "" : "s"}.
      </h1>

      {blockedBy && blockedReason === "preferences" && (
        <p className="step-panel__hint">
          No section of <strong>{blockedBy}</strong> has a professor meeting your grade/rating preference — lower
          that preference on Screen 2 and try again.
        </p>
      )}

      {blockedBy && blockedReason === "honors" && (
        <p className="step-panel__hint">
          <strong>{blockedBy}</strong> is only offered as an Honors section this term, and you're not marked as an
          Honors student — go back to Screen 1 to change that, or swap this course out.
        </p>
      )}

      {blockedBy && blockedReason !== "preferences" && blockedReason !== "honors" && (
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

      {currentSchedule && (
        <div className="s5-example">
          <div className="s5-example__header">
            <p className="s5-example__title">
              {schedules.length > 1
                ? `Schedule ${scheduleIndex + 1} of ${schedules.length}`
                : "One example:"}
            </p>
            {schedules.length > 1 && (
              <div className="s5-cycle">
                <button
                  type="button"
                  className="s5-cycle__btn"
                  onClick={() => setScheduleIndex((i) => (i - 1 + schedules.length) % schedules.length)}
                  aria-label="Previous schedule"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="s5-cycle__btn"
                  onClick={() => setScheduleIndex((i) => (i + 1) % schedules.length)}
                  aria-label="Next schedule"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <ScheduleCalendar example={currentSchedule} />
          <ul className="s5-cards">
            {currentSchedule.map(({ code, section }) => {
              const instructorRatings = section.instructorRatings || [];
              return (
                <li className="s5-card" key={code}>
                  <span className="s5-card__tag">{code}</span>
                  <p className="s5-card__label">{section.label}</p>
                  {instructorRatings.length > 0 && (
                    <ul className="s5-card__ratings">
                      {instructorRatings.map(({ name, gradeRating, gradeIsCourseSpecific }) => (
                        <li key={name} className="s5-card__rating-row">
                          <span className="s5-card__gpa">
                            {gradeRating != null
                              ? `${gradeRating.toFixed(2)} GPA ${gradeIsCourseSpecific ? `in ${code}` : "(overall)"}`
                              : "No grade data"}
                          </span>
                          <a
                            className="s5-card__rating-link"
                            href={rmpProfileUrl(name, section.term)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {name} ratings ↗
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
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
