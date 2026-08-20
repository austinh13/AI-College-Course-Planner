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


type Meeting = {
  day: string;
  start: number;
  end: number;
  kind?: string;
};

type Section = {
  sectionId: string;
  label: string;
  meetings: Meeting[];
  instructors: string[];
  term: string;
  isHonors: boolean;
  score?: number;
  instructorRatings?: Array<{ name: string; gradeRating: number | null; gradeIsCourseSpecific: boolean; gradeSemesterCount: number | null; rmpQuality: number | null }>;
};

type CourseSectionList = {
  code: string;
  sections: Section[];
  hours: number;
};

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
export function parseCode(code: string): { prefix: string; number: string } | null {
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

function parseDays(daysStr) {
  return (daysStr || "")
    .split(",")
    .map((d) => DAY_ABBR[d.trim()])
    .filter(Boolean);
}

// "1:00 PM" -> 780. Returns null for anything that isn't a 12-hour clock
// time, which is how a malformed block gets skipped below.
function minutesFrom12h(label) {
  const match = String(label || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const hour = Number(match[1]) % 12;
  return (/pm/i.test(match[3]) ? hour + 12 : hour) * 60 + Number(match[2]);
}

// One CourseBook row -> its meeting slots ({day, start, end, kind}), or
// [] if it has no fixed meeting time at all ("tbd - tbd" — independent
// study, research, online-anytime). `kind` distinguishes a normal class
// meeting from a shared Common Exam block, since both end up in the same
// section's `meetings` array but are treated very differently by the
// search below.
//
// Times come from `schedule_combined`, not from `days` + `times`. That
// pair can't express a section meeting at different times on different
// days: it flattens to "Monday, Wednesday" + "11:30 - 12:45; 12:45 -
// 15:15", which gives no way to tell a cross product (CHEM 2401 — both
// times on both days) from a 1:1 pairing (CS 4485 — Friday 1:00-3:15
// and Tuesday 1:00-2:15). `schedule_combined` spells every meeting out
// as its own day/time/location block, so there's nothing left to guess.
// Checked against the whole Fall 2026 export: it reproduces `days` +
// `times` exactly on all 1,581 rows those two can parse, and covers the
// 15 rows they can't.
//
// Identical blocks collapse to one — a meeting listed twice because it
// spans two rooms is still a single meeting.
function rowMeetings(row, kind = "class") {
  const meetings: Meeting[] = [];
  const seen = new Set<string>();
  for (const block of String(row.schedule_combined || "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const day = DAY_ABBR[lines[0]];
    const [from, to] = lines[1].split(" - ");
    const start = minutesFrom12h(from);
    const end = minutesFrom12h(to);
    if (!day || start == null || end == null) continue;
    const key = `${day}:${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    meetings.push({ day, start, end, kind });
  }
  return meetings;
}

// Whether a row claims to meet at a fixed time. An empty `meetings` array
// is only legitimate when CourseBook itself says there's no fixed time;
// if a row lists real days and a real time range but yields no meetings,
// that's a parse failure and it must not be waved through. A section with
// no meetings conflicts with nothing and satisfies every one of Screen
// 2's constraints, so a silent failure here doesn't read as "unknown", it
// reads as "this class is free every hour of the week".
function rowStatesMeetingTime(row) {
  const times = (row.times || "").trim();
  return parseDays(row.days).length > 0 && times !== "" && !/^tbd\s*-\s*tbd$/i.test(times);
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

  // Same reasoning as the ambiguous case: a course whose stated meeting
  // times we can't read is reported, not guessed at. Nothing in the Fall
  // 2026 export hits this — it's the guard that keeps a future parse
  // failure from turning a section into a phantom that fits any week.
  if (rows.some((row) => rowStatesMeetingTime(row) && rowMeetings(row).length === 0)) {
    return { status: "unreadable" };
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

// Selected blocks merge into contiguous ranges before a meeting is
// checked against them, so back-to-back selections (e.g. morning +
// afternoon) behave as one open window with no seam at the boundary
// between them — a class that straddles noon shouldn't fail just
// because "morning" and "afternoon" are tracked as two separate options.
// Non-adjacent selections (e.g. early + evening, skipping the middle)
// still correctly reject anything spanning the gap.
function mergeWindows(blockIds) {
  const windows = blockIds
    .map((id) => TIME_BLOCK_WINDOWS[id])
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [start, end] of windows) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function withinSelectedBlocks(meeting, blockIds) {
  if (!blockIds.length) return true;
  return mergeWindows(blockIds).some(([start, end]) => meeting.start >= start && meeting.end <= end);
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

// A Common Exam is a one-off block, not a weekly commitment, so it takes
// no part in scheduling: it never rules a section out under Screen 2's
// constraints and never counts as a conflict. It stays on the section so
// Screen 5 can still show it. Leaving it in the search rejected sections
// for the wrong reason — every CE 1337 lecture is Mon/Wed or Tue/Thu, but
// its Friday exam block meant "Fridays off" killed the whole course, and
// CS 2336's Friday 4:15pm exam block knocked out all eleven of its
// lectures for anyone who picked a time block other than "evening".
const isWeeklyMeeting = (m: Meeting) => m.kind !== "exam";

function sectionPasses(section, constraints) {
  return section.meetings.filter(isWeeklyMeeting).every((m) => meetingPasses(m, constraints));
}

function meetingsOverlap(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

// Counting the combinations and listing them are two different jobs, and
// trying to do both in one walk was what broke each of them.
//
// There can be a great many combinations: a real six-course load out of
// the Fall 2026 data has 51,209,280 conflict-free ones. Walking those one
// section at a time takes about ten seconds, and keeping each one as it
// was found put ~750MB on the heap of a browser tab. The old search gave
// up partway through and reported whatever it had counted so far — 26x
// short of the real answer, under a note calling it a slight undercount.
//
// So the two are split. The count runs over distinct *meeting patterns*:
// sections that meet at identical times are interchangeable for conflicts
// and for the daily-hours cap, differing only in who teaches them, so a
// leaf contributes the product of how many sections share each pattern it
// picked. That's exact, not a sample, and about 17x faster — 0.6s for
// that same 51 million.
//
// The browsable list is capped instead, since nobody pages through 51
// million schedules. Only the best MAX_BROWSABLE are kept, followed by a
// pass that makes sure no section a student could actually take is left
// out of the list entirely.
const COUNT_VISIT_LIMIT = 5_000_000;
const ENUMERATION_VISIT_LIMIT = 250_000;
const COVERAGE_VISIT_LIMIT = 20_000;
const MAX_BROWSABLE = 2_000;

type Option = { section: Section; meetings: Meeting[]; days: string[]; hours: number };
type Pattern = { meetings: Meeting[]; days: string[]; hours: number; size: number };
type ScheduleEntry = { code: string; section: Section };

// maxHoursPerDay is SCH, not clock time, and is enforced per calendar day
// as sections get picked, since it depends on which days the *specific*
// section meets.
function optionFits(
  option: { meetings: Meeting[]; days: string[]; hours: number },
  chosenMeetings: Meeting[],
  dayHours: Record<string, number>,
  maxHoursPerDay: number | null
) {
  if (option.meetings.some((m) => chosenMeetings.some((cm) => meetingsOverlap(cm, m)))) return false;
  if (maxHoursPerDay != null && option.days.some((d) => (dayHours[d] || 0) + option.hours > maxHoursPerDay)) return false;
  return true;
}

// Each section's schedulable meetings and the days it touches, worked out
// once rather than on every visit during the search.
function buildOptions(courseSectionLists: CourseSectionList[]): Option[][] {
  return courseSectionLists.map(({ sections, hours }) =>
    sections.map((section) => {
      const meetings = section.meetings.filter(isWeeklyMeeting);
      return { section, meetings, days: [...new Set(meetings.map((m) => m.day))], hours };
    })
  );
}

function buildPatterns(options: Option[][]): Pattern[][] {
  return options.map((courseOptions) => {
    const byShape = new Map<string, Pattern>();
    for (const option of courseOptions) {
      const key = option.meetings.map((m) => `${m.day}${m.start}-${m.end}`).sort().join(",");
      const seen = byShape.get(key);
      if (seen) seen.size++;
      else byShape.set(key, { meetings: option.meetings, days: option.days, hours: option.hours, size: 1 });
    }
    return [...byShape.values()];
  });
}

// Exact number of conflict-free combinations. `exact` only goes false if
// even the pattern-level walk runs past its limit, which no real course
// load in the current data comes close to.
function countCombinations(patterns: Pattern[][], maxHoursPerDay: number | null) {
  const order = [...patterns].sort((a, b) => a.length - b.length);
  const chosenMeetings: Meeting[] = [];
  const dayHours: Record<string, number> = {};
  let total = 0;
  let visits = 0;
  let exact = true;

  function recurse(i: number, sectionsPerLeaf: number) {
    if (!exact) return;
    if (visits++ > COUNT_VISIT_LIMIT) {
      exact = false;
      return;
    }
    if (i === order.length) {
      total += sectionsPerLeaf;
      return;
    }
    for (const pattern of order[i]) {
      if (!exact) return;
      if (!optionFits(pattern, chosenMeetings, dayHours, maxHoursPerDay)) continue;
      chosenMeetings.push(...pattern.meetings);
      pattern.days.forEach((d) => {
        dayHours[d] = (dayHours[d] || 0) + pattern.hours;
      });
      recurse(i + 1, sectionsPerLeaf * pattern.size);
      chosenMeetings.length -= pattern.meetings.length;
      pattern.days.forEach((d) => {
        dayHours[d] -= pattern.hours;
      });
    }
  }

  recurse(0, 1);
  return { total, exact };
}

// The highest-scoring schedules, bounded. Retention is capped rather than
// unbounded, so the heap holds MAX_BROWSABLE entries instead of every
// combination the walk happens to reach.
function collectBestSchedules(options: Option[][], codes: string[], maxHoursPerDay: number | null) {
  const chosen: Option[] = [];
  const chosenMeetings: Meeting[] = [];
  const dayHours: Record<string, number> = {};
  const kept: Array<{ score: number; schedule: ScheduleEntry[] }> = [];
  let currentScore = 0;
  let visits = 0;
  let capped = false;
  let cutoff = -Infinity;

  const snapshot = () => chosen.map((option, idx) => ({ code: codes[idx], section: option.section }));

  function compact() {
    kept.sort((a, b) => b.score - a.score);
    kept.length = Math.min(kept.length, MAX_BROWSABLE);
    cutoff = kept.length === MAX_BROWSABLE ? kept[kept.length - 1].score : -Infinity;
  }

  function recurse(i: number) {
    if (capped) return;
    if (visits++ > ENUMERATION_VISIT_LIMIT) {
      capped = true;
      return;
    }
    if (i === options.length) {
      // Once the list is full, only a strictly better score earns a slot.
      if (kept.length >= MAX_BROWSABLE && currentScore <= cutoff) return;
      kept.push({ score: currentScore, schedule: snapshot() });
      if (kept.length >= MAX_BROWSABLE * 2) compact();
      return;
    }
    for (const option of options[i]) {
      if (capped) return;
      if (!optionFits(option, chosenMeetings, dayHours, maxHoursPerDay)) continue;

      chosen.push(option);
      chosenMeetings.push(...option.meetings);
      currentScore += option.section.score || 0;
      option.days.forEach((d) => {
        dayHours[d] = (dayHours[d] || 0) + option.hours;
      });

      recurse(i + 1);

      chosen.pop();
      chosenMeetings.length -= option.meetings.length;
      currentScore -= option.section.score || 0;
      option.days.forEach((d) => {
        dayHours[d] -= option.hours;
      });
    }
  }

  recurse(0);
  compact();
  return { schedules: kept.map((k) => k.schedule), capped };
}

// One schedule that uses a specific section, or null if there isn't one.
function firstScheduleUsing(
  options: Option[][],
  codes: string[],
  maxHoursPerDay: number | null,
  courseIndex: number,
  required: Option
) {
  const chosen: Option[] = [];
  const chosenMeetings: Meeting[] = [];
  const dayHours: Record<string, number> = {};
  let visits = 0;
  let found: ScheduleEntry[] | null = null;

  function recurse(i: number) {
    if (found || visits++ > COVERAGE_VISIT_LIMIT) return;
    if (i === options.length) {
      found = chosen.map((option, idx) => ({ code: codes[idx], section: option.section }));
      return;
    }
    for (const option of i === courseIndex ? [required] : options[i]) {
      if (found) return;
      if (!optionFits(option, chosenMeetings, dayHours, maxHoursPerDay)) continue;

      chosen.push(option);
      chosenMeetings.push(...option.meetings);
      option.days.forEach((d) => {
        dayHours[d] = (dayHours[d] || 0) + option.hours;
      });

      recurse(i + 1);

      chosen.pop();
      chosenMeetings.length -= option.meetings.length;
      option.days.forEach((d) => {
        dayHours[d] -= option.hours;
      });
    }
  }

  recurse(0);
  return found;
}

// Nothing about "keep the best MAX_BROWSABLE" guarantees that a section a
// student could actually take shows up anywhere in the list — and since
// the walk stops partway, the courses searched first are the ones cut off
// soonest. That's how a browsable list ended up holding only 8 of BLAW
// 2301's 17 sections, hiding nine perfectly takeable options. Sections
// still missing get one schedule each; because that schedule covers its
// other courses' sections too, this settles quickly.
function coverMissingSections(
  options: Option[][],
  codes: string[],
  maxHoursPerDay: number | null,
  schedules: ScheduleEntry[][]
) {
  const seen = new Set<string>();
  for (const schedule of schedules) {
    schedule.forEach((entry, idx) => seen.add(`${idx}:${entry.section.sectionId}`));
  }

  const extra: ScheduleEntry[][] = [];
  for (let i = 0; i < options.length; i++) {
    for (const option of options[i]) {
      if (seen.has(`${i}:${option.section.sectionId}`)) continue;
      const schedule = firstScheduleUsing(options, codes, maxHoursPerDay, i, option);
      if (!schedule) continue;
      schedule.forEach((entry, idx) => seen.add(`${idx}:${entry.section.sectionId}`));
      extra.push(schedule);
    }
  }
  return extra;
}

function searchSchedules(courseSectionLists: CourseSectionList[], constraints: any) {
  const maxHoursPerDay = constraints.unlimitedDailyHours || !constraints.maxHoursPerDay ? null : Number(constraints.maxHoursPerDay);
  const codes = courseSectionLists.map((c) => c.code);
  const options = buildOptions(courseSectionLists);

  const { total, exact } = countCombinations(buildPatterns(options), maxHoursPerDay);
  const { schedules, capped } = collectBestSchedules(options, codes, maxHoursPerDay);
  // The list falls short of the full set two different ways — the walk
  // stopping early, and MAX_BROWSABLE trimming what it did find. Either
  // one can hide a section, so both have to trigger the coverage pass.
  const isSubset = capped || schedules.length < total;
  const extra = isSubset ? coverMissingSections(options, codes, maxHoursPerDay, schedules) : [];

  return {
    total,
    countExact: exact,
    // Best-scoring first, with the coverage schedules after them: they're
    // there so every option stays reachable, not because they rank.
    schedules: [...schedules, ...extra],
    schedulesCapped: isSubset,
  };
}

// Main entry point. courses: array of course codes from Screen 4's
// final picks (e.g. ["CS 1337", "MATH 2417", ...]). isHonors: whether
// the student can be placed into Honors-only sections (Screen 1) — for
// everyone else, Honors sections are dropped before scheduling so they
// never show up as an option.
export async function generateSchedules({
  courses,
  constraints,
  isHonors = false,
}: {
  courses: string[];
  constraints: any;
  isHonors?: boolean;
}) {
  const codes = [...new Set<string>(courses)];
  const parsedByCode = new Map<string, { prefix: string; number: string } | null>(
    codes.map((code) => [code, parseCode(code)])
  );
  const prefixes = [
    ...new Set(
      [...parsedByCode.values()]
        .filter((p): p is { prefix: string; number: string } => Boolean(p))
        .map((p) => p.prefix)
    ),
  ];

  const filesByPrefix: Record<string, any[] | null> = {};
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
    if (classified.status === "unreadable") {
      excluded.push({ code, reason: "Its Fall 2026 meeting times couldn't be read from the section data." });
      continue;
    }

    // Non-Honors students never see Honors sections at all. Honors
    // students keep both — Honors is an extra option, not a replacement.
    const honorsEligibleSections = isHonors ? classified.sections : classified.sections.filter((s) => !s.isHonors);
    if (!honorsEligibleSections.length) {
      console.log(`[scheduleCourses] ${code} only has Honors sections and student isn't an Honors student`);
      return { total: 0, blockedBy: code, blockedReason: "honors", excluded, example: null, schedules: [], countExact: true, schedulesCapped: false };
    }

    const timeValidSections = honorsEligibleSections.filter((s) => sectionPasses(s, constraints));
    if (!timeValidSections.length) {
      console.log(`[scheduleCourses] ${code} has no section that fits the time constraints`);
      return { total: 0, blockedBy: code, blockedReason: "time", excluded, example: null, schedules: [], countExact: true, schedulesCapped: false };
    }

    const codeNoSpace = `${parsed.prefix}${parsed.number}`;
    const validSections = timeValidSections.filter((s) => !sectionFailsHardFilter(s, codeNoSpace, constraints, ratingsMap));
    if (!validSections.length) {
      console.log(`[scheduleCourses] ${code} has no section meeting the grade/RMP preference`);
      return { total: 0, blockedBy: code, blockedReason: "preferences", excluded, example: null, schedules: [], countExact: true, schedulesCapped: false };
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
    return { total: 0, blockedBy: null, blockedReason: null, excluded, example: null, schedules: [], countExact: true, schedulesCapped: false };
  }

  resolved.sort((a, b) => a.sections.length - b.sections.length);
  const { total, countExact, schedules, schedulesCapped } = searchSchedules(resolved, constraints);

  return {
    total,
    countExact,
    blockedBy: null,
    blockedReason: null,
    excluded,
    example: schedules[0] || null,
    schedules,
    schedulesCapped,
  };
}
