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
    <form className="step-panel" onSubmit={handleSubmit}>
      <p className="step-panel__eyebrow">Step 01</p>
      <h1 className="step-panel__title">
        First, tell us who
        <br />
        we're planning for.
      </h1>
      <p className="step-panel__hint">Your major and year decide which requirements we check against.</p>

      <label className="field field--autocomplete">
        <span className="field__label">Major</span>
        <input
          type="text"
          className="field__input"
          placeholder="e.g. Computer Science"
          value={data.major}
          onChange={(e) => handleMajorChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          // A small timeout is kept to allow click/mouseDown on options before
          // the blur event hides the list. This matches the previous UX but
          // keeps the behavior localized here.
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={handleMajorKeyDown}
          autoComplete="off"
          required
        />

        {showSuggestions && suggestions.length > 0 && (
          <ul className="autocomplete-list">
            {suggestions.map((name) => (
              <li key={name}>
                {/* Use onMouseDown so the click is registered before the input loses focus. */}
                <button type="button" className="autocomplete-option" onMouseDown={() => selectMajor(name)}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>

      <fieldset className="field">
        <legend className="field__label">Start year</legend>
        <div className="pill-group">
          {YEARS.map((year) => (
            <button
              type="button"
              key={year}
              className={`pill ${data.year === year ? "pill--selected" : ""}`}
              onClick={() => onChange({ ...data, year })}
              aria-pressed={data.year === year}
            >
              {year}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">Are you an Honors student?</legend>
        <div className="pill-group">
          <button
            type="button"
            className={`pill ${data.isHonors ? "pill--selected" : ""}`}
            onClick={() => onChange({ ...data, isHonors: true })}
            aria-pressed={!!data.isHonors}
          >
            Yes
          </button>
          <button
            type="button"
            className={`pill ${!data.isHonors ? "pill--selected" : ""}`}
            onClick={() => onChange({ ...data, isHonors: false })}
            aria-pressed={!data.isHonors}
          >
            No
          </button>
        </div>
      </fieldset>

      <button type="submit" className="btn btn--primary" disabled={!canContinue}>
        Continue
      </button>
    </form>
  );
}
