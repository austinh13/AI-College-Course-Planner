import React, { useMemo, useCallback } from "react";
import Eyebrow from "../components/Eyebrow";
import { Button } from "../components/lightswind/button";
import { Input } from "../components/lightswind/input";

// Days and labeled time blocks for the UI. Kept as constants to avoid
// recreating these arrays on every render.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME_BLOCKS = [
  { id: "early", label: "Early (8–10am)" },
  { id: "morning", label: "Morning (10am–12pm)" },
  { id: "afternoon", label: "Afternoon (12–4pm)" },
  { id: "evening", label: "Evening (4pm+)" },
];

// Toggle helper implemented with a Set to make intent clear and avoid
// an extra iteration when adding/removing items (small constant overhead
// for Set creation, but clearer and often faster for larger lists).
function toggle(list, value) {
  const s = new Set(list);
  if (s.has(value)) {
    s.delete(value);
    return Array.from(s);
  }
  s.add(value);
  return Array.from(s);
}

export default function TimeConstraintsStep({ data, onChange, onBack, onSubmit }) {
  // Derived boolean indicating whether the user may proceed. useMemo
  // avoids recalculating the Number(...) conversion on unrelated renders.
  const canSubmit = useMemo(() => data.targetHours !== "" && Number(data.targetHours) > 0, [data.targetHours]);

  // Memoized submit handler. Keeps a stable reference for the form.
  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (canSubmit) onSubmit();
    },
    [canSubmit, onSubmit]
  );

  // Small wrappers to keep map render callbacks concise and to ensure
  // onChange calls use the latest data snapshot.
  const toggleDay = useCallback((day) => onChange({ ...data, daysOff: toggle(data.daysOff, day) }), [data, onChange]);
  const toggleBlock = useCallback((blockId) => onChange({ ...data, timeBlocks: toggle(data.timeBlocks, blockId) }), [data, onChange]);

  return (
    <form className="mx-auto flex w-full max-w-[640px] flex-col gap-7" onSubmit={handleSubmit}>
      <div className="space-y-3">
        <Eyebrow>Step 02</Eyebrow>
        <h1 className="m-0 text-display font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Now, block off
          <br />
          your week.
        </h1>
        <p className="-mt-1 mb-0 max-w-[38ch] text-base text-[#9aa8a2]">We'll only place classes inside the space you leave open.</p>
      </div>

      <div className="space-y-9 rounded-panel border border-white/10 bg-[#0d1b18]/70 p-5 sm:p-6">
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-4 block text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
            Days you want off
          </legend>
          <div className="flex flex-wrap gap-3.5">
            {DAYS.map((day) => (
              <button
                type="button"
                key={day}
                className={`rounded-full border px-5 py-3 text-base transition-all duration-200 ${
                  data.daysOff.includes(day)
                    ? "border-[#e87500]/40 bg-[#e87500]/10 text-[#f5d5b2] shadow-[0_0_0_1px_rgba(232,117,0,0.15)]"
                    : "border-white/10 bg-[#0c1715] text-[#f2f5f3] hover:border-white/20 hover:bg-white/5"
                }`}
                aria-pressed={data.daysOff.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-4 block text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
            Preferred time blocks
          </legend>
          <div className="flex flex-wrap gap-3.5">
            {TIME_BLOCKS.map((block) => (
              <button
                type="button"
                key={block.id}
                className={`rounded-full border px-5 py-3 text-base transition-all duration-200 ${
                  data.timeBlocks.includes(block.id)
                    ? "border-[#5fe0b7]/40 bg-[#5fe0b7]/10 text-[#dffcf5] shadow-[0_0_0_1px_rgba(95,224,183,0.15)]"
                    : "border-white/10 bg-[#0c1715] text-[#f2f5f3] hover:border-white/20 hover:bg-white/5"
                }`}
                aria-pressed={data.timeBlocks.includes(block.id)}
                onClick={() => toggleBlock(block.id)}
              >
                {block.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
              Minimum GPA
            </span>
            <Input
              type="number"
              min="0"
              max="4.0"
              step="0.1"
              className="w-full border-white/10 bg-[#081712] px-4 py-3.5 text-md text-[#f2f5f3]"
              placeholder="e.g. 3.2 (out of 4.0)"
              value={data.minGpa}
              onChange={(e) => onChange({ ...data, minGpa: e.target.value === "" ? "" : Number(e.target.value) })}
            />
            <p className="m-0 text-sm leading-snug text-[#9aa8a2]">
              The average GPA students have earned in a course, on UTD's 0–4.0 scale. Sections taught by a professor whose average
              falls below this number are excluded. Leave blank to skip this filter.
            </p>
          </label>

          <label className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
              Minimum RateMyProfessors rating
            </span>
            <Input
              type="number"
              min="0"
              max="5.0"
              step="0.1"
              className="w-full border-white/10 bg-[#081712] px-4 py-3.5 text-md text-[#f2f5f3]"
              placeholder="e.g. 3.5 (out of 5.0)"
              value={data.minRmp}
              onChange={(e) => onChange({ ...data, minRmp: e.target.value === "" ? "" : Number(e.target.value) })}
            />
            <p className="m-0 text-sm leading-snug text-[#9aa8a2]">
              A professor's overall quality rating on RateMyProfessors, on a 0–5.0 scale. Sections taught by a professor rated below
              this number are excluded. Leave blank to skip this filter.
            </p>
          </label>
        </div>

        <fieldset className="m-0 border-0 p-0">
          <label className="inline-flex items-center gap-2.5 text-base text-[#f2f5f3]">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-[#5fe0b7]"
              checked={data.wantsLunch}
              onChange={(e) => onChange({ ...data, wantsLunch: e.target.checked })}
            />
            <span>Keep a lunch period free</span>
          </label>

          {data.wantsLunch && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#081712]/80 p-3">
              <Input
                type="time"
                className="w-[clamp(90px,30vw,120px)] border-white/10 bg-[#081712] px-2.5 py-2 text-base text-[#f2f5f3]"
                value={data.lunchStart}
                onChange={(e) => onChange({ ...data, lunchStart: e.target.value })}
              />
              <span className="text-[#8a8d8f]">–</span>
              <Input
                type="time"
                className="w-[clamp(90px,30vw,120px)] border-white/10 bg-[#081712] px-2.5 py-2 text-base text-[#f2f5f3]"
                value={data.lunchEnd}
                onChange={(e) => onChange({ ...data, lunchEnd: e.target.value })}
              />
            </div>
          )}
        </fieldset>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
              Target course hours / week
            </span>
            <Input
              type="number"
              min="1"
              max="40"
              className="w-full border-white/10 bg-[#081712] px-4 py-3.5 text-md text-[#f2f5f3]"
              placeholder="e.g. 15"
              value={data.targetHours}
              onChange={(e) => onChange({ ...data, targetHours: e.target.value })}
              required
            />
          </label>

          <label className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#b0b8b5]" style={{ fontFamily: "var(--font-mono)" }}>
              Max hours / day
            </span>
            <Input
              type="number"
              min="1"
              max="12"
              className="w-full border-white/10 bg-[#081712] px-4 py-3.5 text-md text-[#f2f5f3] disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="e.g. 6"
              disabled={data.unlimitedDailyHours}
              value={data.maxHoursPerDay}
              onChange={(e) => onChange({ ...data, maxHoursPerDay: e.target.value })}
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2.5 text-base text-[#f2f5f3]">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-[#5fe0b7]"
            checked={data.unlimitedDailyHours}
            onChange={(e) => onChange({ ...data, unlimitedDailyHours: e.target.checked, maxHoursPerDay: "" })}
          />
          <span>No daily limit</span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <Button
          type="button"
          variant="outline"
          className="rounded-full border border-white/10 bg-transparent px-6 py-3 text-base text-[#f2f5f3] transition-colors hover:border-white/20 hover:bg-white/5"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="submit"
          size="lg"
          className="rounded-full border border-transparent bg-[#e87500] px-8 py-4 text-md font-semibold text-[#081712] shadow-[0_12px_30px_rgba(232,117,0,0.28)] transition-all duration-150 enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_18px_38px_rgba(232,117,0,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canSubmit}
        >
          Continue
        </Button>
      </div>
    </form>
  );
}
