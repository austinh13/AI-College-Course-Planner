/**
 * scheduleCourses.js
 * ---------------------------------------------------------------------
 * Screen 5 (Possible Schedules) engine.
 *
 * Takes Screen 4's final course list + Screen 2's time constraints and
 * counts how many conflict-free section combinations exist for Fall
 * 2026, using /All_Courses/<PREFIX>.json (a raw CourseBook export, one
 * file per subject prefix — not every prefix exists yet).
 *
 * Section capacity (enrolled_current/enrolled_max) is intentionally
 * ignored — a full section still counts as a valid option.
 */
import { creditHoursFromCode } from "./catalog";
import { loadProfessorRatings, sectionFailsHardFilter, sectionPreferenceScore, getInstructorRating } from "./professorRatings";

// How many top-scoring schedules to keep around for the user to cycle
// through (Screen 5). Kept small since these are held in memory across
// the whole backtracking search.
const MAX_SCHEDULES = 10;

// CourseBook spells days out in full; Screen 2 (and everything else in
// this app) uses 3-letter abbreviations, so every day gets normalized
// through this map the moment it's read off a section.
const DAY_ABBR = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

// Matches Screen 2's TIME_BLOCKS ids, in minutes-from-midnight. A
// section must fall entirely inside one of the user's selected blocks
// to count as "inside the space you leave open" — partial overlap
// doesn't qualify.
const TIME_BLOCK_WINDOWS = {
  early: [8 * 60, 10 * 60],
  morning: [10 * 60, 12 * 60],
  afternoon: [12 * 60, 16 * 60],
  evening: [16 * 60, 24 * 60],
};

export async function loadAllCourses(prefix, url = `/All_Courses/${prefix.toUpperCase()}.json`) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const data = await res.json();
  return data.report_data || [];
}

// "CS 1337" -> { prefix: "CS", number: "1337" }. Returns null for
// anything that doesn't look like a real course code (e.g. leftover
// free-text from an elective input box).
export function parseCode(code) {
  const match = String(code || "")
    .trim()
    .match(/^([A-Za-z]{2,4})\s*([0-9][0-9A-Za-z]{2,4})$/);
  if (!match) return null;
  return { prefix: match[1].toUpperCase(), number: match[2].toUpperCase() };
}

function minutesFromHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// "08:30 - 09:45" -> {start: 510, end: 585}. Returns null for "tbd -
// tbd" or an empty string — those sections carry no real meeting time,
// so they can't conflict with anything and pass every time constraint
// automatically (this is also how independent-study/research/
// dissertation-style rows with no fixed meeting end up handled, without
// needing to special-case their activity_type by name).
function parseTimeRange(timesStr) {
  const parts = (timesStr || "").split(" - ").map((s) => s.trim());
  if (parts.length !== 2 || !/^\d{1,2}:\d{2}$/.test(parts[0]) || !/^\d{1,2}:\d{2}$/.test(parts[1])) return null;
  return { start: minutesFromHHMM(parts[0]), end: minutesFromHHMM(parts[1]) };
}

function parseDays(daysStr) {
  return (daysStr || "")
    .split(",")
    .map((d) => DAY_ABBR[d.trim()])
    .filter(Boolean);
}

// One CourseBook row -> its meeting slots ({day, start, end, kind}), or
// [] if it has no real fixed time. `kind` distinguishes a normal class
// meeting from a shared Common Exam block, since both end up in the
// same section's `meetings` array but shouldn't be labeled the same way.
function rowMeetings(row, kind = "class") {
  const range = parseTimeRange(row.times);
  const days = parseDays(row.days);
  if (!range || !days.length) return [];
  return days.map((day) => ({ day, start: range.start, end: range.end, kind }));
}

// Groups a course's raw CourseBook rows into pickable "sections".
//
// Most courses are plain: every row is activity_type "Lecture" (or a
// single "Combined Lec/Lab" row that's already self-contained) and
// each row is one section a student picks.
//
// Two wrinkles show up in the real data:
//  - "Common Exam": a single shared exam block that isn't a choice —
//    every section of the course sits under it, so its meeting time is
//    added to every section rather than treated as another option.
//  - Courses with more than one *other* activity_type present at once
//    (e.g. CHEM 1111's Laboratory + Secondary Lecture) — CourseBook
//    doesn't say which of one type pairs with which of the other, so
//    guessing would risk silently wrong conflict math. Those are
//    reported back as "ambiguous" and left out of the count entirely
//    rather than guessed at.
export function classifyCourse(rows) {
  const commonExam = rows.filter((r) => r.activity_type === "Common Exam");
  const rest = rows.filter((r) => r.activity_type !== "Common Exam");

  if (!rest.length && !commonExam.length) return { status: "missing" };

  const restTypes = new Set(rest.map((r) => r.activity_type));
  if (restTypes.size > 1 || commonExam.length > 1) {
    return { status: "ambiguous" };
  }

  const fixedExtra = commonExam.length === 1 ? rowMeetings(commonExam[0], "exam") : [];
  const primaryRows = rest.length ? rest : commonExam;

  const sections = primaryRows.map((row) => {
    const isHonors = /honors/i.test(row.topic || "");
    return {
      sectionId: (row.section || "").trim(),
      label: `Sec ${(row.section || "").trim()} · ${(row.instructors || "Staff").trim()} · ${row.times_12h || "TBA"}${isHonors ? " · Honors" : ""}`,
      meetings: [...rowMeetings(row), ...fixedExtra],
      instructors: (row.instructors || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      term: row.term || "",
      isHonors,
    };
  });

  return { status: "ok", sections };
}

function withinSelectedBlocks(meeting, blockIds) {
  if (!blockIds.length) return true;
  return blockIds.some((id) => {
    const window = TIME_BLOCK_WINDOWS[id];
    return window && meeting.start >= window[0] && meeting.end <= window[1];
  });
}

function overlapsLunch(meeting, constraints) {
  if (!constraints.wantsLunch) return false;
  const lunchStart = minutesFromHHMM(constraints.lunchStart);
  const lunchEnd = minutesFromHHMM(constraints.lunchEnd);
  return meeting.start < lunchEnd && lunchStart < meeting.end;
}

function meetingPasses(meeting, constraints) {
  if (constraints.daysOff.includes(meeting.day)) return false;
  if (!withinSelectedBlocks(meeting, constraints.timeBlocks)) return false;
  if (overlapsLunch(meeting, constraints)) return false;
  return true;
}

function sectionPasses(section, constraints) {
  return section.meetings.every((m) => meetingPasses(m, constraints));
}

function meetingsOverlap(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

// Depth-first search over one section choice per course. Courses are
// searched smallest-pool-first so conflicting branches get pruned as
// early as possible. maxHoursPerDay (SCH, not clock time) is enforced
// per calendar day as sections get chosen, since it depends on which
// days the *specific* picked section actually meets.
const MAX_VISITS = 3_000_000;

function backtrackCount(courseSectionLists, constraints) {
  const maxHoursPerDay = constraints.unlimitedDailyHours || !constraints.maxHoursPerDay ? null : Number(constraints.maxHoursPerDay);
  const chosenMeetings = [];
  const chosenSections = [];
  const dayHours = {};
  let count = 0;
  let currentScore = 0;
  let visits = 0;
  let truncated = false;
  // Kept sorted descending by score, capped at MAX_SCHEDULES — these are
  // the schedules the user cycles through on Screen 5. When every
  // section scores 0 (no grade/RMP preference set), this just keeps the
  // first MAX_SCHEDULES valid combinations found, same as the old
  // single-best behavior did for its one result.
  const topSchedules = [];

  function recurse(i) {
    if (truncated) return;
    if (visits++ > MAX_VISITS) {
      truncated = true;
      return;
    }
    if (i === courseSectionLists.length) {
      count++;
      const worstKept = topSchedules.length ? topSchedules[topSchedules.length - 1].score : -Infinity;
      if (topSchedules.length < MAX_SCHEDULES || currentScore > worstKept) {
        const schedule = chosenSections.map((section, idx) => ({
          code: courseSectionLists[idx].code,
          section,
        }));
        topSchedules.push({ score: currentScore, schedule });
        topSchedules.sort((a, b) => b.score - a.score);
        if (topSchedules.length > MAX_SCHEDULES) topSchedules.length = MAX_SCHEDULES;
      }
      return;
    }

    const { sections, hours } = courseSectionLists[i];
    for (const section of sections) {
      if (truncated) return;
      const conflict = section.meetings.some((m) => chosenMeetings.some((cm) => meetingsOverlap(cm, m)));
      if (conflict) continue;

      const touchedDays = [...new Set(section.meetings.map((m) => m.day))];
      if (maxHoursPerDay != null) {
        const overCap = touchedDays.some((d) => (dayHours[d] || 0) + hours > maxHoursPerDay);
        if (overCap) continue;
      }

      chosenSections.push(section);
      chosenMeetings.push(...section.meetings);
      currentScore += section.score || 0;
      touchedDays.forEach((d) => {
        dayHours[d] = (dayHours[d] || 0) + hours;
      });

      recurse(i + 1);

      chosenSections.pop();
      chosenMeetings.length -= section.meetings.length;
      currentScore -= section.score || 0;
      touchedDays.forEach((d) => {
        dayHours[d] -= hours;
      });
    }
  }

  recurse(0);
  return { count, schedules: topSchedules.map((s) => s.schedule), truncated };
}

// Main entry point. courses: array of course codes from Screen 4's
// final picks (e.g. ["CS 1337", "MATH 2417", ...]). isHonors: whether
// the student can be placed into Honors-only sections (Screen 1) — for
// everyone else, Honors sections are dropped before scheduling so they
// never show up as an option.
export async function generateSchedules({ courses, constraints, isHonors = false }) {
  const codes = [...new Set(courses)];
  const parsedByCode = new Map(codes.map((code) => [code, parseCode(code)]));
  const prefixes = [...new Set([...parsedByCode.values()].filter(Boolean).map((p) => p.prefix))];

  const filesByPrefix = {};
  const ratingsPromise = loadProfessorRatings().catch((err) => {
    console.warn("[scheduleCourses] no professor ratings data:", err.message);
    return {};
  });
  await Promise.all(
    prefixes.map(async (prefix) => {
      try {
        filesByPrefix[prefix] = await loadAllCourses(prefix);
      } catch (err) {
        console.warn(`[scheduleCourses] no All_Courses data for ${prefix}:`, err.message);
        filesByPrefix[prefix] = null;
      }
    })
  );
  const ratingsMap = await ratingsPromise;

  const resolved = [];
  const excluded = [];

  for (const code of codes) {
    const parsed = parsedByCode.get(code);
    if (!parsed) {
      excluded.push({ code, reason: "Couldn't read this as a course code." });
      continue;
    }
    const fileRows = filesByPrefix[parsed.prefix];
    if (!fileRows) {
      excluded.push({ code, reason: `No Fall 2026 section data on file yet for ${parsed.prefix}.` });
      continue;
    }
    const rows = fileRows.filter((r) => r.course_prefix.toUpperCase() === parsed.prefix && r.course_number.toUpperCase() === parsed.number);
    const classified = classifyCourse(rows);

    if (classified.status === "missing") {
      excluded.push({ code, reason: "Not found in Fall 2026 offerings." });
      continue;
    }
    if (classified.status === "ambiguous") {
      excluded.push({ code, reason: "Has multiple linked components (e.g. lecture + lab) that can't be safely auto-paired from the data." });
      continue;
    }

    // Non-Honors students never see Honors sections at all. Honors
    // students keep both — Honors is an extra option, not a replacement.
    const honorsEligibleSections = isHonors ? classified.sections : classified.sections.filter((s) => !s.isHonors);
    if (!honorsEligibleSections.length) {
      console.log(`[scheduleCourses] ${code} only has Honors sections and student isn't an Honors student`);
      return { total: 0, blockedBy: code, blockedReason: "honors", excluded, example: null, schedules: [], truncated: false };
    }

    const timeValidSections = honorsEligibleSections.filter((s) => sectionPasses(s, constraints));
    if (!timeValidSections.length) {
      console.log(`[scheduleCourses] ${code} has no section that fits the time constraints`);
      return { total: 0, blockedBy: code, blockedReason: "time", excluded, example: null, schedules: [], truncated: false };
    }

    const codeNoSpace = `${parsed.prefix}${parsed.number}`;
    const validSections = timeValidSections.filter((s) => !sectionFailsHardFilter(s, codeNoSpace, constraints, ratingsMap));
    if (!validSections.length) {
      console.log(`[scheduleCourses] ${code} has no section meeting the grade/RMP preference`);
      return { total: 0, blockedBy: code, blockedReason: "preferences", excluded, example: null, schedules: [], truncated: false };
    }
    validSections.forEach((s) => {
      s.score = sectionPreferenceScore(s, codeNoSpace, constraints, ratingsMap);
      // Course-specific instructor GPA (falls back to overall if this
      // exact course isn't on record) — shown on Screen 5's cards.
      s.instructorRatings = s.instructors.map((name) => ({
        name,
        ...getInstructorRating(name, codeNoSpace, ratingsMap),
      }));
    });
    resolved.push({ code, sections: validSections, hours: creditHoursFromCode(code) });
  }

  if (!resolved.length) {
    return { total: 0, blockedBy: null, blockedReason: null, excluded, example: null, schedules: [], truncated: false };
  }

  resolved.sort((a, b) => a.sections.length - b.sections.length);
  const { count, schedules, truncated } = backtrackCount(resolved, constraints);

  return {
    total: count,
    blockedBy: null,
    blockedReason: null,
    excluded,
    example: schedules[0] || null,
    schedules,
    truncated,
  };
}
