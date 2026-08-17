import React, { useMemo, useState, useCallback } from "react";
import utdDegrees from "../data/utd_degrees.json";

// List of majors (sorted) and a few constants used by the UI.
const majors = Object.keys(utdDegrees).sort();
const YEARS = ["2022", "2023", "2024", "2025", "2026"];
const MAX_SUGGESTIONS = 8;

// Precompute a lowercase version of every major at module initialization.
// This avoids calling toLowerCase repeatedly during filtering and reduces
// allocations while typing in the autocomplete input.
const MAJOR_PAIRS = majors.map((m) => ({ name: m, lower: m.toLowerCase() }));

export default function QuestionnaireStep({ data, onChange, onNext }) {
  // Local UI state for showing the autocomplete dropdown.
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Form is valid when a non-empty major is provided and a year is selected.
  const canContinue = data.major.trim().length > 0 && data.year !== "";

  // Compute a small list of suggestions matching the current query.
  // useMemo ensures we only recompute when the typed major changes.
  const suggestions = useMemo(() => {
    const query = data.major.trim().toLowerCase();
    if (!query) return [];
    // Use the precomputed lowercase values for efficient substring checks.
    return MAJOR_PAIRS.filter((p) => p.lower.includes(query)).slice(0, MAX_SUGGESTIONS).map((p) => p.name);
  }, [data.major]);

  // Memoized handlers keep stable references which is helpful if child
  // components use referential checks (and reduces re-renders in general).
  const selectMajor = useCallback(
    (name) => {
      // Propagate the selected major and close the suggestions list.
      onChange({ ...data, major: name });
      setShowSuggestions(false);
    },
    [data, onChange]
  );

  const handleMajorKeyDown = useCallback(
    (e) => {
      // If Enter is pressed while suggestions are visible, choose the first suggestion
      // instead of submitting the form. Escape hides the dropdown.
      if (e.key === "Enter" && showSuggestions && suggestions.length > 0) {
        e.preventDefault();
        selectMajor(suggestions[0]);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, selectMajor]
  );

  const handleMajorChange = useCallback(
    (value) => {
      // Update parent state with the typed value and show suggestions.
      onChange({ ...data, major: value });
      setShowSuggestions(true);
    },
    [data, onChange]
  );

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (canContinue) onNext();
    },
    [canContinue, onNext]
  );

  return (
    <form className="mx-auto flex w-full max-w-[640px] flex-col gap-7" onSubmit={handleSubmit}>
      <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
        Step 01
      </p>
      <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
        First, tell us who
        <br />
        we're planning for.
      </h1>
      <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">Your major and year decide which requirements we check against.</p>

      <label className="relative flex flex-col gap-2.5">
        <span className="text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          Major
        </span>
        <input
          type="text"
          className="w-full rounded-lg border border-[#8a8d8f] bg-[#154734] px-4 py-3.5 text-[1.05rem] text-[#f2f5f3] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] transition-colors duration-200 placeholder:text-[#8a8d8f] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7] focus:ring-offset-0"
          placeholder="e.g. Computer Science"
          value={data.major}
          onChange={(e) => handleMajorChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={handleMajorKeyDown}
          autoComplete="off"
          required
        />

        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 m-0 max-h-[220px] list-none overflow-y-auto rounded-lg border border-[#8a8d8f] bg-[#154734] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="block w-full rounded-md bg-transparent px-2.5 py-2 text-left text-[0.95rem] text-[#f2f5f3] transition-colors duration-150 hover:bg-[#1f5c43] hover:text-[#e87500] focus:bg-[#1f5c43] focus:text-[#e87500] focus:outline-none"
                  onMouseDown={() => selectMajor(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          Start year
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {YEARS.map((year) => (
            <button
              type="button"
              key={year}
              className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
                data.year === year ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
              }`}
              onClick={() => onChange({ ...data, year })}
              aria-pressed={data.year === year}
            >
              {year}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.06em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
          Are you an Honors student?
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <button
            type="button"
            className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
              data.isHonors ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
            }`}
            onClick={() => onChange({ ...data, isHonors: true })}
            aria-pressed={!!data.isHonors}
          >
            Yes
          </button>
          <button
            type="button"
            className={`border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base text-[#f2f5f3] transition-colors duration-200 ${
              !data.isHonors ? "border-[#e87500] font-semibold text-[#e87500]" : "border-[#1f5c43] hover:border-[#8a8d8f]"
            }`}
            onClick={() => onChange({ ...data, isHonors: false })}
            aria-pressed={!data.isHonors}
          >
            No
          </button>
        </div>
      </fieldset>

      <button
        type="submit"
        className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-transparent bg-[#e87500] px-8 py-4 text-[1.05rem] font-medium text-[#f2f5f3] transition-transform duration-150 enabled:hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canContinue}
      >
        Continue
      </button>
    </form>
  );
}
