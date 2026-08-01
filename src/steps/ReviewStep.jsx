import { useEffect, useMemo, useState } from "react";
import { catalogBaseUrl, resolveMajorKey, undergradDegreeTypes, slugify, buildOpenGroupCourseOptions } from "../lib/catalog";
import { loadCoreCurriculum, coreCurriculumUrl } from "../lib/parseTranscript";
import { loadClasses, recommend, prereqSatisfied } from "../lib/recommendCourses";
import "./ReviewStep.css";

export default function ReviewStep({ profile, constraints, academicHistory, onEdit }) {
  const { major, year: startYear } = profile;
  const { completed, manualEntries } = academicHistory;
  // academicHistory.degreeType is set once Screen 3 has resolved it; if a
  // major only has a single BA/BS option that's determined without ever
  // needing user input, so fall back to computing it the same way Screen
  // 3 does rather than getting stuck if it's missing for any reason.
  const degreeTypes = undergradDegreeTypes(major);
  const degreeType = academicHistory.degreeType || (degreeTypes.length === 1 ? degreeTypes[0] : null);

  const [catalog, setCatalog] = useState(null);
  const [coreCurriculum, setCoreCurriculum] = useState(null);
  const [classesMap, setClassesMap] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    console.log("[ReviewStep] major:", major, "startYear:", startYear, "degreeTypes:", degreeTypes, "resolved degreeType:", degreeType);
  }, [major, startYear, degreeType]);

  // Same slug-resolution as Screen 3's catalog fetch (lib/catalog.js) —
  // reusing it here avoids re-introducing the slug-mismatch bug that
  // came from two places computing a major's file name differently.
  useEffect(() => {
    if (!major || !startYear) return;
    if (!degreeType) {
      console.warn("[ReviewStep] no degreeType resolved — catalog fetch skipped");
      setLoadError(
        `Couldn't determine your degree type for "${major}". Go back to academic history and re-select it.`
      );
      return;
    }
    let cancelled = false;
    setCatalog(null);
    setLoadError(null);

    const canonicalMajor = resolveMajorKey(major);
    const slug = slugify(`${canonicalMajor} (${degreeType})`);
    const url = `${catalogBaseUrl(startYear)}/${slug}.json`;
    console.log("[ReviewStep] fetching catalog:", url);
    fetch(url)
      .then((res) => {
        console.log("[ReviewStep] catalog response:", res.status, url);
        if (!res.ok) throw new Error(`Couldn't reload ${startYear} requirements for "${major} (${degreeType})".`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          console.log("[ReviewStep] catalog loaded, sections:", data?.sections?.length);
          setCatalog(data);
        }
      })
      .catch((err) => {
        console.error("[ReviewStep] catalog fetch failed:", err);
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [major, startYear, degreeType]);

  useEffect(() => {
    if (!startYear) return;
    let cancelled = false;
    loadCoreCurriculum(coreCurriculumUrl(startYear))
      .then((data) => {
        if (!cancelled) setCoreCurriculum(data);
      })
      .catch((err) => {
        console.warn("[ReviewStep] couldn't load core curriculum — elective dropdowns fall back to free text:", err);
        // Best-effort — open elective slots just fall back to free text.
      });
    return () => {
      cancelled = true;
    };
  }, [startYear]);

  useEffect(() => {
    let cancelled = false;
    loadClasses()
      .then((data) => {
        console.log("[ReviewStep] classes.json loaded, course count:", Object.keys(data).length);
        if (!cancelled) setClassesMap(data);
      })
      .catch((err) => {
        console.warn("Couldn't load classes.json — prerequisites won't be checked:", err);
        if (!cancelled) setClassesMap({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openGroupOptions = useMemo(
    () => (catalog && coreCurriculum ? buildOpenGroupCourseOptions(catalog, coreCurriculum) : {}),
    [catalog, coreCurriculum]
  );

  const result = useMemo(() => {
    if (!catalog || !classesMap) {
      console.log("[ReviewStep] waiting on:", !catalog ? "catalog" : "", !classesMap ? "classesMap" : "");
      return null;
    }
    const r = recommend({ catalog, completed, manualEntries, classesMap, targetHours: constraints.targetHours });
    console.log("[ReviewStep] recommend() result:", r);
    return r;
  }, [catalog, classesMap, completed, manualEntries, constraints.targetHours]);

  // User overrides keyed by groupKey. Slot overrides store an array of
  // course codes (a slot can hold more than one pick — e.g. Component
  // Area Option needing several courses to reach its own SCH target);
  // elective overrides store a single code chosen from the matching
  // Core Curriculum category, or free text if none exists.
  const [overrides, setOverrides] = useState({});

  const prereqStatus = (code) => prereqSatisfied(classesMap?.[code]?.prereq, completed);

  const codesForSlot = (slot) => overrides[slot.groupKey] || slot.picks.map((p) => p.code);
  const courseFromPool = (slot, code) => slot.options.find((o) => o.code === code) || { code, name: code, hours: 3, prereqText: "" };

  function updateSlotPick(slot, index, newCode) {
    const codes = [...codesForSlot(slot)];
    codes[index] = newCode;
    setOverrides((prev) => ({ ...prev, [slot.groupKey]: codes }));
  }

  function addSlotPick(slot) {
    const codes = codesForSlot(slot);
    const next = slot.options.find((o) => !codes.includes(o.code));
    if (!next) return;
    setOverrides((prev) => ({ ...prev, [slot.groupKey]: [...codes, next.code] }));
  }

  function removeSlotPick(slot, index) {
    setOverrides((prev) => ({ ...prev, [slot.groupKey]: codesForSlot(slot).filter((_, i) => i !== index) }));
  }

  if (loadError) {
    return (
      <div className="step-panel">
        <p className="step-panel__eyebrow">Recommended courses</p>
        <h1 className="step-panel__title">Couldn't load your requirements</h1>
        <p className="step-panel__hint">{loadError}</p>
        <button type="button" className="btn btn--ghost" onClick={onEdit}>
          Back to academic history
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="step-panel">
        <p className="step-panel__eyebrow">Recommended courses</p>
        <h1 className="step-panel__title">Building your next term…</h1>
      </div>
    );
  }

  const { slotPicks, electivePicks, totalHours, shortfallHours, remainingSlots, remainingElectiveGroups } = result;

  return (
    <div className="step-panel s4-panel">
      <p className="step-panel__eyebrow">Recommended for next term</p>
      <h1 className="step-panel__title">
        Here's what we'd
        <br />
        take next.
      </h1>
      <p className="step-panel__hint">
        Prioritized by lower-level courses and satisfied prerequisites, aimed at your{" "}
        {constraints.targetHours || 15}-hour target ({totalHours} SCH picked). Swap or add anything below.
      </p>
      {shortfallHours > 0 && (
        <p className="s4-shortfall">
          Can't quite reach {constraints.targetHours || 15} hours right now — only about {totalHours - shortfallHours} SCH
          of this is currently eligible (the rest is likely blocked on prerequisites you haven't finished yet).
        </p>
      )}

      <div className="s4-cards">
        {slotPicks.map((slot) => {
          const codes = codesForSlot(slot);
          const filledHours = codes.reduce((sum, code) => sum + courseFromPool(slot, code).hours, 0);
          const canAddMore = codes.length < slot.options.length;
          return (
            <div className="s4-card" key={slot.groupKey}>
              <span className="s4-card__tag">
                {slot.label} · {filledHours} SCH
              </span>
              {codes.map((code, i) => {
                const course = courseFromPool(slot, code);
                const ok = prereqStatus(code);
                const otherCodes = codes.filter((_, j) => j !== i);
                return (
                  <div className="s4-card__row" key={i}>
                    <select
                      className="s4-card__select"
                      value={code}
                      onChange={(e) => updateSlotPick(slot, i, e.target.value)}
                    >
                      {slot.options
                        .filter((o) => o.code === code || !otherCodes.includes(o.code))
                        .map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.code} — {o.name}
                          </option>
                        ))}
                    </select>
                    <span className="s4-card__hours">{course.hours} SCH</span>
                    {codes.length > 1 && (
                      <button
                        type="button"
                        className="s4-card__remove"
                        onClick={() => removeSlotPick(slot, i)}
                        aria-label="Remove this class"
                      >
                        ×
                      </button>
                    )}
                    {!ok && (
                      <p className="s4-card__warning">
                        Prerequisite not yet satisfied{course.prereqText ? `: ${course.prereqText}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
              {canAddMore && (
                <button type="button" className="s4-card__add" onClick={() => addSlotPick(slot)}>
                  + Add another class
                </button>
              )}
            </div>
          );
        })}

        {electivePicks.map((group) => {
          const options = openGroupOptions[group.groupKey];
          const selectedCode = overrides[group.groupKey] || "";
          const ok = !selectedCode || prereqStatus(selectedCode);
          return (
            <div className="s4-card" key={group.groupKey}>
              <span className="s4-card__tag">Core elective · {group.label}</span>
              {options ? (
                <select
                  className="s4-card__select"
                  value={selectedCode}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [group.groupKey]: e.target.value }))}
                >
                  <option value="">Select a course…</option>
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.code} — {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="s4-card__input"
                  type="text"
                  placeholder="Course code (e.g. CS 4485)"
                  value={selectedCode}
                  onChange={(e) =>
                    setOverrides((prev) => ({ ...prev, [group.groupKey]: e.target.value.toUpperCase() }))
                  }
                />
              )}
              {!ok && <p className="s4-card__warning">Prerequisite not yet satisfied for {selectedCode}.</p>}
            </div>
          );
        })}
      </div>

      {(remainingSlots.length > slotPicks.length || remainingElectiveGroups.length > electivePicks.length) && (
        <details className="s4-remaining">
          <summary>Everything else still left ({remainingSlots.length + remainingElectiveGroups.length} areas)</summary>
          <ul>
            {remainingSlots.map((slot) => (
              <li key={slot.groupKey}>
                {slot.sectionTitle} · {slot.label} — needs {slot.remainingHours} SCH
              </li>
            ))}
            {remainingElectiveGroups.map((group) => (
              <li key={group.groupKey}>
                {group.sectionTitle} · {group.label} — needs {group.remainingHours} SCH
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="btn btn--ghost" onClick={onEdit}>
        Edit academic history
      </button>
    </div>
  );
}
