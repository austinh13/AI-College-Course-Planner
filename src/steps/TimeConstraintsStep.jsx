import React, { useMemo, useCallback } from "react";

// Days and labeled time blocks for the UI. Kept as constants to avoid
// recreating these arrays on every render.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME_BLOCKS = [
  { id: "early", label: "Early (8–10am)" },
  { id: "morning", label: "Morning (10am–12pm)" },
  { id: "afternoon", label: "Afternoon (12–4pm)" },
  { id: "evening", label: "Evening (4pm+)" },
];

const IMPORTANCE_LEVELS = [
  { id: 1, label: "1 · None" },
  { id: 2, label: "2 · Somewhat" },
  { id: 3, label: "3 · Very important" },
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
      <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
        Step 02
      </p>
      <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
        Now, block off
        <br />
        your week.
      </h1>
      <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">We'll only place classes inside the space you leave open.</p>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          Days you want off
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {DAYS.map((day) => (
            <button
              type="button"
              key={day}
              className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
                data.daysOff.includes(day) ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
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
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          Preferred time blocks
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TIME_BLOCKS.map((block) => (
            <button
              type="button"
              key={block.id}
              className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
                data.timeBlocks.includes(block.id) ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
              }`}
              aria-pressed={data.timeBlocks.includes(block.id)}
              onClick={() => toggleBlock(block.id)}
            >
              {block.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          How much do past grades matter when picking a professor?
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {IMPORTANCE_LEVELS.map((level) => (
            <button
              type="button"
              key={level.id}
              className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
                data.gradeImportance === level.id ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
              }`}
              aria-pressed={data.gradeImportance === level.id}
              onClick={() => onChange({ ...data, gradeImportance: level.id })}
            >
              {level.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          How much do RateMyProfessors ratings matter?
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {IMPORTANCE_LEVELS.map((level) => (
            <button
              type="button"
              key={level.id}
              className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
                data.rmpImportance === level.id ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
              }`}
              aria-pressed={data.rmpImportance === level.id}
              onClick={() => onChange({ ...data, rmpImportance: level.id })}
            >
              {level.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <label className="inline-flex items-center gap-2.5 text-[0.95rem] text-[#f2f5f3]">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-[#5fe0b7]"
            checked={data.wantsLunch}
            onChange={(e) => onChange({ ...data, wantsLunch: e.target.checked })}
          />
          <span>Keep a lunch period free</span>
        </label>

        {data.wantsLunch && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="time"
              className="w-[clamp(90px,30vw,120px)] rounded-lg border border-[#8a8d8f] bg-[#154734] px-2.5 py-2 text-[1rem] text-[#f2f5f3] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
              value={data.lunchStart}
              onChange={(e) => onChange({ ...data, lunchStart: e.target.value })}
            />
            <span className="text-[#8a8d8f]">–</span>
            <input
              type="time"
              className="w-[clamp(90px,30vw,120px)] rounded-lg border border-[#8a8d8f] bg-[#154734] px-2.5 py-2 text-[1rem] text-[#f2f5f3] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
              value={data.lunchEnd}
              onChange={(e) => onChange({ ...data, lunchEnd: e.target.value })}
            />
          </div>
        )}
      </fieldset>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="flex flex-col gap-2.5">
          <span className="text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
            Target course hours / week
          </span>
          <input
            type="number"
            min="1"
            max="40"
            className="w-full rounded-lg border border-[#8a8d8f] bg-[#154734] px-4 py-3.5 text-[1.05rem] text-[#f2f5f3] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] transition-colors duration-200 placeholder:text-[#8a8d8f] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
            placeholder="e.g. 15"
            value={data.targetHours}
            onChange={(e) => onChange({ ...data, targetHours: e.target.value })}
            required
          />
        </label>

        <label className="flex flex-col gap-2.5">
          <span className="text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
            Max hours / day
          </span>
          <input
            type="number"
            min="1"
            max="12"
            className="w-full rounded-lg border border-[#8a8d8f] bg-[#154734] px-4 py-3.5 text-[1.05rem] text-[#f2f5f3] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] transition-colors duration-200 placeholder:text-[#8a8d8f] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7] disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="e.g. 6"
            disabled={data.unlimitedDailyHours}
            value={data.maxHoursPerDay}
            onChange={(e) => onChange({ ...data, maxHoursPerDay: e.target.value })}
          />
        </label>
      </div>

      <label className="inline-flex items-center gap-2.5 text-[0.95rem] text-[#f2f5f3]">
        <input
          type="checkbox"
          className="h-[18px] w-[18px] accent-[#5fe0b7]"
          checked={data.unlimitedDailyHours}
          onChange={(e) => onChange({ ...data, unlimitedDailyHours: e.target.checked, maxHoursPerDay: "" })}
        />
        <span>No daily limit</span>
      </label>

      <div className="mt-1 flex gap-3">
        <button type="button" className="rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="rounded-full border border-transparent bg-[#e87500] px-8 py-4 text-[1.05rem] font-medium text-[#f2f5f3] transition-transform duration-150 enabled:hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40" disabled={!canSubmit}>
          Continue
        </button>
      </div>
    </form>
  );
}
