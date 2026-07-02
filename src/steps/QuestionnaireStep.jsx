const YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "5th year+"];

export default function QuestionnaireStep({ data, onChange, onNext }) {
  const canContinue = data.major.trim().length > 0 && data.year !== "";

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

      <label className="field">
        <span className="field__label">Major</span>
        <input
          type="text"
          className="field__input"
          placeholder="e.g. Computer Science"
          value={data.major}
          onChange={(e) => onChange({ ...data, major: e.target.value })}
          required
        />
      </label>

      <fieldset className="field">
        <legend className="field__label">Year</legend>
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
