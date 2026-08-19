import { useEffect, useMemo, useState } from "react";
import { Badge } from "./lightswind/badge";
import { Button } from "./lightswind/button";
import { Alert } from "./lightswind/alert";
import { toast } from "./lightswind/toast";
import { extractCompletedCourses, loadCoreCurriculum, coreCurriculumUrl, assignCoreCategories } from "../lib/parseTranscript";
import {
  catalogBaseUrl,
  resolveMajorKey,
  undergradDegreeTypes,
  parseHours,
  slugify,
  optionSatisfied,
  groupSatisfied,
  creditHoursFromCode,
  explicitGroupHoursEarned,
  normalizeLabel,
  findOpenCoreGroups,
  findComponentAreaOptionGroup,
  findGroupByLabel,
  buildOpenGroupCourseOptions,
  loadClasses,
} from "../lib/catalog";

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
function collectAllCodes(catalog) {
  const codes = new Set<string>();
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

// Which courses are already spoken for by another requirement group —
// either checked off against that group's own explicit course list, or
// logged as a manual/extra entry there (including a different Component
// Area Option's own extras). Used to keep Component Area Option's add-
// dropdown from re-offering a course that's already getting credit
// elsewhere (e.g. CS 1200 checked off under Major Preparatory Courses,
// or THEA 1310 logged manually under Creative Arts).
function buildUsedElsewhere(catalog, completed, manualEntries) {
  const usedBy = new Map<string, Set<string>>(); // code -> Set of group keys ("si-gi")
  function mark(code: string, key: string) {
    if (!usedBy.has(code)) usedBy.set(code, new Set<string>());
    usedBy.get(code)?.add(key);
  }
  catalog.sections.forEach((section, si) => {
    section.groups.forEach((group, gi) => {
      const key = `${si}-${gi}`;
      group.courses.forEach((opt) => {
        const codes = [opt.code, ...opt.with.map((w) => w.code)];
        opt.alternatives.forEach((alt) => codes.push(alt.code, ...alt.with.map((w) => w.code)));
        codes.forEach((code) => {
          if (completed.has(code)) mark(code, key);
        });
      });
      (manualEntries[key] || []).forEach((entry) => mark(entry.code, key));
    });
  });
  return usedBy;
}

const TECH_ELECTIVE_SUBJECTS = new Set(["CS", "SE", "EE"]);

// 4000+ CS/SE/EE courses not already in the catalog's explicit list are
// closer to "Major Technical Electives" than "Free Electives" — there's
// no stronger signal available than subject + level for this split.
function isTechnicalElectiveCandidate(subject, catalogNbr) {
  const num = parseInt(catalogNbr, 10);
  return TECH_ELECTIVE_SUBJECTS.has(subject) && Number.isFinite(num) && num >= 4000;
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
 * doesn't support mixing checkboxes and manual entries in one group —
 * except Component Area Option (090), whose UI is built specifically
 * for that (ComponentAreaExtras), so surplus 090-eligible courses still
 * route there instead of falling through to elective.
 * Anything else with no category match at all falls through to elective.
 *
 * Returns a flat list of { si, gi, code, hours } to merge into
 * manualEntries; doesn't mutate anything itself.
 */
function classifyUnlistedCourses(courses, allCodes, catalog, coreCurriculum) {
  const { assignment } = assignCoreCategories(courses, coreCurriculum);
  const openGroups = findOpenCoreGroups(catalog) as Array<{
    si: number;
    gi: number;
    group: { label: string };
  }>;
  const techElectiveGroup = findGroupByLabel(catalog, "Major Technical Electives") as { si: number; gi: number } | null;
  const freeElectiveGroup = findGroupByLabel(catalog, "Free Electives") as { si: number; gi: number } | null;

  const additions: Array<{ si: number; gi: number; code: string; hours: number }> = [];
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

    // 090 (Component Area Option) has its own explicit course list, so
    // it's never among openGroups above — it needs its own lookup.
    if (categoryCode === "090") {
      const cao = findComponentAreaOptionGroup(catalog);
      if (cao) {
        additions.push({ si: cao.si, gi: cao.gi, code: course.code, hours: course.earned });
        continue;
      }
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
  const additionsByCode = new Map<string, { si: number; gi: number; code: string; hours: number }>(
    additions.map((a) => [a.code, a])
  );
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

function CourseOption({
  option,
  completed,
  onToggle,
  isAlternative = false,
}: {
  option: any;
  completed: Set<string>;
  onToggle: (code: string) => void;
  isAlternative?: boolean;
}) {
  const satisfied = optionSatisfied(option, completed);
  return (
    <div className="ml-0.5">
      {isAlternative && <span className="my-1 ml-1 block text-[0.85rem] font-bold uppercase tracking-[0.06em] text-[#8a8d8f]">or</span>}
      <label className={[
        "flex items-center gap-2.5 border-b border-white/10 px-1 py-1.5 text-[#f2f5f3]",
        satisfied ? "opacity-60 line-through" : "",
      ].join(" ")}>
        <input
          type="checkbox"
          className="h-[18px] w-[18px] accent-[#5fe0b7]"
          checked={completed.has(option.code)}
          onChange={() => onToggle(option.code)}
        />
        <span className="w-[96px] shrink-0 font-semibold text-[#e87500]" style={{ fontFamily: "var(--font-display)" }}>{option.code}</span>
        <span className="text-[0.98rem] text-[#f2f5f3]">{option.title}</span>
      </label>

      {option.with.map((w) => (
        <label key={w.code} className="ml-5 flex items-center gap-2.5 border-b border-white/10 px-1 py-1.5 text-[#f2f5f3]">
          <span className="w-4 shrink-0 text-center text-[0.85rem] font-bold text-[#5fe0b7]">+</span>
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-[#5fe0b7]"
            checked={completed.has(w.code)}
            onChange={() => onToggle(w.code)}
          />
          <span className="w-[96px] shrink-0 font-semibold text-[#e87500]" style={{ fontFamily: "var(--font-display)" }}>{w.code}</span>
          <span className="text-[0.98rem] text-[#f2f5f3]">{w.title}</span>
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

function RequirementGroup({
  group,
  completed,
  onToggle,
  query,
  extraEntries = [],
  onExtraAdd,
  onExtraRemove,
  classesMap,
  usedElsewhere,
  groupKey,
}) {
  const visibleCourses = group.courses.filter((opt) => matchesSearch(opt, query));
  if (query && visibleCourses.length === 0) return null;

  // Component Area Option (090) is UTD's odd one: it's satisfied by
  // re-using courses already completed for *other* categories, not just
  // the handful the catalog PDF happens to list for it — so its "done"
  // state and its add-more capability both need to factor in the extra
  // courses logged below, not just this group's own checkbox list.
  const isComponentAreaOption = normalizeLabel(group.label) === normalizeLabel("Component Area Option");
  const target = parseHours(group.credit_hours);
  const extraHours = extraEntries.reduce((sum, e) => sum + e.hours, 0);
  const satisfied =
    isComponentAreaOption && target != null
      ? explicitGroupHoursEarned(group, completed, target) + extraHours >= target
      : groupSatisfied(group, completed);

  return (
    <div className="my-3.5">
      <div className="mb-1 flex items-baseline gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${satisfied ? "bg-[#5fe0b7]" : "bg-white/25"}`} />
        <span className="text-base font-semibold text-[#f2f5f3]">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="text-[0.84rem] text-[#8a8d8f]">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="mb-1.5 m-0 text-[0.9rem] text-[#8a8d8f]/80">{group.description}</p>}
      {visibleCourses.map((opt) => (
        <CourseOption key={opt.code} option={opt} completed={completed} onToggle={onToggle} />
      ))}
      {isComponentAreaOption && (
        <ComponentAreaExtras
          group={group}
          completed={completed}
          extraEntries={extraEntries}
          onAdd={onExtraAdd}
          onRemove={onExtraRemove}
          classesMap={classesMap}
          usedElsewhere={usedElsewhere}
          groupKey={groupKey}
        />
      )}
    </div>
  );
}

// Dropdown of the student's other completed transcript courses — ones
// not already checked off in this group's own list — so Component Area
// Option can pull in courses that satisfy it by virtue of already
// satisfying a different category, which the catalog's own course list
// for this group doesn't capture.
function ComponentAreaExtras({ group, completed, extraEntries, onAdd, onRemove, classesMap, usedElsewhere, groupKey }) {
  const [selected, setSelected] = useState("");
  const ownCodes = new Set(group.courses.flatMap((opt) => [opt.code, ...opt.alternatives.map((alt) => alt.code)]));
  const alreadyExtra = new Set(extraEntries.map((e) => e.code));
  // A course counts as "used elsewhere" only if some *other* group's key
  // claims it — this group's own claim on it (its own list, or its own
  // extra entries) doesn't disqualify it, and is already handled above.
  const isUsedElsewhere = (code) => {
    const keys = usedElsewhere?.get(code);
    return !!keys && [...keys].some((k) => k !== groupKey);
  };
  const available = [...completed]
    .filter((code) => !ownCodes.has(code) && !alreadyExtra.has(code) && !isUsedElsewhere(code))
    .map((code) => ({ code, name: classesMap[code]?.name || code }))
    .sort((a, b) => a.code.localeCompare(b.code));

  function handleAdd(e) {
    e.preventDefault();
    if (!selected) return;
    onAdd(selected, creditHoursFromCode(selected));
    setSelected("");
  }

  return (
    <>
      {extraEntries.length > 0 && (
        <ul className="m-0 list-none p-0">
          {extraEntries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2.5 border-b border-white/10 px-1 py-1.5">
              <span className="w-[96px] shrink-0 font-semibold text-[#e87500]" style={{ fontFamily: "var(--font-display)" }}>{entry.code}</span>
              <span className="flex-1 text-[0.9rem] text-[#8a8d8f]">{entry.hours} SCH</span>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[1.2rem] leading-none text-[#8a8d8f] hover:text-[#ff9d8a]"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.code}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={handleAdd}>
          <select
            className="min-w-0 flex-1 rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[0.95rem] text-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Add another completed course…</option>
            {available.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.code} — {opt.name}
              </option>
            ))}
          </select>
          <button type="submit" className="shrink-0 rounded-md border border-[#5fe0b7] bg-transparent px-3 py-2 text-[0.85rem] font-semibold uppercase tracking-[0.04em] text-[#5fe0b7] transition-colors hover:bg-[#5fe0b7] hover:text-[#06110d] disabled:cursor-not-allowed disabled:opacity-40" disabled={!selected}>
            Add
          </button>
        </form>
      ) : (
        <p className="m-0 mt-2 text-[0.85rem] italic text-[#8a8d8f]/70">
          No other completed courses available to add here yet.
        </p>
      )}
    </>
  );
}

function ManualEntryGroup({ group, entries, onAdd, onRemove, courseOptions }) {
  const hasDropdown = Array.isArray(courseOptions) && courseOptions.length > 0;
  const [code, setCode] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [hours, setHours] = useState<number>(3);
  const target = parseHours(group.credit_hours);
  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  const satisfied = target != null && total >= target;

  // Don't offer a course a second time once it's already logged here.
  const availableOptions = hasDropdown
    ? courseOptions.filter((opt) => !entries.some((e) => e.code === opt.code))
    : [];

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setSelectedOption(value);
    if (value) setHours(creditHoursFromCode(value)); // pre-fill, still editable below
  }

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const finalCode = hasDropdown ? selectedOption : code.trim().toUpperCase();
    if (!finalCode || Number(hours) <= 0) return;
    onAdd(finalCode, Number(hours));
    setCode("");
    setSelectedOption("");
  }

  return (
    <div className="my-3.5">
      <div className="mb-1 flex items-baseline gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${satisfied ? "bg-[#5fe0b7]" : "bg-white/25"}`} />
        <span className="text-base font-semibold text-[#f2f5f3]">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="text-[0.84rem] text-[#8a8d8f]">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="mb-1.5 m-0 text-[0.9rem] text-[#8a8d8f]/80">{group.description}</p>}

      {entries.length > 0 && (
        <ul className="m-0 list-none p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2.5 border-b border-white/10 px-1 py-1.5">
              <span className="w-[96px] shrink-0 font-semibold text-[#e87500]" style={{ fontFamily: "var(--font-display)" }}>{entry.code}</span>
              <span className="flex-1 text-[0.9rem] text-[#8a8d8f]">{entry.hours} SCH</span>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[1.2rem] leading-none text-[#8a8d8f] hover:text-[#ff9d8a]"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.code}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {satisfied ? (
        <p className="m-0 mt-1 text-[0.85rem] text-[#8a8d8f]">
          {total} of {target} SCH logged — requirement met, remove an entry above to log a different course.
        </p>
      ) : (
        <>
          <form className="mt-2 flex flex-wrap gap-2" onSubmit={handleAdd}>
            {hasDropdown ? (
              <select
                className="min-w-0 flex-1 rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[0.95rem] text-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
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
                className="min-w-0 flex-1 rounded-md border border-[#1f5c43] bg-[#081712] px-3 py-2 text-[0.95rem] text-[#f2f5f3] placeholder:text-[#8a8d8f] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
                placeholder="e.g. CS 4348"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
            <input
              type="number"
              className="w-[56px] rounded-md border border-[#1f5c43] bg-[#081712] px-2 py-2 text-[0.95rem] text-[#f2f5f3] focus:outline-none focus:ring-2 focus:ring-[#5fe0b7]"
              min="1"
              max="12"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 0)}
            />
            <button type="submit" className="shrink-0 rounded-md border border-[#5fe0b7] bg-transparent px-3 py-2 text-[0.85rem] font-semibold uppercase tracking-[0.04em] text-[#5fe0b7] transition-colors hover:bg-[#5fe0b7] hover:text-[#06110d] disabled:cursor-not-allowed disabled:opacity-40" disabled={hasDropdown && !selectedOption}>
              Add
            </button>
          </form>

          {target != null && (
            <p className="m-0 mt-1 text-[0.85rem] text-[#8a8d8f]">
              {total} of {target} SCH logged
            </p>
          )}
        </>
      )}

      {target == null && (
        <p className="m-0 mt-1 text-[0.85rem] italic text-[#8a8d8f]/70">
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
  classesMap,
  usedElsewhere,
}) {
  const [open, setOpen] = useState(true);
  const indexedGroups = section.groups.map((g, gi) => ({ g, gi }));
  const visibleGroups = indexedGroups.filter(({ g }) =>
    query ? g.courses.some((opt) => matchesSearch(opt, query)) : true
  );
  if (query && visibleGroups.length === 0) return null;

  return (
    <section className="h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1d18]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <button className="flex w-full items-center justify-between gap-4 bg-[#0f261f]/80 px-4 py-3.5 text-left text-[#f2f5f3] transition-colors hover:bg-[#122d27]" onClick={() => setOpen((o) => !o)} type="button">
        <span className="text-base font-semibold text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>{section.title}</span>
        <span className="flex items-center gap-3 text-[0.76rem] uppercase tracking-[0.08em] text-[#9ca8a3]">
          {section.credit_hours} SCH
          <span className={`inline-block h-0 w-0 border-l-[6px] border-r-[6px] border-b-[7px] border-l-transparent border-r-transparent border-b-[#9ca8a3] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/10 px-3 py-3 md:px-4">
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
                extraEntries={manualEntries[key] || []}
                onExtraAdd={(code, hours) => onManualAdd(key, code, hours)}
                onExtraRemove={(id) => onManualRemove(key, id)}
                classesMap={classesMap}
                usedElsewhere={usedElsewhere}
                groupKey={key}
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
  const [classesMap, setClassesMap] = useState({});
  const [query, setQuery] = useState("");
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcriptNote, setTranscriptNote] = useState("");
  const [transcriptParsing, setTranscriptParsing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadClasses()
      .then((data) => {
        if (!cancelled) setClassesMap(data);
      })
      .catch((err) => {
        // Best-effort — the Component Area Option add-dropdown just
        // shows bare course codes instead of names if this fails.
        console.warn("Couldn't load classes.json — course names won't show in Component Area Option:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const usedElsewhere = useMemo(
    () => (catalog ? buildUsedElsewhere(catalog, completed, manualEntries) : new Map()),
    [catalog, completed, manualEntries]
  );

  const degreeTypes = useMemo<string[]>(() => (major ? (undergradDegreeTypes(major) as string[]) : []), [major]);
  const [selectedDegreeType, setSelectedDegreeType] = useState<string | null>(null);

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
          const key = `${si}-${gi}`;
          const manualTotal = (manualEntries[key] || []).reduce((sum, e) => sum + e.hours, 0);
          earned += Math.min(explicitGroupHoursEarned(group, completed, target) + manualTotal, target);
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
    setTranscriptNote("");
    toast("Reading transcript…");
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
          const curriculum = coreCurriculum ?? (await loadCoreCurriculum(coreCurriculumUrl(startYear)));
          additions = classifyUnlistedCourses(extracted, allCodes, catalog, curriculum);
          if (additions.length) {
            manualEntriesNext = { ...manualEntries };
            for (const { si, gi, code, hours } of additions) {
              const key = `${si}-${gi}`;
              const list = manualEntriesNext[key] || manualEntries[key] || [];
              if (list.some((entry) => entry.code === code)) continue; // already logged from a prior upload
              const target = parseHours(catalog.sections[si]?.groups[gi]?.credit_hours);
              const total = list.reduce((sum, e) => sum + e.hours, 0);
              if (target != null && total >= target) continue; // requirement already met
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
    <div className="relative z-10 flex w-full min-h-0 flex-col gap-5 rounded-[22px] border border-white/10 bg-[#071611]/85 p-4 shadow-[0_30px_80px_rgba(2,6,23,0.65)] ring-1 ring-inset ring-white/5 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div className="space-y-3">
          <Badge variant="secondary" className="border-[#2ad3a1]/30 bg-[#0f2c24] text-[#72f0c7] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            Academic history
          </Badge>
          <h1 className="m-0 text-[clamp(2.3rem,4vw,3rem)] font-bold leading-none tracking-[-0.03em] text-[#f2f5f3]" style={{ fontFamily: "var(--font-display)" }}>
            Your academic history
          </h1>
          <p className="m-0 max-w-2xl text-[1.02rem] text-[#9ca8a3]">
            Upload a transcript or check off completed courses for <strong className="font-semibold text-[#72f0c7]">{major}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {catalog && totalHours != null && (
            <div className="flex items-baseline gap-3 rounded-2xl border border-[#72f0c7]/25 bg-[#112f26]/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className="text-[2.55rem] font-bold leading-none text-[#72f0c7]" style={{ fontFamily: "var(--font-display)" }}>{hoursLeft}</span>
              <span className="flex flex-col text-[0.78rem] uppercase tracking-[0.06em] text-[#9ca8a3]">
                SCH left to graduate
                <span className="normal-case tracking-normal text-[#b9c9c4]">
                  {hoursEarned} of {totalHours} satisfied
                </span>
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className={`inline-flex cursor-pointer items-center justify-center rounded-xl border border-[#72f0c7]/60 bg-[#0d201a]/80 px-4 py-2.5 text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-[#72f0c7] transition-all duration-150 hover:border-[#72f0c7] hover:bg-[#72f0c7]/10 ${transcriptParsing ? "cursor-default opacity-60" : ""}`}>
              {transcriptParsing ? "Reading…" : "Upload transcript"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleTranscriptChange}
                disabled={transcriptParsing}
                hidden
              />
            </label>
            {transcriptFile && <span className="max-w-[140px] truncate text-[0.85rem] text-[#9ca8a3]">{transcriptFile.name}</span>}
          </div>
        </div>
      </header>

      {transcriptNote && <p className="rounded-2xl border border-white/10 bg-[#102820]/80 px-3 py-2 text-[0.95rem] text-[#d9eeea] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">{transcriptNote}</p>}

      {degreeTypes.length > 1 && !resolvedDegreeType && (
        <div className="rounded-2xl border border-white/10 bg-[#0d1b18] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="m-0 mb-3 text-[0.8rem] font-semibold uppercase tracking-[0.1em] text-[#9ca8a3]">Which degree track?</p>
          <div className="flex flex-wrap gap-2">
            {degreeTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="rounded-full border border-[#72f0c7]/50 bg-transparent px-4 py-2 text-[0.95rem] text-[#edf7f4] transition-all hover:border-[#72f0c7] hover:bg-[#72f0c7]/10"
                onClick={() => setSelectedDegreeType(type)}
              >
                {major} ({type})
              </button>
            ))}
          </div>
        </div>
      )}

      {loadError && <Alert>{loadError}</Alert>}

      {catalog && (
        <>
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
            <input
              type="text"
              className="flex-1 border-0 border-b border-[#61716d]/80 bg-transparent px-1 py-2 text-[1.02rem] text-[#f2f5f3] placeholder:text-[#8b9a96] focus:border-[#72f0c7] focus:outline-none"
              placeholder="Search courses (e.g. CS 3345 or Data Structures)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="whitespace-nowrap text-[0.75rem] uppercase tracking-[0.08em] text-[#9ca8a3]" style={{ fontFamily: "var(--font-mono)" }}>
              {doneCount} of {allCodes.size} listed courses checked
            </span>
          </div>

          <div className="grid auto-rows-fr gap-4 grid-cols-[repeat(auto-fit,minmax(290px,1fr))] items-stretch">
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
                classesMap={classesMap}
                usedElsewhere={usedElsewhere}
              />
            ))}
          </div>
        </>
      )}

      {!catalog && !loadError && <p className="text-[1rem] text-[#9ca8a3]">Loading degree requirements…</p>}

      <div className="mt-2 flex justify-end gap-3 border-t border-white/10 pt-4">
        <button className="rounded-full border border-white/10 bg-transparent px-8 py-3.5 text-[1rem] text-[#ebf5f2] transition-colors duration-200 hover:border-[#9ca8a3] hover:bg-white/5" type="button" onClick={onBack}>
          Back
        </button>
        <Button
          variant="custom"
          size="lg"
          className="rounded-full border border-[#ff9d5c] bg-[#e87500] px-8 text-[1rem] font-medium text-[#fff8f3] shadow-[0_10px_25px_rgba(232,117,0,0.28)] hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          disabled={!catalog}
          onClick={() =>
            onContinue({ completedCodes: [...completed], hoursEarned, hoursLeft, totalHours, degreeType: resolvedDegreeType })
          }
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
