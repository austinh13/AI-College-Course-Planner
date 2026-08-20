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
import { optionSatisfied, groupSatisfied, creditHoursFromCode, parseHours, explicitGroupHoursEarned, loadClasses, takenCourseCodes } from "./catalog";

export { loadClasses };

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
  // `completed` is checkbox-only (explicit-list groups); a course logged
  // via manual entry against an open group (e.g. GOVT 2305 under
  // Government/Political Science on majors where that group has no
  // explicit list) never sets a checkbox anywhere, so option pools need
  // the union of both to avoid re-offering it.
  const taken = takenCourseCodes(completed, manualEntries);
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
        const manualTotal = (manualEntries[groupKey] || []).reduce((sum, e) => sum + e.hours, 0);
        remaining = target - explicitGroupHoursEarned(group, completed, target) - manualTotal;
        if (remaining <= 0) return;
      } else if (groupSatisfied(group, completed)) {
        return;
      }

      const options = sortByPriority(
        group.courses
          .filter((opt) => !optionSatisfied(opt, taken))
          .flatMap((opt) => [opt, ...opt.alternatives.filter((alt) => !optionSatisfied(alt, taken))])
          .map((o) => enrichOption(o, classesMap, taken))
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

// UTD catalogs list every required section (Core Curriculum, Major
// Requirements) before "Elective Requirements", and required courses
// alone routinely already reach a typical target-hours load — so
// without help, elective-flavored slots/groups (Free Electives, Major
// Technical/Guided Electives) never get reached by the fill loop below.
// This matches both plain "Free Electives" (no course list) and named
// technical/guided elective categories that do have one, e.g. Mechanical
// Engineering's "Technical Electives" list.
const ELECTIVE_LABEL_RE = /elective/i;
const isElectiveSlot = (slot) => ELECTIVE_LABEL_RE.test(slot.sectionTitle) || ELECTIVE_LABEL_RE.test(slot.label);
const isElectiveGroup = (group) => ELECTIVE_LABEL_RE.test(group.sectionTitle) || ELECTIVE_LABEL_RE.test(group.label);
const isCoreCurriculum = (item) => item.sectionTitle === "Core Curriculum Requirements";

// Ranks every slot that has real course options — Core Curriculum's
// fixed-list groups, Major Preparatory/Core Courses, and Major Technical
// Elective lists — together by prereqs-satisfied first, then course level
// ascending, so a brand-new student's many eligible 1000/2000-level
// requirements always sort ahead of a 3000/4000-level major-technical
// elective. On an exact level tie between a Core Curriculum course and a
// major-technical elective, Core Curriculum wins (lower-level core
// requirements trump major technical); Major Prep/Core courses get no
// such boost over major-technical beyond whatever their actual level gives
// them.
function rankLeveled(slots) {
  return [...slots].sort((a, b) => {
    const aOk = a.options[0].prereqOk;
    const bOk = b.options[0].prereqOk;
    if (aOk !== bOk) return aOk ? -1 : 1;
    const aLevel = a.options[0].level;
    const bLevel = b.options[0].level;
    if (aLevel !== bLevel) return aLevel - bLevel;
    if (isCoreCurriculum(a) && isElectiveSlot(b)) return -1;
    if (isCoreCurriculum(b) && isElectiveSlot(a)) return 1;
    return 0;
  });
}

// Ranks open/no-fixed-course groups (Free Electives, empty elective
// categories, open Core Curriculum categories like Creative Arts) in the
// order "core requirements, general electives, or major technical
// electives" — Core Curriculum's open categories first, then general
// electives, then major-technical-labeled open groups.
function rankFlexible(openGroups) {
  const tier = (group) =>
    isCoreCurriculum(group) ? 0 : isElectiveGroup(group) ? (group.sectionTitle === "Elective Requirements" ? 1 : 2) : 3;
  return [...openGroups].sort((a, b) => tier(a) - tier(b));
}

// Fills the level-ranked pool and the flexible (no-fixed-course) pool
// against the term's target hours, until the target is reached or nothing
// eligible is left to add. The flexible pool gets a target-hours-scaled
// reservation so it can't be crowded out by an always-available lower-level
// backbone requirement — 1 guaranteed pick per ~9 hours (3 mandatory
// courses), growing with the load. No hard cap otherwise: whichever pool
// still has eligible items keeps filling once the other runs dry.
export function recommend({ catalog, completed, manualEntries, classesMap, targetHours }) {
  const { slots, openGroups } = buildCandidates(catalog, completed, manualEntries || {}, classesMap);
  const target = Number(targetHours) || 15;

  const leveled = rankLeveled(slots);
  const flexible = rankFlexible(openGroups);

  const electiveQuota = Math.max(1, Math.floor(target / 9));
  const reservedHours = Math.min(target, electiveQuota * ELECTIVE_DEFAULT_HOURS);

  const slotPicks = [];
  const electivePicks = [];
  let hours = 0;

  const fillLeveled = (budget) => {
    for (const slot of leveled) {
      if (slotPicks.some((s) => s.groupKey === slot.groupKey)) continue;
      if (hours >= budget) break;
      const picks = [];
      let filled = 0;
      for (const opt of slot.options) {
        if (filled >= slot.remainingHours || hours >= budget) break;
        picks.push(opt);
        filled += opt.hours;
        hours += opt.hours;
      }
      if (picks.length) slotPicks.push({ ...slot, picks });
    }
  };

  const fillFlexible = (budget) => {
    for (const group of flexible) {
      if (electivePicks.some((g) => g.groupKey === group.groupKey)) continue;
      if (hours >= budget) break;
      electivePicks.push(group);
      hours += Math.min(group.remainingHours, ELECTIVE_DEFAULT_HOURS);
    }
  };

  fillLeveled(target - reservedHours);
  fillFlexible(target);
  fillLeveled(target);

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
