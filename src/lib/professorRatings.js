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
 * lowercase/trim is enough, no fuzzy matching.
 */

// Grade ratings in the data run on UTD's grade-point scale, 0-4.0 (no
// bonus for A+ — it's worth the same 4.0 as a plain A). RMP
// quality_rating runs 0-5. Used to normalize both onto 0-1 for
// combining into one preference score.
const GRADE_SCALE_MAX = 4.0;
const RMP_SCALE_MAX = 5;

// Hard-filter cutoffs, applied at levels 2 ("Somewhat") and 3 ("Very
// Important") — level 1 ("None") never excludes anything. Level 3 is
// strictly tighter than level 2 on both scales. Sections taught by an
// instructor with no data on record are never excluded, since absence
// of data isn't evidence of a bad grade/rating.
export const GRADE_HARD_FILTER_THRESHOLDS = { 2: 3.2, 3: 3.49 };
export const RMP_HARD_FILTER_THRESHOLDS = { 2: 3.0, 3: 3.5 };

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
  if (!entries) return { gradeRating: null, gradeIsCourseSpecific: false, rmpQuality: null };

  let gradeRating = null;
  let gradeIsCourseSpecific = false;
  for (const e of entries) {
    if (e.course_ratings && courseCode in e.course_ratings) {
      gradeRating = e.course_ratings[courseCode];
      gradeIsCourseSpecific = true;
      break;
    }
  }
  if (gradeRating == null) {
    const withOverall = entries.find((e) => typeof e.overall_grade_rating === "number");
    if (withOverall) gradeRating = withOverall.overall_grade_rating;
  }

  const withRmp = entries.find((e) => typeof e.quality_rating === "number");
  const rmpQuality = withRmp ? withRmp.quality_rating : null;

  return { gradeRating, gradeIsCourseSpecific, rmpQuality };
}

// True if this section should be excluded outright under the current
// grade/RMP preference. Level 1 never excludes; levels 2 and 3 each
// have their own (increasingly strict) cutoff — see the thresholds
// above. Only known-bad data disqualifies a section — unmatched/no-data
// instructors (new hires, Staff, etc.) always pass.
export function sectionFailsHardFilter(section, courseCode, constraints, ratingsMap) {
  const names = section.instructors || [];
  if (!names.length) return false;

  const gradeThreshold = GRADE_HARD_FILTER_THRESHOLDS[Number(constraints.gradeImportance)];
  if (gradeThreshold != null) {
    for (const name of names) {
      const { gradeRating } = getInstructorRating(name, courseCode, ratingsMap);
      if (gradeRating != null && gradeRating < gradeThreshold) return true;
    }
  }
  const rmpThreshold = RMP_HARD_FILTER_THRESHOLDS[Number(constraints.rmpImportance)];
  if (rmpThreshold != null) {
    for (const name of names) {
      const { rmpQuality } = getInstructorRating(name, courseCode, ratingsMap);
      if (rmpQuality != null && rmpQuality < rmpThreshold) return true;
    }
  }
  return false;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Ranking score used to pick the best-scoring valid schedule out of
// every conflict-free combination (see scheduleCourses.js). Levels 1/2/3
// map to weights 0/0.5/1; if both preferences are left at "Doesn't
// matter" this always returns 0, so the search falls back to its old
// first-found behavior untouched.
export function sectionPreferenceScore(section, courseCode, constraints, ratingsMap) {
  const gradeWeight = (Number(constraints.gradeImportance || 1) - 1) / 2;
  const rmpWeight = (Number(constraints.rmpImportance || 1) - 1) / 2;
  if (!gradeWeight && !rmpWeight) return 0;

  const names = section.instructors || [];
  if (!names.length) return gradeWeight * 0.5 + rmpWeight * 0.5;

  let gradeSum = 0;
  let rmpSum = 0;
  for (const name of names) {
    const { gradeRating, rmpQuality } = getInstructorRating(name, courseCode, ratingsMap);
    gradeSum += gradeRating != null ? clamp01(gradeRating / GRADE_SCALE_MAX) : 0.5;
    rmpSum += rmpQuality != null ? clamp01(rmpQuality / RMP_SCALE_MAX) : 0.5;
  }
  const gradeAvg = gradeSum / names.length;
  const rmpAvg = rmpSum / names.length;
  return gradeWeight * gradeAvg + rmpWeight * rmpAvg;
}

// https://trends.utdnebula.com/dashboard?searchTerms=John+Cole&availability=26F
export function rmpProfileUrl(name, term) {
  const params = new URLSearchParams({ searchTerms: name, availability: String(term || "").toUpperCase() });
  return `https://trends.utdnebula.com/dashboard?${params.toString()}`;
}
