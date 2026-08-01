/**
 * recommendCourses.js
 * ---------------------------------------------------------------------
 * Screen 4 (Recommended Courses) engine.
 *
 * Loads /classes.json (course name + prereq text, keyed by course code)
 * and turns "what's left in the catalog" into a prioritized pick list:
 * lower-level courses first, prereqs-satisfied first, aiming for 2-3
 * mandatory courses + 1-2 core electives that sum close to the
 * student's target weekly hours.
 */
import { optionSatisfied, groupSatisfied, creditHoursFromCode, parseHours, explicitGroupHoursEarned } from "./catalog";

export async function loadClasses(url = "/classes.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load classes.json: ${res.status}`);
  return res.json();
}

export function courseLevel(code) {
  const match = code.match(/(\d)\d{3}/);
  return match ? Number(match[1]) * 1000 : 9999;
}

const CODE_RE = /([A-Z]{2,4})\s*(\d{4})/g;

function extractCodes(text) {
  const codes = [];
  let match;
  CODE_RE.lastIndex = 0;
  while ((match = CODE_RE.exec(text))) codes.push(`${match[1]} ${match[2]}`);
  return codes;
}

// Splits `text` at every top-level (paren-depth 0) occurrence of `wordRe`
// (a global, case-insensitive /\band\b/g or /\bor\b/g), leaving anything
// inside parentheses untouched so "(A or B) and (C)" splits into two AND
// clauses instead of getting cut apart at the wrong "or".
function topLevelSplit(text, wordRe) {
  const parts = [];
  let start = 0;
  for (const m of text.matchAll(wordRe)) {
    const before = text.slice(0, m.index);
    const depth = (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length;
    if (depth === 0) {
      parts.push(text.slice(start, m.index));
      start = m.index + m[0].length;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Strips a redundant enclosing paren pair, e.g. "(A or B)" -> "A or B".
// Needed because topLevelSplit's depth tracking never returns to 0
// inside a string that's wrapped in a single pair spanning the whole
// thing — the close paren is the very last character.
// Unwraps a leading "(...)" group down to its matching close paren, e.g.
// "(A or B or C). Repeat Restriction" -> "A or B or C" — trailing prose
// with no course code in it (repeat limits, standing notes, etc.) is
// dropped rather than left to block the unwrap, since it's not part of
// the actual course list. If real course codes follow the closing paren
// (a genuine second clause), the text is left alone rather than guessed
// at further.
function stripOuterParens(text) {
  const t = text.trim();
  if (!t.startsWith("(")) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") {
      depth--;
      if (depth === 0) {
        const inner = t.slice(1, i);
        const rest = t.slice(i + 1).trim();
        if (!extractCodes(rest).length) return stripOuterParens(inner);
        return t;
      }
    }
  }
  return t;
}

// One OR-alternative (e.g. "ACCT 6330" or "an undergraduate degree in
// Accounting..."): satisfied if every course code mentioned in it is
// completed. Alternatives with no extractable code (standing, consent,
// "or equivalent", repeat restrictions, etc.) can't be verified from a
// completed-courses list, so they're treated as satisfied by default —
// same optimistic fallback as an entirely unparseable prereq.
function clauseSatisfied(clause, completed) {
  const codes = extractCodes(clause);
  return codes.length === 0 || codes.every((c) => completed.has(c));
}

// "with a grade of C or better", "with a minimum grade of B", "or
// higher" — these describe a grade threshold we can't verify from a
// completed-courses set anyway, but worse, their "or" isn't a real
// alternative and corrupts topLevelSplit once the real parenthesized
// OR-group before them has already closed (e.g. "(CS 1337 or CE 1337)
// with a grade of C or better" — that second "or" sits at depth 0).
function stripGradeNoise(text) {
  return text
    .replace(/with (a|an) (minimum )?grade (of )?[A-Za-z][+-]?\s*(or (better|higher))?/gi, "")
    .replace(/\bor (better|higher)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// UTD prereq text puts the actual requirement in the first sentence;
// anything after the first period is a note (repeat limits, "credit
// cannot be received for both X and Y", standing restrictions) whose
// "and"/"or" would otherwise be misread as more requirements.
function firstSentence(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "." && depth === 0) return text.slice(0, i);
  }
  return text;
}

// Real UTD prereq text is an AND of OR-groups: "(MATH 1325 or MATH 2413
// or MATH 2417) and (ACCT 2301 with a minimum grade of C) and (ACCT 2302
// with a minimum grade of C)" means every AND-clause must have at least
// one satisfied alternative. Grade minimums aren't checked — we only
// know pass/fail from a completed-courses set, not the grade earned.
export function prereqSatisfied(prereqText, completed) {
  if (!prereqText) return true;
  const cleaned = stripGradeNoise(firstSentence(prereqText));
  const andClauses = topLevelSplit(stripOuterParens(cleaned), /\band\b/gi);
  return andClauses.every((clause) => {
    const orParts = topLevelSplit(stripOuterParens(clause), /\bor\b/gi);
    return orParts.some((part) => clauseSatisfied(part, completed));
  });
}

function enrichOption(opt, classesMap, completed) {
  const info = classesMap[opt.code];
  return {
    code: opt.code,
    name: info?.name || opt.code,
    hours: creditHoursFromCode(opt.code),
    level: courseLevel(opt.code),
    prereqText: info?.prereq || "",
    prereqOk: prereqSatisfied(info?.prereq, completed),
  };
}

function sortByPriority(options) {
  return [...options].sort((a, b) => {
    if (a.prereqOk !== b.prereqOk) return a.prereqOk ? -1 : 1;
    if (a.level !== b.level) return a.level - b.level;
    return a.code.localeCompare(b.code);
  });
}

const ELECTIVE_DEFAULT_HOURS = 3;

// Every not-yet-satisfied requirement becomes either:
//  - a "slot": a course-list group with a remaining SCH need and a pool
//    of eligible not-yet-completed courses to fill it. This covers both
//    plain required lists (remaining == sum of the few unchecked
//    courses, so the pool just is those courses) and pooled groups like
//    Component Area Option (a big list where only some SCH worth is
//    actually needed — see explicitGroupHoursEarned).
//  - an "open group": no explicit course list at all (Free Electives,
//    unmatched Core Curriculum categories) — just a remaining SCH need,
//    no default course.
// Groups already satisfied by hours (not just by every course checked
// off) are excluded entirely, whichever kind they are.
function buildCandidates(catalog, completed, manualEntries, classesMap) {
  const slots = [];
  const openGroups = [];

  catalog.sections.forEach((section, si) => {
    section.groups.forEach((group, gi) => {
      const groupKey = `${si}-${gi}`;
      const target = parseHours(group.credit_hours);

      if (group.courses.length === 0) {
        const manualTotal = (manualEntries[groupKey] || []).reduce((sum, e) => sum + e.hours, 0);
        const remaining = target != null ? target - manualTotal : ELECTIVE_DEFAULT_HOURS;
        if (remaining <= 0) return;
        openGroups.push({ groupKey, sectionTitle: section.title, label: group.label, remainingHours: remaining });
        return;
      }

      let remaining;
      if (target != null) {
        remaining = target - explicitGroupHoursEarned(group, completed, target);
        if (remaining <= 0) return;
      } else if (groupSatisfied(group, completed)) {
        return;
      }

      const options = sortByPriority(
        group.courses
          .filter((opt) => !optionSatisfied(opt, completed))
          .flatMap((opt) => [opt, ...opt.alternatives])
          .map((o) => enrichOption(o, classesMap, completed))
      );
      if (!options.length) return;
      slots.push({
        groupKey,
        sectionTitle: section.title,
        label: group.label,
        options,
        // Groups with no declared credit_hours (a handful of catalog
        // entries are structural headers, not real SCH requirements) —
        // fall back to recommending everything still unchecked in them.
        remainingHours: remaining ?? options.reduce((sum, o) => sum + o.hours, 0),
      });
    });
  });

  return { slots, openGroups };
}

// Fills each slot's own remaining SCH need from its priority-sorted
// pool (prereqs-satisfied and lower-level courses first), then flags
// open elective categories still needed, until the term's target hours
// is reached or nothing eligible is left to add. No hard cap on how
// many slots/electives get picked — "2-3 mandatory + 1-2 electives" is
// the typical shape that falls out of this, not an enforced limit that
// would stop early while eligible courses are still on the table.
export function recommend({ catalog, completed, manualEntries, classesMap, targetHours }) {
  const { slots, openGroups } = buildCandidates(catalog, completed, manualEntries || {}, classesMap);
  const target = Number(targetHours) || 15;

  const slotPicks = [];
  let hours = 0;
  for (const slot of slots) {
    if (hours >= target) break;
    const picks = [];
    let filled = 0;
    for (const opt of slot.options) {
      if (filled >= slot.remainingHours || hours >= target) break;
      picks.push(opt);
      filled += opt.hours;
      hours += opt.hours;
    }
    if (picks.length) slotPicks.push({ ...slot, picks });
  }

  const electivePicks = [];
  for (const group of openGroups) {
    if (hours >= target) break;
    electivePicks.push(group);
    hours += Math.min(group.remainingHours, ELECTIVE_DEFAULT_HOURS);
  }

  // Best case if we ignored the target entirely and used every eligible
  // (prereq-satisfied) course left: tells us whether falling short is a
  // real limit (locked prereqs, or simply not enough left in the degree)
  // rather than something the picking above could have avoided.
  const eligibleCeiling =
    slots.reduce(
      (sum, slot) => sum + Math.min(slot.remainingHours, slot.options.filter((o) => o.prereqOk).reduce((h, o) => h + o.hours, 0)),
      0
    ) + openGroups.reduce((sum, g) => sum + Math.min(g.remainingHours, ELECTIVE_DEFAULT_HOURS), 0);

  return {
    slotPicks,
    electivePicks,
    totalHours: hours,
    shortfallHours: hours < target ? Math.max(0, target - eligibleCeiling) : 0,
    remainingSlots: slots,
    remainingElectiveGroups: openGroups,
  };
}
