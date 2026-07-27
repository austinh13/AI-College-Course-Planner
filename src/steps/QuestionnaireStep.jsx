import { useMemo, useState } from "react";
import utdDegrees from "../data/utd_degrees.json";

const majors = Object.keys(utdDegrees).sort();
const YEARS = ["2022", "2023", "2024", "2025", "2026"];
const MAX_SUGGESTIONS = 8;

export default function QuestionnaireStep({ data, onChange, onNext }) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const canContinue = data.major.trim().length > 0 && data.year !== "";

  const suggestions = useMemo(() => {
    const query = data.major.trim().toLowerCase();
    if (!query) return [];
    return majors.filter((m) => m.toLowerCase().includes(query)).slice(0, MAX_SUGGESTIONS);
  }, [data.major]);

  function selectMajor(name) {
    onChange({ ...data, major: name });
    setShowSuggestions(false);
  }

  function handleMajorKeyDown(e) {
    if (e.key === "Enter" && showSuggestions && suggestions.length > 0) {
      // Without this, Enter would submit the form instead of picking
      // the top suggestion while the dropdown is open.
      e.preventDefault();
      selectMajor(suggestions[0]);
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (canContinue) onNext();
  }

  return (
    <form className="step-panel" onSubmit={handleSubmit}>
      <p className="step-panel__eyebrow">Step 01</p>
      <h1 className="step-panel__title">
        First, tell us who
        <br />
        we're planning for.
      </h1>
      <p className="step-panel__hint">
        Your major and year decide which requirements we check against.
      </p>

      <label className="field field--autocomplete">
        <span className="field__label">Major</span>
        <input
          type="text"
          className="field__input"
          placeholder="e.g. Computer Science"
          value={data.major}
          onChange={(e) => {
            onChange({ ...data, major: e.target.value });
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={handleMajorKeyDown}
          autoComplete="off"
          required
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="autocomplete-list">
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="autocomplete-option"
                  onMouseDown={() => selectMajor(name)}
                >
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

      <button type="submit" className="btn btn--primary" disabled={!canContinue}>
        Continue
      </button>
    </form>
  );
}
