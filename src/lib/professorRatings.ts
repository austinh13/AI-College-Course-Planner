/**
 * professorRatings.js
 * ---------------------------------------------------------------------
 * Screen 2's grade/RMP-importance preferences (Step 4) need real
 * per-professor data to act on. This reads /raw_data/matched_professor_data.json
 * — a name -> [record] map that already merges historical grade
 * distributions (public/raw_data/*.csv) with RateMyProfessors data, so
 * there's no need to re-parse the raw CSVs here.
 *
 * Matching: CourseBook's `instructors` field is already "First [Middle]
 * Last" (comma-separated for team-taught sections), which is the same
 * order matched_professor_data.json's keys use — so a plain
 * lowercase/trim is enough, no fuzzy matching. Filtering and scoring read
 * only the first name in that list; see primaryInstructor below.
 */

// Grade ratings in the data run on UTD's grade-point scale, 0-4.0 (no
// bonus for A+ — it's worth the same 4.0 as a plain A). RMP
// quality_rating runs 0-5. Used to normalize both onto 0-1 for
// combining into one preference score.
const GRADE_SCALE_MAX = 4.0;
const RMP_SCALE_MAX = 5;

// User-supplied minimum GPA/RMP cutoffs (Step 2's numeric inputs) rather
// than a fixed preset — they type the actual threshold on the same scale
// the data uses. Sections taught by an instructor with no data on record
// are never excluded, since absence of data isn't evidence of a bad
// grade/rating.

let _cache = null;

export async function loadProfessorRatings(url = "/raw_data/matched_professor_data.json") {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load professor ratings: ${res.status}`);
  _cache = await res.json();
  return _cache;
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// courseCode: "CS4375" style (prefix+number, no space, uppercase) —
// matches how matched_professor_data.json's course_ratings keys are
// formatted. Falls back from the course-specific grade average to the
// professor's overall average when this exact course isn't on record.
// `gradeIsCourseSpecific` tells callers (e.g. Screen 5's display) which
// case applied, so a fallback number isn't shown as if it were specific
// to this course.
export function getInstructorRating(name, courseCode, ratingsMap) {
  const entries = ratingsMap[normalizeName(name)];
  if (!entries) return { gradeRating: null, gradeIsCourseSpecific: false, gradeSemesterCount: null, rmpQuality: null };

  let gradeRating = null;
  let gradeIsCourseSpecific = false;
  let gradeSemesterCount = null;
  for (const e of entries) {
    if (e.course_ratings && courseCode in e.course_ratings) {
      gradeRating = e.course_ratings[courseCode];
      gradeIsCourseSpecific = true;
      // How many semesters (2019-2025, the CSVs this app has on record) this
      // course-specific GPA is actually built from — a 4.0 from one semester
      // reads very differently than a 4.0 from ten (Screen 5's display).
      gradeSemesterCount = e.course_semester_counts?.[courseCode] ?? null;
      break;
    }
  }
  if (gradeRating == null) {
    const withOverall = entries.find((e) => typeof e.overall_grade_rating === "number");
    if (withOverall) gradeRating = withOverall.overall_grade_rating;
  }

  const withRmp = entries.find((e) => typeof e.quality_rating === "number");
  const rmpQuality = withRmp ? withRmp.quality_rating : null;

  return { gradeRating, gradeIsCourseSpecific, gradeSemesterCount, rmpQuality };
}

// Only the primary instructor (Instructor 1, the first name CourseBook
// lists) is judged, matching the rule the grade distributions themselves
// are built under. The rest of that field is co-instructors, section
// leads and lab staff, and a distribution doesn't belong to them. Letting
// any name on the roster veto a section threw away real options: CS
// 4485's only Fall 2026 section lists six people, and one of them at a
// 2.17 blocked the course outright even though its primary instructor
// sits at 3.79 in that very course.
export function primaryInstructor(section) {
  return (section.instructors || [])[0] || null;
}

// True if this section should be excluded outright under the user's
// minimum GPA/RMP cutoffs. A blank ("") cutoff never excludes anything.
// Only known-bad data disqualifies a section — an unmatched/no-data
// instructor (new hire, Staff, etc.) always passes.
export function sectionFailsHardFilter(section, courseCode, constraints, ratingsMap) {
  const primary = primaryInstructor(section);
  if (!primary) return false;

  const { gradeRating, rmpQuality } = getInstructorRating(primary, courseCode, ratingsMap);

  const gradeThreshold = constraints.minGpa === "" || constraints.minGpa == null ? null : Number(constraints.minGpa);
  if (gradeThreshold != null && gradeRating != null && gradeRating < gradeThreshold) return true;

  const rmpThreshold = constraints.minRmp === "" || constraints.minRmp == null ? null : Number(constraints.minRmp);
  if (rmpThreshold != null && rmpQuality != null && rmpQuality < rmpThreshold) return true;

  return false;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Ranking score used to pick the best-scoring valid schedule out of
// every conflict-free combination (see scheduleCourses.js). Entering a
// cutoff also puts weight on ranking sections higher above that bar;
// leaving both cutoffs blank returns 0, so the search falls back to its
// old first-found behavior untouched.
//
// Scored on the primary instructor alone, for the same reason
// sectionFailsHardFilter filters on it — averaging a roster dragged every
// team-taught section toward the 0.5 no-data default no matter who
// actually teaches it.
export function sectionPreferenceScore(section, courseCode, constraints, ratingsMap) {
  const gradeWeight = constraints.minGpa === "" || constraints.minGpa == null ? 0 : 1;
  const rmpWeight = constraints.minRmp === "" || constraints.minRmp == null ? 0 : 1;
  if (!gradeWeight && !rmpWeight) return 0;

  const primary = primaryInstructor(section);
  if (!primary) return gradeWeight * 0.5 + rmpWeight * 0.5;

  const { gradeRating, rmpQuality } = getInstructorRating(primary, courseCode, ratingsMap);
  const gradeScore = gradeRating != null ? clamp01(gradeRating / GRADE_SCALE_MAX) : 0.5;
  const rmpScore = rmpQuality != null ? clamp01(rmpQuality / RMP_SCALE_MAX) : 0.5;
  return gradeWeight * gradeScore + rmpWeight * rmpScore;
}

// https://trends.utdnebula.com/dashboard?searchTerms=John+Cole&availability=26F
export function rmpProfileUrl(name, term) {
  const params = new URLSearchParams({ searchTerms: name, availability: String(term || "").toUpperCase() });
  return `https://trends.utdnebula.com/dashboard?${params.toString()}`;
}
