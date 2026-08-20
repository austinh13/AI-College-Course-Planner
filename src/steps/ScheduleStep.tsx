import { useEffect } from "react";
import Eyebrow from "../components/Eyebrow";
import { Button } from "../components/lightswind/button";
import { generateSchedules } from "../lib/scheduleCourses";
import { rmpProfileUrl } from "../lib/professorRatings";
import ScheduleCalendar from "../components/ScheduleCalendar";
import Skeleton from "../components/Skeleton";
import CountUp from "../components/CountUp";
import { HoverCard } from "../components/lightswind/hover-card";
import type { Constraints } from "../types";

type InstructorRating = {
  name: string;
  gradeRating: number | null;
  gradeIsCourseSpecific: boolean;
  gradeSemesterCount: number | null;
  rmpQuality: number | null;
};

type Section = {
  sectionId: string;
  label: string;
  meetings: Array<{ day: string; start: number; end: number; kind?: string }>;
  term: string;
  instructorRatings?: InstructorRating[];
};

type ScheduleEntry = { code: string; section: Section };

type ScheduleResult = {
  total: number;
  blockedBy: string | null;
  blockedReason: "preferences" | "honors" | "time" | null;
  excluded: Array<{ code: string; reason: string }>;
  schedules: ScheduleEntry[][];
  truncated: boolean;
};

export type ScheduleStepState = {
  result: ScheduleResult | null;
  error: string | null;
  scheduleIndex: number;
  pinned: Record<string, string>;
  requestKey: string | null;
};

export const initialScheduleStepState: ScheduleStepState = {
  result: null,
  error: null,
  scheduleIndex: 0,
  pinned: {},
  requestKey: null,
};

export default function ScheduleStep({
  courses,
  constraints,
  isHonors,
  state,
  onChange,
  onBack,
}: {
  courses: string[];
  constraints: Constraints;
  isHonors: boolean;
  state: ScheduleStepState;
  onChange: (patch: Partial<ScheduleStepState>) => void;
  onBack: () => void;
}) {
  const { result, error, scheduleIndex, pinned } = state;

  useEffect(() => {
    if (!courses.length) return;
    const requestKey = JSON.stringify({ courses, constraints, isHonors });
    if (state.requestKey === requestKey) return;

    let cancelled = false;
    onChange({ result: null, error: null, scheduleIndex: 0, pinned: {}, requestKey });

    generateSchedules({ courses, constraints, isHonors })
      .then((data) => {
        if (!cancelled) onChange({ result: data as ScheduleResult, requestKey });
      })
      .catch((err) => {
        console.error("[ScheduleStep] generateSchedules failed:", err);
        if (!cancelled) onChange({ error: err.message, requestKey });
      });

    return () => {
      cancelled = true;
    };
    // state.requestKey is intentionally omitted: it's set as part of this
    // effect's own body (to mark the request as in flight), so including it
    // would re-trigger the effect and cancel the fetch before it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, constraints, isHonors]);

  if (!courses.length) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <h1 className="m-0 text-display font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          No courses to schedule yet.
        </h1>
        <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">Go back and pick your next-term courses first.</p>
        <button type="button" className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-md text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back to recommended courses
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <h1 className="m-0 text-display font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Couldn't build a schedule.
        </h1>
        <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">{error}</p>
        <button type="button" className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-md text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <Eyebrow boxed={false}>Possible schedules</Eyebrow>
        <h1 className="m-0 text-display font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
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
  const pinnedEntries = Object.entries(pinned);
  const visibleSchedules =
    schedules && pinnedEntries.length
      ? schedules.filter((schedule) =>
          pinnedEntries.every(([code, sectionId]) =>
            schedule.some((entry) => entry.code === code && entry.section.sectionId === sectionId)
          )
        )
      : schedules;
  const currentSchedule = visibleSchedules && visibleSchedules.length ? visibleSchedules[scheduleIndex] : null;

  function togglePin(code: string, sectionId: string) {
    const next = { ...pinned };
    if (next[code] === sectionId) {
      delete next[code];
    } else {
      next[code] = sectionId;
    }
    onChange({ pinned: next, scheduleIndex: 0 });
  }

  function unpin(code: string) {
    const next = { ...pinned };
    delete next[code];
    onChange({ pinned: next, scheduleIndex: 0 });
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
      <Eyebrow>Possible schedules</Eyebrow>
      <h1 className="m-0 text-display font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
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
        <div className="rounded-panel border border-white/10 bg-[#0d1b18]/80 p-4 shadow-[0_18px_36px_rgba(0,0,0,0.18)]">
          <p className="mb-2 text-base text-[#e87500]">Couldn't auto-schedule {excluded.length} course(s):</p>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-base text-[#8a8d8f]">
            {excluded.map((item) => (
              <li key={item.code}>
                <span className="font-mono text-[#f2f5f3]">{item.code}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pinnedEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.08em] text-[#8a8d8f]">Pinned:</span>
          {pinnedEntries.map(([code, sectionId]) => (
            <button
              type="button"
              key={code}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#5fe0b7]/40 bg-[#5fe0b7]/10 px-3 py-1 text-sm text-[#5fe0b7] transition-colors hover:border-[#5fe0b7]"
              onClick={() => unpin(code)}
            >
              {code} ×
            </button>
          ))}
        </div>
      )}

      {pinnedEntries.length > 0 && visibleSchedules.length === 0 && (
        <div className="rounded-panel border border-white/10 bg-[#0d1b18]/80 p-4 shadow-[0_18px_36px_rgba(0,0,0,0.18)]">
          <p className="m-0 text-base text-[#8a8d8f]">No schedules match your pinned sections.</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center rounded-full border border-[#1f5c43] bg-transparent px-4 py-1.5 text-sm text-[#f2f5f3] transition-colors hover:border-[#8a8d8f]"
            onClick={() => onChange({ pinned: {}, scheduleIndex: 0 })}
          >
            Clear pins
          </button>
        </div>
      )}

      {currentSchedule && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-base text-[#8a8d8f]">
              {visibleSchedules.length > 1
                ? `Schedule ${scheduleIndex + 1} of ${visibleSchedules.length}`
                : "One example:"}
            </p>
            {visibleSchedules.length > 1 && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#1f5c43] bg-[#154734] text-base text-[#f2f5f3] transition-colors hover:border-[#5fe0b7] hover:text-[#5fe0b7]"
                  onClick={() => onChange({ scheduleIndex: (scheduleIndex - 1 + visibleSchedules.length) % visibleSchedules.length })}
                  aria-label="Previous schedule"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[#1f5c43] bg-[#154734] text-base text-[#f2f5f3] transition-colors hover:border-[#5fe0b7] hover:text-[#5fe0b7]"
                  onClick={() => onChange({ scheduleIndex: (scheduleIndex + 1) % visibleSchedules.length })}
                  aria-label="Next schedule"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <ScheduleCalendar example={currentSchedule} pinned={pinned} onTogglePin={togglePin} />
          <ul className="m-0 list-none space-y-2.5 p-0">
            {currentSchedule.map(({ code, section }) => {
              const instructorRatings = section.instructorRatings || [];
              const isPinned = pinned[code] === section.sectionId;
              return (
                <li className="rounded-panel border border-white/10 bg-[#0d1b18]/80 p-4 shadow-[0_18px_36px_rgba(0,0,0,0.18)]" key={code}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-[#5fe0b7]" style={{ fontFamily: "var(--font-mono)" }}>{code}</span>
                    <button
                      type="button"
                      className={`shrink-0 rounded-full border px-3 py-1 text-2xs transition-colors ${
                        isPinned
                          ? "border-[#5fe0b7] bg-[#5fe0b7]/10 text-[#5fe0b7]"
                          : "border-[#1f5c43] bg-transparent text-[#8a8d8f] hover:border-[#5fe0b7] hover:text-[#5fe0b7]"
                      }`}
                      onClick={() => togglePin(code, section.sectionId)}
                    >
                      {isPinned ? "Pinned" : "Pin"}
                    </button>
                  </div>
                  <p className="mt-1 mb-0 text-base text-[#f2f5f3]">{section.label}</p>
                  {instructorRatings.length > 0 && (
                    <ul className="mt-1.5 list-none space-y-1 p-0">
                      {instructorRatings.map(({ name, gradeRating, gradeIsCourseSpecific, gradeSemesterCount, rmpQuality }) => (
                        <li key={name} className="flex flex-wrap items-baseline gap-2.5">
                          <span className="text-sm text-[#f2f5f3]">
                            {gradeRating != null
                              ? `${gradeRating.toFixed(2)} GPA ${gradeIsCourseSpecific ? `in ${code}` : "(overall)"}`
                              : "No grade data"}
                          </span>
                          {gradeIsCourseSpecific && gradeSemesterCount != null && (
                            <span className="text-2xs text-[#8a8d8f]">
                              ({gradeSemesterCount} semester{gradeSemesterCount === 1 ? "" : "s"} on record)
                            </span>
                          )}
                          <HoverCard
                            trigger={
                              <a
                                className="text-sm text-[#5fe0b7] no-underline hover:underline"
                                href={rmpProfileUrl(name, section.term)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {name} ratings ↗
                              </a>
                            }
                          >
                            <p className="m-0 text-sm font-semibold text-[#f2f5f3]">{name}</p>
                            <dl className="mt-2 mb-0 space-y-1.5 text-xs text-[#b0b8b5]">
                              <div className="flex items-center justify-between gap-3">
                                <dt>GPA{gradeIsCourseSpecific ? ` in ${code}` : " (overall)"}</dt>
                                <dd className="m-0 font-medium text-[#f2f5f3]">
                                  {gradeRating != null ? gradeRating.toFixed(2) : "—"}
                                </dd>
                              </div>
                              {gradeIsCourseSpecific && (
                                <div className="flex items-center justify-between gap-3">
                                  <dt>Semesters taught ({code})</dt>
                                  <dd className="m-0 font-medium text-[#f2f5f3]">
                                    {gradeSemesterCount != null ? gradeSemesterCount : "—"}
                                  </dd>
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-3">
                                <dt>RateMyProfessors</dt>
                                <dd className="m-0 font-medium text-[#f2f5f3]">
                                  {rmpQuality != null ? `${rmpQuality.toFixed(1)} / 5` : "—"}
                                </dd>
                              </div>
                            </dl>
                            <p className="mt-2 mb-0 text-2xs text-[#8a8d8f]">
                              Click to open the full profile on trends.utdnebula.com.
                            </p>
                          </HoverCard>
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
        <Button type="button" variant="outline" className="rounded-full border border-white/10 bg-transparent px-8 py-4 text-md text-[#f2f5f3] transition-colors duration-200 hover:border-white/20 hover:bg-white/5" onClick={onBack}>
          Back to recommended courses
        </Button>
      </div>
    </div>
  );
}
