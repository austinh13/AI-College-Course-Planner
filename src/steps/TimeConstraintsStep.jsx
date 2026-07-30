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
    <form className="step-panel" onSubmit={handleSubmit}>
      <p className="step-panel__eyebrow">Step 02</p>
      <h1 className="step-panel__title">
        Now, block off
        <br />
        your week.
      </h1>
      <p className="step-panel__hint">We'll only place classes inside the space you leave open.</p>

      <fieldset className="field">
        <legend className="field__label">Days you want off</legend>
        <div className="pill-group">
          {DAYS.map((day) => (
            <button
              type="button"
              key={day}
              className={`pill ${data.daysOff.includes(day) ? "pill--selected" : ""}`}
              aria-pressed={data.daysOff.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {day}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">Preferred time blocks</legend>
        <div className="pill-group">
          {TIME_BLOCKS.map((block) => (
            <button
              type="button"
              key={block.id}
              className={`pill ${data.timeBlocks.includes(block.id) ? "pill--selected" : ""}`}
              aria-pressed={data.timeBlocks.includes(block.id)}
              onClick={() => toggleBlock(block.id)}
            >
              {block.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field field--row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={data.wantsLunch}
            onChange={(e) => onChange({ ...data, wantsLunch: e.target.checked })}
          />
          <span>Keep a lunch period free</span>
        </label>

        {data.wantsLunch && (
          <div className="time-range">
            <input
              type="time"
              className="field__input field__input--compact"
              value={data.lunchStart}
              onChange={(e) => onChange({ ...data, lunchStart: e.target.value })}
            />
            <span className="time-range__sep">–</span>
            <input
              type="time"
              className="field__input field__input--compact"
              value={data.lunchEnd}
              onChange={(e) => onChange({ ...data, lunchEnd: e.target.value })}
            />
          </div>
        )}
      </fieldset>

      <div className="field-grid">
        <label className="field">
          <span className="field__label">Target course hours / week</span>
          <input
            type="number"
            min="1"
            max="40"
            className="field__input"
            placeholder="e.g. 15"
            value={data.targetHours}
            onChange={(e) => onChange({ ...data, targetHours: e.target.value })}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Max hours / day</span>
          <input
            type="number"
            min="1"
            max="12"
            className="field__input"
            placeholder="e.g. 6"
            disabled={data.unlimitedDailyHours}
            value={data.maxHoursPerDay}
            onChange={(e) => onChange({ ...data, maxHoursPerDay: e.target.value })}
          />
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={data.unlimitedDailyHours}
          onChange={(e) => onChange({ ...data, unlimitedDailyHours: e.target.checked, maxHoursPerDay: "" })}
        />
        <span>No daily limit</span>
      </label>

      <div className="step-panel__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          Continue
        </button>
      </div>
    </form>
  );
}
