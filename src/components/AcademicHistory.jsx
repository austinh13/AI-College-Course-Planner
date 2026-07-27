import { useEffect, useMemo, useState } from "react";
import utdDegrees from "../data/utd_degrees.json";
import { extractCompletedCourses, loadCoreCurriculum, assignCoreCategories } from "../lib/parseTranscript";
import "./AcademicHistory.css";

function catalogBaseUrl(startYear) {
  return `/UTD_${startYear}/Major_Parsed_${startYear}`;
}

function coreCurriculumUrl(startYear) {
  return `/UTD_${startYear}/Core_${startYear}.json`;
}

const NORMALIZED_MAJOR_KEYS = Object.keys(utdDegrees).reduce((map, key) => {
  map[key.trim().toLowerCase().replace(/\s+/g, " ")] = key;
  return map;
}, {});

function resolveMajorKey(majorName) {
  if (!majorName) return null;
  return NORMALIZED_MAJOR_KEYS[majorName.trim().toLowerCase().replace(/\s+/g, " ")] || null;
}

function undergradDegreeTypes(majorName) {
  const key = resolveMajorKey(majorName);
  const entry = key ? utdDegrees[key] : null;
  if (!entry) return [];
  const types = new Set();
  entry.levels.forEach((lvl) => {
    const match = lvl.match(/^(BA|BS)/);
    if (match) types.add(match[1]);
  });
  return [...types];
}

function parseHours(value) {
  if (value == null) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function slugify(majorName) {
  return majorName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function optionSatisfied(option, completed) {
  if (!completed.has(option.code)) return false;
  return option.with.every((w) => completed.has(w.code));
}

function groupSatisfied(group, completed) {
  if (!group.courses.length) return false;
  const satisfiesSlot = (opt) =>
    optionSatisfied(opt, completed) ||
    opt.alternatives.some((alt) => optionSatisfied(alt, completed));
  return group.choice
    ? group.courses.some(satisfiesSlot)
    : group.courses.every(satisfiesSlot);
}

// UTD catalog numbers encode credit hours in the 2nd digit of the
// 4-digit number (ECS 1100 -> 1, MATH 2418 -> 4, PHYS 2125 -> 1,
// PHYS 2325 -> 3) — verified against every course in a real transcript.
// Falls back to 3 (the most common UTD course size) for anything that
// doesn't fit the pattern (shouldn't happen for real catalog codes).
function creditHoursFromCode(code) {
  const match = code.match(/(\d[\d-]{2,3})$/);
  const digit = match?.[1]?.[1];
  return digit && /\d/.test(digit) ? Number(digit) : 3;
}

// Partial credit for an explicit-course, choice:false group, weighted by
// each course's real SCH instead of treating every course slot equally.
// This is a ratio against the group's own total course-hours, not a raw
// sum capped at target — several Major Prep courses (RHET 1302,
// GOVT 2305, PHYS 2125/2325/2326) are *also* separately required by
// their own Core Curriculum groups, and this group's stated target
// already nets that overlap out. Summing real hours and capping at
// target would let a handful of high-hour courses satisfy the group
// while lower-hour ones are still missing; scaling proportionally keeps
// "every course checked" mapping to exactly `target`, same as before,
// while weighting partial progress correctly in between. Choice:true
// groups (pick-any-one pools) stay all-or-nothing via groupSatisfied,
// but in this catalog those already have credit_hours: null and are
// excluded from the hours math entirely, so this only actually applies
// to choice:false groups in practice.
function explicitGroupHoursEarned(group, completed, target) {
  if (group.choice) return groupSatisfied(group, completed) ? target : 0;
  const satisfiesSlot = (opt) =>
    optionSatisfied(opt, completed) || opt.alternatives.some((alt) => optionSatisfied(alt, completed));
  const courseHours = group.courses.map((opt) => creditHoursFromCode(opt.code));
  const totalWeight = courseHours.reduce((sum, h) => sum + h, 0) || group.courses.length;
  const satisfiedWeight = group.courses.reduce(
    (sum, opt, i) => sum + (satisfiesSlot(opt) ? courseHours[i] : 0),
    0
  );
  return Math.round((satisfiedWeight / totalWeight) * target);
}

function collectAllCodes(catalog) {
  const codes = new Set();
  catalog.sections.forEach((s) =>
    s.groups.forEach((g) =>
      g.courses.forEach((opt) => {
        codes.add(opt.code);
        opt.with.forEach((w) => codes.add(w.code));
        opt.alternatives.forEach((alt) => {
          codes.add(alt.code);
          alt.with.forEach((w) => codes.add(w.code));
        });
      })
    )
  );
  return codes;
}

function normalizeLabel(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

const TECH_ELECTIVE_SUBJECTS = new Set(["CS", "SE", "EE"]);

// 4000+ CS/SE/EE courses not already in the catalog's explicit list are
// closer to "Major Technical Electives" than "Free Electives" — there's
// no stronger signal available than subject + level for this split.
function isTechnicalElectiveCandidate(subject, catalogNbr) {
  const num = parseInt(catalogNbr, 10);
  return TECH_ELECTIVE_SUBJECTS.has(subject) && Number.isFinite(num) && num >= 4000;
}

// Core Curriculum groups with no explicit course list (e.g. "American
// History" — the catalog just says "see advisor") are the only ones an
// unlisted course can land in automatically; groups that already have
// their own explicit course list only accept checkbox matches, never
// manual entries (see classifyUnlistedCourses doc comment below).
function findOpenCoreGroups(catalog) {
  const groups = [];
  catalog.sections.forEach((section, si) => {
    if (section.title !== "Core Curriculum Requirements") return;
    section.groups.forEach((group, gi) => {
      if (group.courses.length === 0) groups.push({ si, gi, group });
    });
  });
  return groups;
}

function findGroupByLabel(catalog, label) {
  for (let si = 0; si < catalog.sections.length; si++) {
    const gi = catalog.sections[si].groups.findIndex((g) => g.label === label);
    if (gi !== -1) return { si, gi };
  }
  return null;
}

// For every open Core Curriculum group (empty course list — American
// History, Creative Arts, etc.), looks up the matching category in
// core_curriculum.json (same label-matching used for auto-routing
// parsed transcript courses) and returns its course list, so the
// manual-entry form can offer a dropdown instead of free text. Groups
// with no matching category (Free Electives, Major Technical
// Electives — there's no bounded course list for those) are simply
// absent from the returned map, and the form falls back to free text.
function buildOpenGroupCourseOptions(catalog, coreCurriculum) {
  const options = {};
  for (const { si, gi, group } of findOpenCoreGroups(catalog)) {
    const category = coreCurriculum.find((c) => normalizeLabel(c.name) === normalizeLabel(group.label));
    if (!category) continue;
    options[`${si}-${gi}`] = category.courses
      .map((c) => ({ code: c.code, name: c.name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }
  return options;
}

/**
 * For completed transcript courses that aren't explicitly listed
 * anywhere in the major catalog: match them to a Core Curriculum
 * category (via the transcript's own Req Designation, falling back to
 * core_curriculum.json) and route them into that category's manual-
 * entry group — but only when the catalog leaves that category open
 * (no explicit course list of its own). A matched category whose
 * catalog group already has explicit courses (even an incomplete list —
 * e.g. Government/Political Science here only lists GOVT 2305, not
 * GOVT 2306, so a student who took 2306 instead won't get credited
 * toward that group by this function) isn't touched, since the UI
 * doesn't support mixing checkboxes and manual entries in one group.
 * Those courses — and anything with no category match at all — fall
 * through to elective.
 *
 * Returns a flat list of { si, gi, code, hours } to merge into
 * manualEntries; doesn't mutate anything itself.
 */
function classifyUnlistedCourses(courses, allCodes, catalog, coreCurriculum) {
  const { assignment } = assignCoreCategories(courses, coreCurriculum);
  const openGroups = findOpenCoreGroups(catalog);
  const techElectiveGroup = findGroupByLabel(catalog, "Major Technical Electives");
  const freeElectiveGroup = findGroupByLabel(catalog, "Free Electives");

  const additions = [];
  for (const course of courses.values()) {
    if (!course.completed || allCodes.has(course.code)) continue;

    const categoryCode = assignment.get(course.code);
    const categoryName = categoryCode
      ? coreCurriculum.find((c) => c.code === categoryCode)?.name
      : null;
    const openGroup = categoryName
      ? openGroups.find((g) => normalizeLabel(g.group.label) === normalizeLabel(categoryName))
      : null;

    if (openGroup) {
      additions.push({ si: openGroup.si, gi: openGroup.gi, code: course.code, hours: course.earned });
      continue;
    }

    const target = isTechnicalElectiveCandidate(course.subject, course.catalogNbr)
      ? techElectiveGroup
      : freeElectiveGroup;
    if (target) {
      additions.push({ si: target.si, gi: target.gi, code: course.code, hours: course.earned });
    }
  }
  return additions;
}

function optionContainsCode(opt, code) {
  if (opt.code === code) return true;
  if (opt.with?.some((w) => w.code === code)) return true;
  if (opt.alternatives?.some((alt) => optionContainsCode(alt, code))) return true;
  return false;
}

function findExplicitGroupsForCode(catalog, code) {
  const hits = [];
  catalog.sections.forEach((section) => {
    section.groups.forEach((group) => {
      if (group.courses.some((opt) => optionContainsCode(opt, code))) {
        hits.push(`${section.title} → ${group.label}`);
      }
    });
  });
  return hits;
}

// Prints one row per course pdf.js actually found, and which bucket it
// ended up in — explicit catalog match, an auto-routed core/elective
// group, "in progress" (excluded on purpose), or NOT PLACED (a real bug
// if it shows up, since every completed course should land somewhere).
function logTranscriptDebugReport(courses, allCodes, catalog, additions) {
  const additionsByCode = new Map(additions.map((a) => [a.code, a]));
  const rows = [...courses.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => {
      let destination;
      if (!c.completed) {
        destination = "— in progress, not counted —";
      } else if (allCodes.has(c.code)) {
        destination = findExplicitGroupsForCode(catalog, c.code).join(" | ") || "explicit match (group not found?)";
      } else if (additionsByCode.has(c.code)) {
        const a = additionsByCode.get(c.code);
        destination = `${catalog.sections[a.si].title} → ${catalog.sections[a.si].groups[a.gi].label} (auto-routed)`;
      } else {
        destination = "*** NOT PLACED — these earned hours are being lost ***";
      }
      return {
        code: c.code,
        title: c.title,
        term: c.term,
        source: c.source,
        earned: c.earned,
        completed: c.completed,
        destination,
      };
    });

  console.group(`Transcript parse debug — ${rows.length} course rows found`);
  console.table(rows);
  const earnedTotal = rows.filter((r) => r.completed).reduce((s, r) => s + r.earned, 0);
  const unplacedTotal = rows
    .filter((r) => r.completed && r.destination.startsWith("*** NOT PLACED"))
    .reduce((s, r) => s + r.earned, 0);
  console.log(`Total earned hours across all completed courses: ${earnedTotal}`);
  if (unplacedTotal > 0) {
    console.warn(`${unplacedTotal} of those hours are NOT PLACED anywhere — see rows above.`);
  }
  console.groupEnd();
}

// Prints target vs. counted SCH for every group with a credit_hours
// target, so a low hoursEarned total can be traced to a specific
// group — capped manual entries, or an explicit-course group that
// isn't 100% checked off yet (which contributes 0, not partial credit).
function logRequirementGroupDebug(catalog, completedCodes, manualEntriesNext) {
  console.group("Requirement group hours breakdown");
  let totalEarned = 0;
  catalog.sections.forEach((section, si) => {
    section.groups.forEach((group, gi) => {
      const target = parseHours(group.credit_hours);
      if (target == null) {
        console.log(`(excluded — no SCH target in catalog data) ${section.title} → ${group.label}`);
        return;
      }
      const key = `${si}-${gi}`;
      if (group.courses.length > 0) {
        const ok = groupSatisfied(group, completedCodes);
        const counted = explicitGroupHoursEarned(group, completedCodes, target);
        const satisfiesSlot = (opt) =>
          optionSatisfied(opt, completedCodes) || opt.alternatives.some((alt) => optionSatisfied(alt, completedCodes));
        const satisfiedCount = group.courses.filter(satisfiesSlot).length;
        console.log(
          `${ok ? "DONE" : "    "}  ${section.title} → ${group.label}: ${counted}/${target} SCH` +
            (ok
              ? ""
              : group.choice
                ? "  (choice group, none of the options fully satisfied — no partial credit for these)"
                : `  (${satisfiedCount}/${group.courses.length} course slots checked, ~${counted} SCH approximated)`)
        );
        totalEarned += counted;
      } else {
        const entries = manualEntriesNext[key] || [];
        const rawTotal = entries.reduce((s, e) => s + e.hours, 0);
        const counted = Math.min(rawTotal, target);
        console.log(
          `${counted >= target ? "DONE" : "    "}  ${section.title} → ${group.label}: ${counted}/${target} SCH` +
            (rawTotal > target ? `  (capped — ${rawTotal} SCH logged here, only ${target} counts)` : "")
        );
        totalEarned += counted;
      }
    });
  });
  console.log(`hoursEarned total: ${totalEarned}`);
  console.groupEnd();
}

function matchesSearch(option, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hit = (c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
  if (hit(option)) return true;
  if (option.with.some(hit)) return true;
  if (option.alternatives.some((a) => hit(a) || a.with.some(hit))) return true;
  return false;
}

function CourseOption({ option, completed, onToggle, isAlternative }) {
  const satisfied = optionSatisfied(option, completed);
  return (
    <div className="s3-option">
      {isAlternative && <span className="s3-connector s3-connector--or">or</span>}
      <label className={`s3-row${satisfied ? " s3-row--done" : ""}`}>
        <input
          type="checkbox"
          checked={completed.has(option.code)}
          onChange={() => onToggle(option.code)}
        />
        <span className="s3-check" aria-hidden="true" />
        <span className="s3-code">{option.code}</span>
        <span className="s3-title">{option.title}</span>
      </label>

      {option.with.map((w) => (
        <label key={w.code} className="s3-row s3-row--with">
          <span className="s3-connector s3-connector--and">+</span>
          <input
            type="checkbox"
            checked={completed.has(w.code)}
            onChange={() => onToggle(w.code)}
          />
          <span className="s3-check" aria-hidden="true" />
          <span className="s3-code">{w.code}</span>
          <span className="s3-title">{w.title}</span>
        </label>
      ))}

      {option.alternatives.map((alt) => (
        <CourseOption
          key={alt.code}
          option={alt}
          completed={completed}
          onToggle={onToggle}
          isAlternative
        />
      ))}
    </div>
  );
}

function RequirementGroup({ group, completed, onToggle, query }) {
  const visibleCourses = group.courses.filter((opt) => matchesSearch(opt, query));
  if (query && visibleCourses.length === 0) return null;

  const satisfied = groupSatisfied(group, completed);

  return (
    <div className="s3-group">
      <div className="s3-group-header">
        <span className={`s3-group-dot${satisfied ? " s3-group-dot--done" : ""}`} />
        <span className="s3-group-label">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="s3-group-hours">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="s3-group-desc">{group.description}</p>}
      {visibleCourses.map((opt) => (
        <CourseOption key={opt.code} option={opt} completed={completed} onToggle={onToggle} />
      ))}
    </div>
  );
}

function ManualEntryGroup({ group, entries, onAdd, onRemove, courseOptions }) {
  const hasDropdown = Array.isArray(courseOptions) && courseOptions.length > 0;
  const [code, setCode] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [hours, setHours] = useState(3);
  const target = parseHours(group.credit_hours);
  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  const satisfied = target != null && total >= target;

  // Don't offer a course a second time once it's already logged here.
  const availableOptions = hasDropdown
    ? courseOptions.filter((opt) => !entries.some((e) => e.code === opt.code))
    : [];

  function handleSelectChange(e) {
    const value = e.target.value;
    setSelectedOption(value);
    if (value) setHours(creditHoursFromCode(value)); // pre-fill, still editable below
  }

  function handleAdd(e) {
    e.preventDefault();
    const finalCode = hasDropdown ? selectedOption : code.trim().toUpperCase();
    if (!finalCode || Number(hours) <= 0) return;
    onAdd(finalCode, Number(hours));
    setCode("");
    setSelectedOption("");
  }

  return (
    <div className="s3-group">
      <div className="s3-group-header">
        <span className={`s3-group-dot${satisfied ? " s3-group-dot--done" : ""}`} />
        <span className="s3-group-label">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="s3-group-hours">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="s3-group-desc">{group.description}</p>}

      {entries.length > 0 && (
        <ul className="s3-manual-list">
          {entries.map((entry) => (
            <li key={entry.id} className="s3-manual-row">
              <span className="s3-code">{entry.code}</span>
              <span className="s3-manual-hours">{entry.hours} SCH</span>
              <button
                type="button"
                className="s3-manual-remove"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.code}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="s3-manual-form" onSubmit={handleAdd}>
        {hasDropdown ? (
          <select
            className="s3-manual-input s3-manual-input--code"
            value={selectedOption}
            onChange={handleSelectChange}
          >
            <option value="">Select a course…</option>
            {availableOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.code} — {opt.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="s3-manual-input s3-manual-input--code"
            placeholder="e.g. CS 4348"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        <input
          type="number"
          className="s3-manual-input s3-manual-input--hours"
          min="1"
          max="12"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <button type="submit" className="s3-manual-add" disabled={hasDropdown && !selectedOption}>
          Add
        </button>
      </form>

      {target != null ? (
        <p className="s3-manual-progress">
          {total} of {target} SCH logged
        </p>
      ) : (
        <p className="s3-manual-progress s3-manual-progress--unknown">
          {total} SCH logged (not counted toward hours left — this requirement's exact
          SCH isn't in the catalog data)
        </p>
      )}
    </div>
  );
}

function RequirementSection({
  section,
  sectionIndex,
  completed,
  onToggle,
  query,
  manualEntries,
  onManualAdd,
  onManualRemove,
  courseOptionsByGroup,
}) {
  const [open, setOpen] = useState(true);
  const indexedGroups = section.groups.map((g, gi) => ({ g, gi }));
  const visibleGroups = indexedGroups.filter(({ g }) =>
    query ? g.courses.some((opt) => matchesSearch(opt, query)) : true
  );
  if (query && visibleGroups.length === 0) return null;

  return (
    <section className="s3-section">
      <button className="s3-section-header" onClick={() => setOpen((o) => !o)} type="button">
        <span className="s3-section-title">{section.title}</span>
        <span className="s3-section-hours">{section.credit_hours} SCH</span>
        <span className={`s3-caret${open ? " s3-caret--open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="s3-section-body">
          {visibleGroups.map(({ g, gi }) => {
            const key = `${sectionIndex}-${gi}`;
            if (g.courses.length === 0) {
              return (
                <ManualEntryGroup
                  key={key}
                  group={g}
                  entries={manualEntries[key] || []}
                  onAdd={(code, hours) => onManualAdd(key, code, hours)}
                  onRemove={(id) => onManualRemove(key, id)}
                  courseOptions={courseOptionsByGroup[key]}
                />
              );
            }
            return (
              <RequirementGroup
                key={key}
                group={g}
                completed={completed}
                onToggle={onToggle}
                query={query}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function Step3AcademicHistory({
  major,
  startYear,
  completed,
  manualEntries,
  onChange,
  onBack,
  onContinue,
}) {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [coreCurriculum, setCoreCurriculum] = useState(null);
  const [query, setQuery] = useState("");
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcriptNote, setTranscriptNote] = useState("");
  const [transcriptParsing, setTranscriptParsing] = useState(false);

  useEffect(() => {
    if (!startYear) return;
    let cancelled = false;
    loadCoreCurriculum(coreCurriculumUrl(startYear))
      .then((data) => {
        if (!cancelled) setCoreCurriculum(data);
      })
      .catch((err) => {
        // Best-effort — the manual-entry dropdown just falls back to
        // free text if this isn't available, same as the transcript
        // upload's auto-routing does.
        console.warn("Couldn't load core curriculum — manual entry will use free text:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [startYear]);

  const courseOptionsByGroup = useMemo(
    () => (catalog && coreCurriculum ? buildOpenGroupCourseOptions(catalog, coreCurriculum) : {}),
    [catalog, coreCurriculum]
  );

  const degreeTypes = useMemo(() => (major ? undergradDegreeTypes(major) : []), [major]);
  const [selectedDegreeType, setSelectedDegreeType] = useState(null);

  useEffect(() => {
    setSelectedDegreeType(null);
  }, [major]);

  const resolvedDegreeType = degreeTypes.length === 1 ? degreeTypes[0] : selectedDegreeType;
  const canonicalMajor = resolveMajorKey(major);

  useEffect(() => {
    if (!major || !startYear) return;
    if (degreeTypes.length === 0) {
      setCatalog(null);
      setLoadError(`We don't have degree requirements on file for "${major}" yet.`);
      return;
    }
    if (!resolvedDegreeType) {
      setCatalog(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setLoadError(null);

    const slug = slugify(`${canonicalMajor} (${resolvedDegreeType})`);
    fetch(`${catalogBaseUrl(startYear)}/${slug}.json`)
      .then((res) => {
        if (!res.ok)
          throw new Error(
            `Couldn't load ${startYear} requirements for "${major} (${resolvedDegreeType})" — catalog not available yet.`
          );
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [major, startYear, degreeTypes.length, resolvedDegreeType]);

  const allCodes = useMemo(() => (catalog ? collectAllCodes(catalog) : new Set()), [catalog]);

  const totalHours = catalog ? parseHours(catalog.total_credit_hours) : null;

  const hoursEarned = useMemo(() => {
    if (!catalog) return 0;
    let earned = 0;
    catalog.sections.forEach((section, si) => {
      section.groups.forEach((group, gi) => {
        const target = parseHours(group.credit_hours);
        if (target == null) return;
        if (group.courses.length > 0) {
          earned += explicitGroupHoursEarned(group, completed, target);
        } else {
          const key = `${si}-${gi}`;
          const manualTotal = (manualEntries[key] || []).reduce((sum, e) => sum + e.hours, 0);
          earned += Math.min(manualTotal, target);
        }
      });
    });
    return earned;
  }, [catalog, completed, manualEntries]);

  const hoursLeft = totalHours != null ? Math.max(totalHours - hoursEarned, 0) : null;

  function toggleCourse(code) {
    const next = new Set(completed);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange({ completed: next, manualEntries });
  }

  function addManualEntry(key, code, hours) {
    const list = manualEntries[key] || [];
    onChange({
      completed,
      manualEntries: { ...manualEntries, [key]: [...list, { id: crypto.randomUUID(), code, hours }] },
    });
  }

  function removeManualEntry(key, id) {
    onChange({
      completed,
      manualEntries: {
        ...manualEntries,
        [key]: (manualEntries[key] || []).filter((e) => e.id !== id),
      },
    });
  }

  async function handleTranscriptChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTranscriptFile(file);

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setTranscriptNote(
        "Automatic reading only works for PDF degree audits right now — please confirm your completed courses in the list below."
      );
      return;
    }

    setTranscriptParsing(true);
    setTranscriptNote("Reading transcript…");
    try {
      const extracted = await extractCompletedCourses(file);
      const foundCodes = [...extracted.values()].filter((c) => c.completed).map((c) => c.code);

      if (foundCodes.length === 0) {
        setTranscriptNote(
          "Couldn't find any completed courses in that PDF — it may not be a UTD degree audit export. Please confirm your completed courses in the list below."
        );
        return;
      }

      const alreadyChecked = foundCodes.filter((code) => completed.has(code)).length;
      const newlyChecked = foundCodes.length - alreadyChecked;
      const next = new Set(completed);
      foundCodes.forEach((code) => next.add(code));

      // Courses that aren't explicitly listed anywhere in the catalog
      // (Core Curriculum electives like American History, or general
      // electives) don't have a checkbox to check — log them as manual
      // entries instead, best-effort. If this fails for any reason
      // (e.g. core-curriculum.json isn't deployed yet), the checkbox
      // update above still goes through on its own.
      let manualEntriesNext = manualEntries;
      let loggedCount = 0;
      let additions = [];
      if (catalog) {
        try {
          // Reuse what's already loaded at mount; only fetch fresh if
          // someone manages to upload before that resolves.
          const curriculum = coreCurriculum ?? (await loadCoreCurriculum());
          additions = classifyUnlistedCourses(extracted, allCodes, catalog, curriculum);
          if (additions.length) {
            manualEntriesNext = { ...manualEntries };
            for (const { si, gi, code, hours } of additions) {
              const key = `${si}-${gi}`;
              const list = manualEntriesNext[key] || manualEntries[key] || [];
              if (list.some((entry) => entry.code === code)) continue; // already logged from a prior upload
              manualEntriesNext[key] = [...list, { id: crypto.randomUUID(), code, hours }];
              loggedCount += 1;
            }
          }
        } catch (classifyErr) {
          // Best-effort — the checkbox update still goes through even if
          // this fails — but log it, since a silent failure here just
          // looks like "my hours are too low" with no clue why.
          console.warn("Core curriculum categorization skipped:", classifyErr);
        }
      } else {
        console.warn("Core curriculum categorization skipped: major catalog hasn't loaded yet.");
      }

      if (catalog) {
        logTranscriptDebugReport(extracted, allCodes, catalog, additions);
        logRequirementGroupDebug(catalog, next, manualEntriesNext);
      }

      onChange({ completed: next, manualEntries: manualEntriesNext });

      setTranscriptNote(
        `Found ${foundCodes.length} completed courses in your transcript` +
          (newlyChecked > 0 ? ` — checked ${newlyChecked} new ones below.` : ", all already checked below.") +
          (loggedCount > 0 ? ` Logged ${loggedCount} more toward electives/open requirements.` : "") +
          " Review the list to make sure it looks right."
      );
    } catch (err) {
      setTranscriptNote(
        "Couldn't automatically read that PDF — please confirm your completed courses in the list below instead."
      );
    } finally {
      setTranscriptParsing(false);
    }
  }

  const doneCount = [...allCodes].filter((c) => completed.has(c)).length;

  return (
    <div className="s3-screen">
      <header className="s3-header">
        <div className="s3-header-intro">
          <h1 className="s3-heading">Your academic history</h1>
          <p className="s3-subheading">
            Upload a transcript or check off completed courses for <strong>{major}</strong>.
          </p>
        </div>

        <div className="s3-header-actions">
          {catalog && totalHours != null && (
            <div className="s3-hours-banner">
              <span className="s3-hours-banner__value">{hoursLeft}</span>
              <span className="s3-hours-banner__label">
                SCH left to graduate
                <span className="s3-hours-banner__sub">
                  {hoursEarned} of {totalHours} satisfied
                </span>
              </span>
            </div>
          )}

          <div className="s3-upload">
            <label className={`s3-upload-button${transcriptParsing ? " s3-upload-button--busy" : ""}`}>
              {transcriptParsing ? "Reading…" : "Upload transcript"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleTranscriptChange}
                disabled={transcriptParsing}
                hidden
              />
            </label>
            {transcriptFile && <span className="s3-upload-filename">{transcriptFile.name}</span>}
          </div>
        </div>
      </header>

      {transcriptNote && <p className="s3-upload-note">{transcriptNote}</p>}

      {degreeTypes.length > 1 && !resolvedDegreeType && (
        <div className="s3-degree-picker">
          <p className="s3-degree-picker__label">Which degree track?</p>
          <div className="s3-degree-picker__options">
            {degreeTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="s3-degree-picker__btn"
                onClick={() => setSelectedDegreeType(type)}
              >
                {major} ({type})
              </button>
            ))}
          </div>
        </div>
      )}

      {loadError && <p className="s3-error">{loadError}</p>}

      {catalog && (
        <>
          <div className="s3-toolbar">
            <input
              type="text"
              className="s3-search"
              placeholder="Search courses (e.g. CS 3345 or Data Structures)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="s3-progress">
              {doneCount} of {allCodes.size} listed courses checked
            </span>
          </div>

          <div className="s3-requirements">
            {catalog.sections.map((section, i) => (
              <RequirementSection
                key={`${section.title}-${i}`}
                section={section}
                sectionIndex={i}
                completed={completed}
                onToggle={toggleCourse}
                query={query}
                manualEntries={manualEntries}
                onManualAdd={addManualEntry}
                onManualRemove={removeManualEntry}
                courseOptionsByGroup={courseOptionsByGroup}
              />
            ))}
          </div>
        </>
      )}

      {!catalog && !loadError && <p className="s3-loading">Loading degree requirements…</p>}

      <div className="s3-footer">
        <button className="s3-btn s3-btn--ghost" type="button" onClick={onBack}>
          Back
        </button>
        <button
          className="s3-btn s3-btn--primary"
          type="button"
          disabled={!catalog}
          onClick={() =>
            onContinue({ completedCodes: [...completed], hoursEarned, hoursLeft, totalHours })
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
