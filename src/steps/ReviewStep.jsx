import { useEffect, useMemo, useState } from "react";
import { catalogBaseUrl, resolveMajorKey, undergradDegreeTypes, slugify, buildOpenGroupCourseOptions, buildMajorElectiveOptions } from "../lib/catalog";
import { loadCoreCurriculum, coreCurriculumUrl } from "../lib/parseTranscript";
import { loadClasses, recommend, prereqSatisfied } from "../lib/recommendCourses";
import Skeleton from "../components/Skeleton";

export default function ReviewStep({ profile, constraints, academicHistory, onEdit, onContinue }) {
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

  const openGroupOptions = useMemo(() => {
    if (!catalog) return {};
    return {
      ...buildMajorElectiveOptions(catalog),
      ...(coreCurriculum ? buildOpenGroupCourseOptions(catalog, coreCurriculum) : {}),
    };
  }, [catalog, coreCurriculum]);

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

  // Elective slots that resolved a course pool (Major Technical
  // Electives, Core Curriculum categories, etc.) default to a dropdown
  // of matching courses, but the pool is a best-effort guess (see
  // buildMajorElectiveOptions) — not every valid course is guaranteed to
  // be in it. This tracks which groups the user has switched to manual
  // free-text entry for, keyed by groupKey.
  const [manualElectiveEntry, setManualElectiveEntry] = useState({});

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
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
          Recommended courses
        </p>
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Couldn't load your requirements
        </h1>
        <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">{loadError}</p>
        <button type="button" className="mt-1 inline-flex w-fit items-center justify-center rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onEdit}>
          Back to academic history
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
        <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
          Recommended courses
        </p>
        <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
          Building your next term…
        </h1>
        <div className="flex flex-col gap-3.5">
          {[0, 1, 2].map((i) => (
            <div className="flex flex-col gap-2 rounded-xl border border-[#1f5c43] bg-[#154734] p-4" key={i}>
              <Skeleton width="40%" height="0.75rem" />
              <Skeleton width="90%" height="2.25rem" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { slotPicks, electivePicks, totalHours, shortfallHours, remainingSlots, remainingElectiveGroups } = result;

  // Screen 5's input: every course code currently shown above, overrides
  // included — exactly what's on screen when the user continues.
  const finalCourseCodes = [
    ...slotPicks.flatMap((slot) => codesForSlot(slot)),
    ...electivePicks.map((group) => overrides[group.groupKey]).filter(Boolean),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-7">
      <p className="m-0 text-[0.8rem] font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
        Recommended for next term
      </p>
      <h1 className="m-0 text-[clamp(2.5rem,5.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.02em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
        Here's what we'd
        <br />
        take next.
      </h1>
      <p className="-mt-2 mb-0 max-w-[40ch] text-[#8a8d8f]">
        Prioritized by lower-level courses and satisfied prerequisites, aimed at your{" "}
        {constraints.targetHours || 15}-hour target ({totalHours} SCH picked). Swap or add anything below.
      </p>
      {shortfallHours > 0 && (
        <p className="rounded-lg border border-[#1f5c43] bg-[#154734]/80 px-4 py-3 text-[0.95rem] text-[#f2f5f3]">
          Can't quite reach {constraints.targetHours || 15} hours right now — only about {totalHours - shortfallHours} SCH
          of this is currently eligible (the rest is likely blocked on prerequisites you haven't finished yet).
        </p>
      )}

      <div className="flex flex-col gap-3.5">
        {slotPicks.map((slot) => {
          const codes = codesForSlot(slot);
          const filledHours = codes.reduce((sum, code) => sum + courseFromPool(slot, code).hours, 0);
          const canAddMore = codes.length < slot.options.length;
          return (
            <div className="flex flex-col gap-2 rounded-xl border border-[#1f5c43] bg-[#154734] p-4" key={slot.groupKey}>
              <span className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[#5fe0b7]" style={{ fontFamily: "var(--font-mono)" }}>
                {slot.label} · {filledHours} SCH
              </span>
              {codes.map((code, i) => {
                const course = courseFromPool(slot, code);
                const ok = prereqStatus(code);
                const otherCodes = codes.filter((_, j) => j !== i);
                return (
                  <div className="flex flex-wrap items-center gap-2.5" key={i}>
                    <select
                      className="min-w-0 flex-1 rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[1rem] text-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
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
                    <span className="text-[0.8rem] text-[#8a8d8f]" style={{ fontFamily: "var(--font-mono)" }}>{course.hours} SCH</span>
                    {codes.length > 1 && (
                      <button
                        type="button"
                        className="h-8 w-8 rounded-md border border-[#1f5c43] bg-transparent text-[1.1rem] leading-none text-[#8a8d8f] transition-colors hover:text-[#f2f5f3]"
                        onClick={() => removeSlotPick(slot, i)}
                        aria-label="Remove this class"
                      >
                        ×
                      </button>
                    )}
                    {!ok && (
                      <p className="mt-1 basis-full text-[0.85rem] text-[#e87500]">
                        Prerequisite not yet satisfied{course.prereqText ? `: ${course.prereqText}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
              {canAddMore && (
                <button type="button" className="self-start bg-transparent p-0 text-[0.85rem] text-[#5fe0b7] hover:underline" onClick={() => addSlotPick(slot)}>
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
          const isManual = !options || manualElectiveEntry[group.groupKey];
          return (
            <div className="flex flex-col gap-2 rounded-xl border border-[#1f5c43] bg-[#154734] p-4" key={group.groupKey}>
              <span className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[#5fe0b7]" style={{ fontFamily: "var(--font-mono)" }}>
                {group.sectionTitle === "Core Curriculum Requirements" ? "Core elective" : "Elective"} · {group.label}
              </span>
              {isManual ? (
                <input
                  className="rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[1rem] text-[#f2f5f3] placeholder:text-[#8a8d8f] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
                  type="text"
                  placeholder="Course code (e.g. CS 4485)"
                  value={selectedCode}
                  onChange={(e) =>
                    setOverrides((prev) => ({ ...prev, [group.groupKey]: e.target.value.toUpperCase() }))
                  }
                />
              ) : (
                <select
                  className="rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[1rem] text-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
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
              )}
              {options && (
                <button
                  type="button"
                  className="self-start bg-transparent p-0 text-[0.85rem] text-[#5fe0b7] hover:underline"
                  onClick={() =>
                    setManualElectiveEntry((prev) => ({ ...prev, [group.groupKey]: !isManual }))
                  }
                >
                  {isManual ? "Choose from list instead" : "+ Enter a course manually"}
                </button>
              )}
              {!ok && <p className="text-[0.85rem] text-[#e87500]">Prerequisite not yet satisfied for {selectedCode}.</p>}
            </div>
          );
        })}
      </div>

      {(remainingSlots.length > slotPicks.length || remainingElectiveGroups.length > electivePicks.length) && (
        <details className="text-[0.9rem] text-[#8a8d8f]">
          <summary className="cursor-pointer text-[#f2f5f3]">Everything else still left ({remainingSlots.length + remainingElectiveGroups.length} areas)</summary>
          <ul className="mt-2 ml-5 list-disc space-y-1">
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

      <div className="mt-1 flex flex-wrap gap-3">
        <button type="button" className="rounded-full border border-[#1f5c43] bg-transparent px-8 py-4 text-[1.05rem] text-[#f2f5f3] transition-colors duration-200 hover:border-[#8a8d8f]" onClick={onEdit}>
          Edit academic history
        </button>
        <button
          type="button"
          className="rounded-full border border-transparent bg-[#e87500] px-8 py-4 text-[1.05rem] font-medium text-[#f2f5f3] transition-transform duration-150 enabled:hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!finalCourseCodes.length}
          onClick={() => onContinue(finalCourseCodes)}
        >
          Build my schedule
        </button>
      </div>
    </div>
  );
}
