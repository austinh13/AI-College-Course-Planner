import { useEffect, useState } from "react";
import { generateSchedules } from "../lib/scheduleCourses";
import { rmpProfileUrl } from "../lib/professorRatings";
import ScheduleCalendar from "../components/ScheduleCalendar";
import Skeleton from "../components/Skeleton";
import CountUp from "../components/CountUp";

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
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          No courses to schedule yet.
        </h1>
        <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">Go back and pick your next-term courses first.</p>
        <button type="button" className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back to recommended courses
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Couldn't build a schedule.
        </h1>
        <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">{error}</p>
        <button type="button" className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
          Possible schedules
        </p>
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Checking every combination…
        </h1>
        <Skeleton height="220px" className="my-4" />
        <ul className="m-0 list-none space-y-2.5 p-0">
          {[0, 1, 2].map((i) => (
            <li className="rounded-xl border border-[#1f5c43] bg-[#154734] p-4" key={i}>
              <Skeleton width="30%" height="0.75rem" />
              <Skeleton width="70%" height="1rem" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { total, blockedBy, blockedReason, excluded, schedules, truncated } = result;
  const currentSchedule = schedules && schedules.length ? schedules[scheduleIndex] : null;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
      <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
        Possible schedules
      </p>
      <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
        <CountUp value={total} /> possible
        <br />
        schedule{total === 1 ? "" : "s"}.
      </h1>

      {blockedBy && blockedReason === "preferences" && (
        <p className="-mt-2 max-w-[40ch] text-[#8a8d8f]">
          No section of <strong className="text-[#f2f5f3]">{blockedBy}</strong> has a professor meeting your grade/rating preference — lower
          that preference on Screen 2 and try again.
        </p>
      )}

      {blockedBy && blockedReason === "honors" && (
        <p className="-mt-2 max-w-[40ch] text-[#8a8d8f]">
          <strong className="text-[#f2f5f3]">{blockedBy}</strong> is only offered as an Honors section this term, and you're not marked as an
          Honors student — go back to Screen 1 to change that, or swap this course out.
        </p>
      )}

      {blockedBy && blockedReason !== "preferences" && blockedReason !== "honors" && (
        <p className="-mt-2 max-w-[40ch] text-[#8a8d8f]">
          No section of <strong className="text-[#f2f5f3]">{blockedBy}</strong> fits your time constraints — loosen your days off, time
          blocks, or lunch window and try again.
        </p>
      )}

      {!blockedBy && total === 0 && (
        <p className="-mt-2 max-w-[40ch] text-[#8a8d8f]">
          None of the remaining courses' sections fit together without a conflict. Try loosening your time
          constraints.
        </p>
      )}

      {truncated && (
        <p className="-mt-2 max-w-[40ch] text-[#8a8d8f]">
          That's a lot of combinations — the count above stopped at a safety limit and may be a slight
          undercount.
        </p>
      )}

      {excluded.length > 0 && (
        <div className="rounded-xl border border-[#1f5c43] bg-[#154734] p-4">
          <p className="mb-2 text-[0.9rem] text-[#e87500]">Couldn't auto-schedule {excluded.length} course(s):</p>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[0.9rem] text-[#8a8d8f]">
            {excluded.map((item) => (
              <li key={item.code}>
                <span className="font-mono text-[#f2f5f3]">{item.code}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentSchedule && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[0.9rem] text-[#8a8d8f]">
              {schedules.length > 1
                ? `Schedule ${scheduleIndex + 1} of ${schedules.length}`
                : "One example:"}
            </p>
            {schedules.length > 1 && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#1f5c43] bg-[#154734] text-base text-[#f2f5f3] transition-colors hover:border-[#5fe0b7] hover:text-[#5fe0b7]"
                  onClick={() => setScheduleIndex((i) => (i - 1 + schedules.length) % schedules.length)}
                  aria-label="Previous schedule"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#1f5c43] bg-[#154734] text-base text-[#f2f5f3] transition-colors hover:border-[#5fe0b7] hover:text-[#5fe0b7]"
                  onClick={() => setScheduleIndex((i) => (i + 1) % schedules.length)}
                  aria-label="Next schedule"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <ScheduleCalendar example={currentSchedule} />
          <ul className="m-0 list-none space-y-2.5 p-0">
            {currentSchedule.map(({ code, section }) => {
              const instructorRatings = section.instructorRatings || [];
              return (
                <li className="rounded-xl border border-[#1f5c43] bg-[#154734] p-4" key={code}>
                  <span className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[#5fe0b7]" style={{ fontFamily: "var(--font-mono)" }}>{code}</span>
                  <p className="mt-1 mb-0 text-[0.95rem] text-[#f2f5f3]">{section.label}</p>
                  {instructorRatings.length > 0 && (
                    <ul className="mt-1.5 list-none space-y-1 p-0">
                      {instructorRatings.map(({ name, gradeRating, gradeIsCourseSpecific }) => (
                        <li key={name} className="flex flex-wrap items-baseline gap-2.5">
                          <span className="text-[0.8rem] text-[#f2f5f3]">
                            {gradeRating != null
                              ? `${gradeRating.toFixed(2)} GPA ${gradeIsCourseSpecific ? `in ${code}` : "(overall)"}`
                              : "No grade data"}
                          </span>
                          <a
                            className="text-[0.8rem] text-[#5fe0b7] no-underline hover:underline"
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

      <div className="mt-1 flex gap-3">
        <button type="button" className="rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back to recommended courses
        </button>
      </div>
    </div>
  );
}
