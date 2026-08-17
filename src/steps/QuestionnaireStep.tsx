import React, { useMemo, useState, useCallback } from "react";
import { Badge } from "../components/lightswind/badge";
import { Button } from "../components/lightswind/button";
import { Input } from "../components/lightswind/input";
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
      <div className="space-y-3">
        <Badge variant="warning" className="inline-flex w-fit border border-[#e87500]/30 bg-[#e87500]/10 px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#f5d5b2]" style={{ fontFamily: "var(--font-mono)" }}>
          Step 01
        </Badge>
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          First, tell us who
          <br />
          we're planning for.
        </h1>
        <p className="-mt-1 mb-0 max-w-[38ch] text-[0.98rem] text-[#9aa8a2]">Your major and year decide which requirements we check against.</p>
      </div>

      <div className="space-y-5 rounded-[24px] border border-white/10 bg-[#0d1b18]/70 p-4 sm:p-5">
        <label className="relative flex flex-col gap-2.5">
          <span className="text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
            Major
          </span>
          <Input
            type="text"
            className="bg-[#081712] px-4 py-3.5 text-[1.05rem] text-[#f2f5f3] placeholder:text-[#7e8b86]"
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
            <ul className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 m-0 max-h-[220px] list-none overflow-y-auto rounded-2xl border border-white/10 bg-[#0e1d1a] p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
              {suggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="block w-full rounded-xl bg-transparent px-3 py-2 text-left text-[0.95rem] text-[#f2f5f3] transition-colors duration-150 hover:bg-[#1f5c43] hover:text-[#f2f5f3] focus:bg-[#1f5c43] focus:text-[#f2f5f3] focus:outline-none"
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
          <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
            Start year
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {YEARS.map((year) => (
              <button
                type="button"
                key={year}
                className={`rounded-full border px-4 py-2.5 text-base transition-all duration-200 ${
                  data.year === year
                    ? "border-[#5fe0b7]/40 bg-[#5fe0b7]/10 text-[#5fe0b7] shadow-[0_0_0_1px_rgba(95,224,183,0.15)]"
                    : "border-white/10 bg-[#0c1715] text-[#e6efeb] hover:border-white/20 hover:bg-white/5"
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
          <legend className="mb-2.5 block text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>
            Honors student?
          </legend>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className={`rounded-full border px-4 py-2.5 text-base transition-all duration-200 ${
                data.isHonors
                  ? "border-[#e87500]/40 bg-[#e87500]/10 text-[#f5d5b2] shadow-[0_0_0_1px_rgba(232,117,0,0.15)]"
                  : "border-white/10 bg-[#0c1715] text-[#e6efeb] hover:border-white/20 hover:bg-white/5"
              }`}
              onClick={() => onChange({ ...data, isHonors: true })}
              aria-pressed={!!data.isHonors}
            >
              Yes
            </button>
            <button
              type="button"
              className={`rounded-full border px-4 py-2.5 text-base transition-all duration-200 ${
                !data.isHonors
                  ? "border-[#5fe0b7]/40 bg-[#5fe0b7]/10 text-[#5fe0b7] shadow-[0_0_0_1px_rgba(95,224,183,0.15)]"
                  : "border-white/10 bg-[#0c1715] text-[#e6efeb] hover:border-white/20 hover:bg-white/5"
              }`}
              onClick={() => onChange({ ...data, isHonors: false })}
              aria-pressed={!data.isHonors}
            >
              No
            </button>
          </div>
        </fieldset>
      </div>

      <Button
        type="submit"
        size="lg"
        className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-transparent bg-[#e87500] px-8 py-4 text-[1.05rem] font-medium text-[#f2f5f3] shadow-[0_12px_30px_rgba(232,117,0,0.28)] transition-all duration-150 enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_18px_38px_rgba(232,117,0,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canContinue}
      >
        Continue
      </Button>
    </form>
  );
}
