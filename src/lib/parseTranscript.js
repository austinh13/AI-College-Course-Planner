/**
 * parseTranscript.js
 * ---------------------------------------------------------------------
 * Extracts completed courses from a UTD "Online Student Degree Audit"
 * PDF entirely in the browser, using pdf.js — no backend involved.
 *
 * This mirrors server/parse_transcript.py's extraction logic (verified
 * against a real degree audit: same 36/36 completed courses, same
 * grades/terms). The two differ only in *how* they get table structure:
 * the Python version uses pdfplumber's ruled-line table detection; this
 * version reconstructs rows from pdf.js's raw positioned text items
 * (group by Y-coordinate into visual rows, then pattern-match the
 * token sequence), since browsers don't have pdfplumber available.
 *
 * The audit repeats each course under every requirement it satisfies
 * via ruled "Courses Identified for This Requirement" tables. We scan
 * every such row across every page and de-duplicate by course code —
 * same approach as the Python script, and for the same reason: it's
 * more robust than parsing the borderless "Course History" summary
 * block at the end of the document.
 *
 * WHAT COUNTS AS "COMPLETED"
 *   Type EN (enrolled/earned), TE (transfer equivalent), or TR
 *   (transfer) with a real, passing grade. Type IP (in progress, blank
 *   grade — e.g. the student's current-term courses) is excluded.
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

const TERM_RE = /^\d{4}\s+(Fall|Spr|Sum\w*)$/i;
const TYPE_RE = /^(EN|TE|TR|IP)$/;
const UNITS_RE = /^\d+\.\d{2}$/;
const GRADE_RE = /^(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|CR|W|WF|WP|I|NC|AU)$/;
const COMPLETED_TYPES = new Set(["EN", "TE", "TR"]);
const NON_PASSING_GRADES = new Set(["F", "W", "WF", "WP", "I", "NC", "AU"]);

// Same-row items land within ~2pt of each other in Y; a wrapped title's
// continuation line sits one line-height (~9-10pt in this document)
// below its row, so 15pt safely separates "still this row's wrapped
// title" from "a new, unrelated line".
const ROW_Y_TOLERANCE = 2;
const CONTINUATION_Y_GAP = 15;

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

// A data row looks like: Term ~ Subject ~ CatalogNbr ~ Title... ~ [Grade] ~ Units ~ Type
// (Grade is absent for in-progress/IP rows.) Returns null if this row
// doesn't match that shape, e.g. it's a header, a section label, or a
// wrapped title continuation line.
function parseRow(tokens) {
  if (tokens.length < 5) return null;
  const type = tokens[tokens.length - 1];
  if (!TYPE_RE.test(type)) return null;
  const units = tokens[tokens.length - 2];
  if (!UNITS_RE.test(units)) return null;

  let idx = tokens.length - 3;
  let grade = "";
  if (idx >= 3 && GRADE_RE.test(tokens[idx])) {
    grade = tokens[idx];
    idx -= 1;
  }
  if (!TERM_RE.test(tokens[0])) return null;
  const subject = tokens[1];
  const catalogNbr = tokens[2];
  if (!subject || !catalogNbr) return null;
  const title = tokens.slice(3, idx + 1).join(" ");

  return { term: tokens[0], subject, catalogNbr, title, grade, units, type };
}

/**
 * Parses a transcript PDF File and returns a Map of course code
 * ("CS 3345") -> { term, title, grade, units, type, completed }.
 * Only completed courses are returned as `completed: true`; the
 * caller decides what to do with anything else.
 */
export async function extractCompletedCourses(file) {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const courses = new Map();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = groupIntoRows(content.items);

    let lastDataRow = null;
    for (const row of rows) {
      const tokens = row.items.map((i) => i.str.trim()).filter(Boolean);
      const parsed = parseRow(tokens);

      if (parsed) {
        const code = `${parsed.subject} ${parsed.catalogNbr}`;
        const isCompleted =
          COMPLETED_TYPES.has(parsed.type) && parsed.grade && !NON_PASSING_GRADES.has(parsed.grade);
        const existing = courses.get(code);
        // Keep the first sighting, but upgrade to a completed record if
        // a later duplicate (same course under a different requirement
        // table) turns out to be the completed one.
        if (!existing || (isCompleted && !existing.completed)) {
          courses.set(code, { ...parsed, code, completed: isCompleted });
        }
        lastDataRow = { code, y: row.y };
      } else if (lastDataRow && row.y > lastDataRow.y - CONTINUATION_Y_GAP && tokens.length <= 4) {
        // Wrapped title continuation — cosmetic only, doesn't affect
        // completion status. Guard against re-appending the same
        // continuation when this course also appears in a later table.
        const entry = courses.get(lastDataRow.code);
        const suffix = tokens.join(" ");
        if (entry && !entry.title.includes(suffix)) {
          entry.title = `${entry.title} ${suffix}`.trim();
        }
        lastDataRow = { code: lastDataRow.code, y: row.y };
      } else {
        lastDataRow = null;
      }
    }
  }

  return courses;
}

// Adjust if core_curriculum.json ends up served from a different path
// (mirrors the public/major-catalogs/ convention for degree catalogs).
export const CORE_CURRICULUM_URL = "/core-curriculum.json";

export async function loadCoreCurriculum(url = CORE_CURRICULUM_URL) {
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
 * Courses that only ever appear in 090's own list (no asterisk, no
 * other category) are assigned to 090 directly.
 *
 * @param {Map} courses - output of extractCompletedCourses()
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
  // Approximation: most core courses are 3 SCH, so a category's course
  // quota is credit_hours / 3. core_curriculum.json only carries hours
  // at the category level (not per course), so this is wrong for the
  // few categories mixing course sizes — e.g. 070 Government needs 6
  // SCH via GOVT 2107 (1 SCH) plus 3-hour courses, not two 3-hour
  // courses. Fixing that needs per-course SCH data we don't have yet.
  const neededCountByCategory = new Map();
  for (const category of coreCurriculum) {
    if (category.code === "090") continue;
    neededCountByCategory.set(category.code, Math.max(1, Math.round(category.credit_hours / 3)));
    for (const course of category.courses) {
      if (!primaryCategoryByCourse.has(course.code)) {
        primaryCategoryByCourse.set(course.code, category.code);
      }
      if (course.has_asterisk) asteriskEligibleForNinety.add(course.code);
    }
  }

  const ninety = coreCurriculum.find((c) => c.code === "090");
  const ninetyOwnCodes = new Set((ninety?.courses ?? []).map((c) => c.code));

  // Pass 1: assign every completed course to its primary category.
  const assignment = new Map();
  for (const code of completedCodes) {
    if (primaryCategoryByCourse.has(code)) {
      assignment.set(code, primaryCategoryByCourse.get(code));
    } else if (ninetyOwnCodes.has(code)) {
      assignment.set(code, "090");
    }
  }

  // Pass 2: within each primary category, keep only as many courses as
  // its SCH quota needs. Once a category's quota is met, any further
  // asterisk-eligible course in it is surplus and gets freed up for
  // 090 instead. Earliest-encountered courses fill the quota first.
  const countSoFarByCategory = new Map();
  for (const code of completedCodes) {
    const category = assignment.get(code);
    if (!category || category === "090") continue;
    const needed = neededCountByCategory.get(category) ?? Infinity;
    const soFar = countSoFarByCategory.get(category) ?? 0;
    if (soFar < needed) {
      countSoFarByCategory.set(category, soFar + 1);
    } else if (asteriskEligibleForNinety.has(code)) {
      assignment.set(code, "090");
    }
    // If the category is already full and this course isn't
    // asterisk-eligible, it just stays in its primary category —
    // there's nowhere else for it to go.
  }

  const byCategory = {};
  for (const [code, categoryCode] of assignment) {
    (byCategory[categoryCode] ??= []).push(courses.get(code));
  }

  return { assignment, byCategory };
}
