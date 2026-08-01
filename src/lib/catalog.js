/**
 * catalog.js
 * ---------------------------------------------------------------------
 * Shared major-catalog helpers: resolving a major name to its catalog
 * file, and reading the sections/groups/course-option shape that every
 * Major_Parsed_<year>/<slug>.json file uses.
 *
 * Extracted from AcademicHistory.jsx so RecommendedCourses (Screen 4)
 * can resolve the exact same catalog slug/URL without duplicating the
 * logic — a prior slug-mismatch bug came from two places computing a
 * major's file name slightly differently.
 */
import utdDegrees from "../data/utd_degrees.json";

export function catalogBaseUrl(startYear) {
  return `/UTD_${startYear}/Major_Parsed_${startYear}`;
}

const NORMALIZED_MAJOR_KEYS = Object.keys(utdDegrees).reduce((map, key) => {
  map[key.trim().toLowerCase().replace(/\s+/g, " ")] = key;
  return map;
}, {});

export function resolveMajorKey(majorName) {
  if (!majorName) return null;
  return NORMALIZED_MAJOR_KEYS[majorName.trim().toLowerCase().replace(/\s+/g, " ")] || null;
}

export function undergradDegreeTypes(majorName) {
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

export function parseHours(value) {
  if (value == null) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function slugify(majorName) {
  return majorName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function optionSatisfied(option, completed) {
  if (!completed.has(option.code)) return false;
  return option.with.every((w) => completed.has(w.code));
}

export function groupSatisfied(group, completed) {
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
export function creditHoursFromCode(code) {
  const match = code.match(/(\d[\d-]{2,3})$/);
  const digit = match?.[1]?.[1];
  return digit && /\d/.test(digit) ? Number(digit) : 3;
}

// Some groups (e.g. UTD's 090 "Component Area Option") list a large pool
// of eligible courses but only require enough of them to reach a target
// SCH total, not literally every course in the list — group.choice is
// false for these (same shape as a plain required list), so the only
// way to tell them apart from a real "every course required" list is by
// credit hours: weight each course by its own SCH and give proportional
// credit, rather than requiring every listed course to be checked off.
export function explicitGroupHoursEarned(group, completed, target) {
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

export function normalizeLabel(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

// Core Curriculum groups with no explicit course list (e.g. "American
// History" — the catalog just says "see advisor") are the only ones an
// unlisted course can land in automatically.
export function findOpenCoreGroups(catalog) {
  const groups = [];
  catalog.sections.forEach((section, si) => {
    if (section.title !== "Core Curriculum Requirements") return;
    section.groups.forEach((group, gi) => {
      if (group.courses.length === 0) groups.push({ si, gi, group });
    });
  });
  return groups;
}

export function findGroupByLabel(catalog, label) {
  for (let si = 0; si < catalog.sections.length; si++) {
    const gi = catalog.sections[si].groups.findIndex((g) => g.label === label);
    if (gi !== -1) return { si, gi };
  }
  return null;
}

// For every open Core Curriculum group (empty course list — American
// History, Creative Arts, etc.), looks up the matching category in
// core_curriculum.json and returns its course list, so a manual-entry
// or recommendation form can offer a dropdown instead of free text.
export function buildOpenGroupCourseOptions(catalog, coreCurriculum) {
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
