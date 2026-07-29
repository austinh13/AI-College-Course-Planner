/**
 * parseTranscript.js
 * ---------------------------------------------------------------------
 * Extracts completed courses from a UTD "Unofficial Transcript" PDF
 * entirely in the browser, using pdf.js — no backend involved.
 *
 * DOCUMENT SHAPE
 *   Three source blocks carry course rows: "Transfer Credits", "Test
 *   Credits", and "Beginning of Undergraduate Record" (each broken into
 *   per-term sub-blocks, e.g. "2024 Fall"). "Academic Program History"
 *   and "Non-Course Milestones" carry no course data and are skipped.
 *
 *   A course row is: Subject CatalogNbr Description... Attempted Earned
 *   [Grade] Points — Grade is omitted for in-progress rows (blank grade
 *   column). Beginning-of-Record rows are optionally followed by a
 *   "Req Designation: Core - 0XX ..." line (which Core Curriculum
 *   category the course satisfies) and one or more "Instructor:" lines
 *   (name, plus bare continuation lines for co-instructors). Neither
 *   wraps to a second line in this document, so unlike the old
 *   Degree-Audit parser this version doesn't need continuation-line
 *   stitching for course titles.
 *
 * COMPLETED VS. IN-PROGRESS
 *   There's no Type column (EN/TE/TR/IP) in this format. A course
 *   counts as completed if its Grade is present and isn't a
 *   withdrawal/incomplete grade. Transfer Credits and Test Credits rows
 *   always carry a grade (letter grade or "CR") and are always
 *   completed; only Beginning-of-Record rows can be in-progress (blank
 *   grade, 0 hours earned — e.g. the student's current-term courses).
 *
 * REQUIRES: pdfjs-dist (`npm install pdfjs-dist`). Not bundled with the
 * rest of this project since it's a sizeable dependency (~2-3MB) only
 * needed on this one screen.
 *
 * Also exports assignCoreCategories(), which maps completed courses to
 * their UT Dallas Core Curriculum category (010-090), using the parsed
 * core_curriculum.json. Kept separate from extraction: it needs a
 * second data source (the core curriculum catalog) and a different
 * caller (the Academic History screen, not the upload step).
 * ---------------------------------------------------------------------
 */
import * as pdfjsLib from "pdfjs-dist";

// Loading the worker via a bundler import path (e.g. Vite's `?url`
// suffix) is notoriously fragile across pdfjs-dist/bundler version
// combinations — it depends on exact node_modules file layout that
// varies between versions. Pointing at jsDelivr's npm CDN mirror
// instead sidesteps that entirely: no local resolution involved, it
// can't drift out of sync with the installed package since
// pdfjsLib.version always matches package.json, and jsDelivr mirrors
// every published npm version automatically (verified this exact URL
// pattern resolves, unlike cdnjs which curates its library list
// manually and lags behind for less-common packages).
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const TERM_HEADER_RE = /^\d{4}\s+(Fall|Spring|Summer\w*)$/i;
const SUBJECT_RE = /^[A-Z]{2,5}$/; // real subject codes are all-caps; summary-line labels ("Term GPA", "Cum Totals", ...) are Title/mixed case, so this alone filters them out
const CATALOG_NBR_RE = /^\d[\d-]{2,3}$/; // matches normal 4-digit numbers ("2305") and the odd placeholder ("2---")
const NUM_RE = /^\d+\.\d{3}$/; // Attempted/Earned/Points are always X.XXX in this document
const GRADE_RE = /^(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|CR|W|WF|WP|I|NC|AU)$/;
const NON_PASSING_GRADES = new Set(["F", "W", "WF", "WP", "I", "NC", "AU"]);
const CORE_CODE_RE = /\b0[1-9]0\b/g; // 010-090

// Same-row items land within ~2pt of each other in Y.
const ROW_Y_TOLERANCE = 2;

function groupIntoRows(items) {
  const rows = [];
  const sorted = [...items].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
  );
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= ROW_Y_TOLERANCE);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  rows.forEach((r) => r.items.sort((a, b) => a.transform[4] - b.transform[4]));
  rows.sort((a, b) => b.y - a.y);
  return rows;
}

// A course row looks like: Subject ~ CatalogNbr ~ Description... ~
// Attempted ~ Earned ~ [Grade] ~ Points. Returns null for anything else
// (table headers, GPA summary lines, institution/term sub-headers,
// "Instructor:"/"Req Designation:" lines) — those all fail one of the
// checks below (most fail on Subject not being all-caps, since summary
// labels like "Term GPA" or "Cum Totals" are Title Case).
function parseDataRow(tokens) {
  if (tokens.length < 6) return null;
  let idx = tokens.length - 1;

  const points = tokens[idx];
  if (!NUM_RE.test(points)) return null;
  idx -= 1;

  let grade = "";
  if (idx >= 0 && GRADE_RE.test(tokens[idx])) {
    grade = tokens[idx];
    idx -= 1;
  }

  if (idx < 0 || !NUM_RE.test(tokens[idx])) return null;
  const earned = tokens[idx];
  idx -= 1;

  if (idx < 0 || !NUM_RE.test(tokens[idx])) return null;
  idx -= 1; // attempted, unused beyond validating the row shape

  if (idx < 2) return null; // need Subject + CatalogNbr + at least 1 description word left
  const subject = tokens[0];
  if (!SUBJECT_RE.test(subject)) return null;
  const catalogNbr = tokens[1];
  if (!CATALOG_NBR_RE.test(catalogNbr)) return null;
  const description = tokens.slice(2, idx + 1).join(" ");
  if (!description) return null;

  return { subject, catalogNbr, description, earned, grade, points };
}

// Extracts Core Curriculum category codes ("070", or ["020","090"] for a
// Component-Area-eligible course) from a "Req Designation: Core - ..."
// line. Returns null if this row isn't a Req Designation line at all
// (so the caller can tell "not one of these" apart from "one of these,
// but no codes found in it").
function extractReqDesignationCodes(rowText) {
  if (!/^Req\s*Designation:?/i.test(rowText)) return null;
  const codes = rowText.match(CORE_CODE_RE);
  return codes ? [...new Set(codes)] : [];
}

/**
 * Parses already-loaded pdf.js page content into a Map of course code
 * ("CS 3345") -> course record. Split out from extractCompletedCourses()
 * so it's testable without a browser File object.
 */
export async function extractFromDocument(doc) {
  const courses = new Map();

  // These persist across pages, not just within one — sections (esp.
  // "Beginning of Undergraduate Record") span multiple pages but their
  // heading only appears once, on the page where the section starts.
  let currentSection = null; // 'transfer' | 'test' | 'record' | null
  let currentTerm = null;
  let lastCourseCode = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = groupIntoRows(content.items);

    for (const row of rows) {
      const tokens = row.items.map((i) => i.str.trim()).filter(Boolean);
      if (!tokens.length) continue;
      const rowText = tokens.join(" ");

      if (/^Transfer Credits$/i.test(rowText)) {
        currentSection = "transfer";
        lastCourseCode = null;
        continue;
      }
      if (/^Test Credits$/i.test(rowText)) {
        currentSection = "test";
        lastCourseCode = null;
        continue;
      }
      if (/^Beginning of Undergraduate Record$/i.test(rowText)) {
        currentSection = "record";
        lastCourseCode = null;
        continue;
      }
      if (/^(Academic Program History|Non-Course Milestones|Undergraduate Career Totals)$/i.test(rowText)) {
        currentSection = null;
        lastCourseCode = null;
        continue;
      }
      if (TERM_HEADER_RE.test(rowText)) {
        currentTerm = rowText;
        continue;
      }
      if (!currentSection) continue; // header/bio block above Transfer Credits, or a skipped section

      const reqCodes = extractReqDesignationCodes(rowText);
      if (reqCodes !== null) {
        if (reqCodes.length && lastCourseCode && courses.has(lastCourseCode)) {
          courses.get(lastCourseCode).reqDesignationCodes = reqCodes;
        }
        continue;
      }

      const parsed = parseDataRow(tokens);
      if (!parsed) continue; // "Instructor:" lines, GPA/term summary rows, etc.

      const code = `${parsed.subject} ${parsed.catalogNbr}`;
      const completed = !!parsed.grade && !NON_PASSING_GRADES.has(parsed.grade);
      const record = {
        code,
        subject: parsed.subject,
        catalogNbr: parsed.catalogNbr,
        title: parsed.description,
        term: currentTerm,
        grade: parsed.grade,
        earned: Number(parsed.earned),
        completed,
        source: currentSection, // 'transfer' | 'test' | 'record'
        reqDesignationCodes: [],
      };

      // Keep the first sighting, but upgrade to a completed record if a
      // later duplicate turns out to be the completed one.
      const existing = courses.get(code);
      if (!existing || (completed && !existing.completed)) {
        courses.set(code, record);
      }
      lastCourseCode = code;
    }
  }

  logParsedCourses(courses);
  return courses;
}

// Every course pdf.js found, straight out of the parser — independent of
// whatever the caller does with it afterward.
function logParsedCourses(courses) {
  const rows = [...courses.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => ({
      code: c.code,
      title: c.title,
      term: c.term,
      source: c.source,
      grade: c.grade || "(blank)",
      earned: c.earned,
      completed: c.completed,
    }));
  console.log(`[parseTranscript] parsed ${rows.length} course rows:`);
  console.table(rows);
  const completedHours = rows.filter((r) => r.completed).reduce((s, r) => s + r.earned, 0);
  const inProgressHours = rows.filter((r) => !r.completed).reduce((s, r) => s + r.earned, 0);
  console.log(
    `[parseTranscript] ${rows.filter((r) => r.completed).length} completed (${completedHours} hrs), ` +
      `${rows.filter((r) => !r.completed).length} in-progress (${inProgressHours} hrs)`
  );
}

export async function extractCompletedCourses(file) {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  return extractFromDocument(doc);
}

// UTD_YEAR/Core_YEAR.json — mirrors the UTD_YEAR/Major_Parsed_YEAR/
// convention for degree catalogs, so it's still fetched via a path
// under public/ that Vite serves statically.
export function coreCurriculumUrl(startYear) {
  return `/UTD_${startYear}/Core_${startYear}.json`;
}

export async function loadCoreCurriculum(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load core curriculum: ${res.status}`);
  return res.json();
}

/**
 * Maps completed courses to the Core Curriculum category (010-090) each
 * one fulfills.
 *
 * A course can appear in exactly one 010-080 category's course list; if
 * it's asterisk-marked there, it's ALSO eligible for 090 (Component
 * Area Option) instead. Assignment rule: a course fills its primary
 * (010-080) category first. It's only reassigned to 090 if that
 * primary category is already filled by a *different* completed
 * course — i.e. it's not needed there.
 *
 * When a course record carries `reqDesignationCodes` (parsed straight
 * off the transcript's own "Req Designation: Core - 0XX" line), that's
 * trusted as the primary category instead of the course-code lookup —
 * it's the registrar's own answer for that specific enrollment, so it
 * takes priority. The lookup/SCH-quota logic below is a fallback for
 * courses without one (Transfer Credits and Test Credits rows never
 * carry a Req Designation, and some Beginning-of-Record rows don't
 * either — e.g. courses that aren't core requirements at all).
 *
 * Courses that only ever appear in 090's own list (no asterisk, no
 * other category) are assigned to 090 directly.
 *
 * @param {Map} courses - output of extractFromDocument()/extractCompletedCourses()
 * @param {Array} coreCurriculum - parsed core_curriculum.json
 * @returns {{ assignment: Map<string,string>, byCategory: Object<string, Array> }}
 *   assignment: courseCode -> categoryCode ("010".."090")
 *   byCategory: categoryCode -> array of course records
 */
export function assignCoreCategories(courses, coreCurriculum) {
  const completedCodes = [...courses.values()]
    .filter((c) => c.completed)
    .map((c) => c.code);

  const primaryCategoryByCourse = new Map();
  const asteriskEligibleForNinety = new Set();
  const targetHoursByCategory = new Map();
  for (const category of coreCurriculum) {
    if (category.code === "090") continue;
    targetHoursByCategory.set(category.code, category.credit_hours);
    for (const course of category.courses) {
      if (!primaryCategoryByCourse.has(course.code)) {
        primaryCategoryByCourse.set(course.code, category.code);
      }
      if (course.has_asterisk) asteriskEligibleForNinety.add(course.code);
    }
  }

  const ninety = coreCurriculum.find((c) => c.code === "090");
  const ninetyOwnCodes = new Set((ninety?.courses ?? []).map((c) => c.code));

  // Pass 1: assign every completed course to its primary category —
  // the transcript's own Req Designation when present, else the
  // course-code lookup.
  const assignment = new Map();
  for (const code of completedCodes) {
    const course = courses.get(code);
    if (course.reqDesignationCodes?.length) {
      assignment.set(code, course.reqDesignationCodes[0]);
    } else if (primaryCategoryByCourse.has(code)) {
      assignment.set(code, primaryCategoryByCourse.get(code));
    } else if (ninetyOwnCodes.has(code)) {
      assignment.set(code, "090");
    }
  }

  // Pass 2: within each primary category, keep courses only up to its
  // real SCH target — using each course's actual earned hours from the
  // transcript, not an assumed average course size, so categories that
  // mix course sizes (e.g. 070 Government: GOVT 2107 at 1 SCH plus
  // 3-hour courses) are handled correctly rather than approximated.
  // Once a category's target is met, any further 090-eligible course in
  // it (via Req Designation or the asterisk flag) is surplus and gets
  // freed up for 090 instead. Earliest-encountered courses fill the
  // target first.
  const filledHoursByCategory = new Map();
  for (const code of completedCodes) {
    const category = assignment.get(code);
    if (!category || category === "090") continue;
    const course = courses.get(code);
    const eligibleForNinety =
      course.reqDesignationCodes?.includes("090") || asteriskEligibleForNinety.has(code);
    const target = targetHoursByCategory.get(category) ?? Infinity;
    const filledSoFar = filledHoursByCategory.get(category) ?? 0;
    if (filledSoFar < target) {
      filledHoursByCategory.set(category, filledSoFar + course.earned);
    } else if (eligibleForNinety) {
      assignment.set(code, "090");
    }
    // If the category is already full and this course isn't
    // 090-eligible, it just stays in its primary category — there's
    // nowhere else for it to go.
  }

  const byCategory = {};
  for (const [code, categoryCode] of assignment) {
    (byCategory[categoryCode] ??= []).push(courses.get(code));
  }

  return { assignment, byCategory };
}
