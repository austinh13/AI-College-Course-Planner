export default function ReviewStep({ profile, constraints, onEdit }) {
  return (
    <div className="step-panel">
      <p className="step-panel__eyebrow">Captured</p>
      <h1 className="step-panel__title">
        Locked in. Here's what
        <br />
        we'll build around.
      </h1>

      <dl className="summary">
        <div className="summary__row">
          <dt>Major</dt>
          <dd>{profile.major}</dd>
        </div>
        <div className="summary__row">
          <dt>Year</dt>
          <dd>{profile.year}</dd>
        </div>
        <div className="summary__row">
          <dt>Days off</dt>
          <dd>{constraints.daysOff.length ? constraints.daysOff.join(", ") : "None"}</dd>
        </div>
        <div className="summary__row">
          <dt>Preferred blocks</dt>
          <dd>{constraints.timeBlocks.length ? constraints.timeBlocks.join(", ") : "Any"}</dd>
        </div>
        <div className="summary__row">
          <dt>Lunch</dt>
          <dd>
            {constraints.wantsLunch
              ? `${constraints.lunchStart || "?"} – ${constraints.lunchEnd || "?"}`
              : "Not reserved"}
          </dd>
        </div>
        <div className="summary__row">
          <dt>Target hours</dt>
          <dd>{constraints.targetHours}/week</dd>
        </div>
        <div className="summary__row">
          <dt>Daily max</dt>
          <dd>{constraints.unlimitedDailyHours ? "No limit" : `${constraints.maxHoursPerDay} hrs`}</dd>
        </div>
      </dl>

      <p className="step-panel__hint">
        Schedule generation runs on the backend — this screen is the handoff
        point once that endpoint is live.
      </p>

      <button type="button" className="btn btn--ghost" onClick={onEdit}>
        Edit answers
      </button>
    </div>
  );
}
