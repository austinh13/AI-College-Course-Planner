/**
 * Step3AcademicHistory
 * ---------------------------------------------------------------------
 * Third screen in the Comet Planner flow. After the general-info screen
 * (major, catalog year, etc.), this screen lets the student either
 * upload a transcript or manually check off courses they've completed,
 * against the full graduation requirement list for their major.
 *
 * INTEGRATION
 *   Props (controlled — state is lifted to the parent, same pattern as
 *   QuestionnaireStep/TimeConstraintsStep, so progress survives Back
 *   navigation):
 *     major          (string, required) - bare major name matching a key
 *                    in utd_degrees.json, e.g. "Computer Science" (NOT
 *                    "Computer Science (BS)"). The component looks up
 *                    that major's undergrad degree type(s) (BA/BS) from
 *                    utd_degrees.json's "levels" field, appends it, then
 *                    slugifies the same way scrape_major_pdfs.py names
 *                    its output files ("Computer_Science_BS.json") to
 *                    fetch the right catalog. If a major has more than
 *                    one undergrad type on file (e.g. Economics: BA and
 *                    BS), the user is asked to pick one on this screen.
 *                    Known gap: utd_degrees.json currently lists only a
 *                    BS level for Biology even though both
 *                    Biology_BA.json and Biology_BS.json exist — the BA
 *                    catalog can't be auto-resolved until that entry is
 *                    corrected upstream.
 *     completed      (Set<string>)   - checked course codes.
 *     manualEntries  (object)        - { "<sectionIndex>-<groupIndex>":
 *                    [{ id, code, hours }] } for requirement groups with
 *                    no explicit course list.
 *     onChange       (function({completed, manualEntries})) - called on
 *                    every checkbox toggle or manual add/remove.
 *     onBack         (function)      - called when Back is pressed.
 *     onContinue     (function({completedCodes, hoursEarned, hoursLeft,
 *                    totalHours})) - called when Continue is pressed.
 *
 *   Backend requirement:
 *     Major_Catalogs_Parsed/ must be statically served at CATALOG_BASE_URL
 *     below. Example (Express):
 *       app.use("/major-catalogs", express.static(
 *         path.join(__dirname, "Major_Catalogs_Parsed")
 *       ));
 *     Adjust CATALOG_BASE_URL if your static path differs.
 *
 *   Transcript parsing:
 *     Uploaded PDFs are parsed entirely in the browser via pdf.js (see
 *     ../lib/parseTranscript.js) — no backend involved. It only
 *     recognizes UTD's own "Online Student Degree Audit" export format
 *     (Academic Requirements > Degree Audit in the student portal), not
 *     arbitrary transcripts. Non-PDF uploads (image formats are still
 *     accepted by the file picker) and PDFs that don't match that
 *     format fall back to the old "please confirm manually" message
 *     rather than failing silently.
 *
 *   Requirement groups with no explicit course list (e.g. "Free
 *   Electives", "Major Technical Electives") get a manual entry form
 *   instead of checkboxes, since the parsed catalog has no course list
 *   to check off. Users add one class at a time (code + credit hours)
 *   until the group's listed SCH target is met.
 *
 *   "Hours left" is computed at the requirement-group level, not per
 *   course, because the parsed catalogs only carry an aggregate SCH
 *   value per group, never per individual course. A group counts
 *   toward "hours earned" once satisfied (all its listed courses
 *   checked, or manual entries reaching its SCH target). Groups whose
 *   credit_hours is null (target not present in the catalog data, most
 *   often "choice: true" elective pools whose real SCH lives on a
 *   sibling group) are excluded from the hours math entirely so they
 *   can't silently under- or over-count.
 * ---------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from "react";
import utdDegrees from "../data/utd_degrees.json";
import { extractCompletedCourses } from "../lib/parseTranscript";
import "./AcademicHistory.css";

const CATALOG_BASE_URL = "/Major_Catalogs_Parsed";

// utd_degrees.json (the Step 1 major dropdown) stores bare major names,
// e.g. "Computer Science" — but the parsed catalogs are keyed by name
// *and* degree type, e.g. "Computer Science (BS)" -> Computer_Science_BS.json.
// This derives the undergrad degree type(s) (BA/BS) on file for a given
// major so we can build the right catalog filename instead of guessing.
//
// The Step 1 major field is free-text — the user can type anything and
// hit Continue without picking an autocomplete suggestion, so what lands
// in `major` here isn't guaranteed to byte-for-byte match a
// utd_degrees.json key (case, stray whitespace, etc.). We resolve
// case-insensitively/trimmed against the known keys instead of doing an
// exact lookup, so a typed "computer science " still finds "Computer Science".
const NORMALIZED_MAJOR_KEYS = Object.keys(utdDegrees).reduce((map, key) => {
  map[key.trim().toLowerCase().replace(/\s+/g, " ")] = key;
  return map;
}, {});

function resolveMajorKey(majorName) {
  if (!majorName) return null;
  return NORMALIZED_MAJOR_KEYS[majorName.trim().toLowerCase().replace(/\s+/g, " ")] || null;
}

function undergradDegreeTypes(majorName) {
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

// Parsed credit_hours values are strings and are sometimes a range
// ("19-22") or null. We use the low end of a range so "hours left"
// never under-counts remaining work, and null means "unknown target"
// (excluded from the hours math, see doc comment above).
function parseHours(value) {
  if (value == null) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function slugify(majorName) {
  // Mirrors sanitize_filename() in scrape_major_pdfs.py
  return majorName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function optionSatisfied(option, completed) {
  if (!completed.has(option.code)) return false;
  return option.with.every((w) => completed.has(w.code));
}

function groupSatisfied(group, completed) {
  if (!group.courses.length) return false;
  const satisfiesSlot = (opt) =>
    optionSatisfied(opt, completed) ||
    opt.alternatives.some((alt) => optionSatisfied(alt, completed));
  // choice: true groups are a pool to pick some number of courses from
  // (any one counts as progress). choice: false groups list every
  // course actually required, so all of them must be checked off.
  return group.choice
    ? group.courses.some(satisfiesSlot)
    : group.courses.every(satisfiesSlot);
}

function collectAllCodes(catalog) {
  const codes = new Set();
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

function matchesSearch(option, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hit = (c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
  if (hit(option)) return true;
  if (option.with.some(hit)) return true;
  if (option.alternatives.some((a) => hit(a) || a.with.some(hit))) return true;
  return false;
}

function CourseOption({ option, completed, onToggle, isAlternative }) {
  const satisfied = optionSatisfied(option, completed);
  return (
    <div className="s3-option">
      {isAlternative && <span className="s3-connector s3-connector--or">or</span>}
      <label className={`s3-row${satisfied ? " s3-row--done" : ""}`}>
        <input
          type="checkbox"
          checked={completed.has(option.code)}
          onChange={() => onToggle(option.code)}
        />
        <span className="s3-check" aria-hidden="true" />
        <span className="s3-code">{option.code}</span>
        <span className="s3-title">{option.title}</span>
      </label>

      {option.with.map((w) => (
        <label key={w.code} className="s3-row s3-row--with">
          <span className="s3-connector s3-connector--and">+</span>
          <input
            type="checkbox"
            checked={completed.has(w.code)}
            onChange={() => onToggle(w.code)}
          />
          <span className="s3-check" aria-hidden="true" />
          <span className="s3-code">{w.code}</span>
          <span className="s3-title">{w.title}</span>
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

function RequirementGroup({ group, completed, onToggle, query }) {
  const visibleCourses = group.courses.filter((opt) => matchesSearch(opt, query));
  if (query && visibleCourses.length === 0) return null;

  const satisfied = groupSatisfied(group, completed);

  return (
    <div className="s3-group">
      <div className="s3-group-header">
        <span className={`s3-group-dot${satisfied ? " s3-group-dot--done" : ""}`} />
        <span className="s3-group-label">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="s3-group-hours">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="s3-group-desc">{group.description}</p>}
      {visibleCourses.map((opt) => (
        <CourseOption key={opt.code} option={opt} completed={completed} onToggle={onToggle} />
      ))}
    </div>
  );
}

function ManualEntryGroup({ group, entries, onAdd, onRemove }) {
  const [code, setCode] = useState("");
  const [hours, setHours] = useState(3);
  const target = parseHours(group.credit_hours);
  const total = entries.reduce((sum, e) => sum + e.hours, 0);
  const satisfied = target != null && total >= target;

  function handleAdd(e) {
    e.preventDefault();
    if (!code.trim() || Number(hours) <= 0) return;
    onAdd(code.trim().toUpperCase(), Number(hours));
    setCode("");
  }

  return (
    <div className="s3-group">
      <div className="s3-group-header">
        <span className={`s3-group-dot${satisfied ? " s3-group-dot--done" : ""}`} />
        <span className="s3-group-label">{group.label || "Requirement"}</span>
        {group.credit_hours && <span className="s3-group-hours">{group.credit_hours} SCH</span>}
      </div>
      {group.description && <p className="s3-group-desc">{group.description}</p>}

      {entries.length > 0 && (
        <ul className="s3-manual-list">
          {entries.map((entry) => (
            <li key={entry.id} className="s3-manual-row">
              <span className="s3-code">{entry.code}</span>
              <span className="s3-manual-hours">{entry.hours} SCH</span>
              <button
                type="button"
                className="s3-manual-remove"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.code}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="s3-manual-form" onSubmit={handleAdd}>
        <input
          type="text"
          className="s3-manual-input s3-manual-input--code"
          placeholder="e.g. CS 4348"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          type="number"
          className="s3-manual-input s3-manual-input--hours"
          min="1"
          max="12"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <button type="submit" className="s3-manual-add">
          Add
        </button>
      </form>

      {target != null ? (
        <p className="s3-manual-progress">
          {total} of {target} SCH logged
        </p>
      ) : (
        <p className="s3-manual-progress s3-manual-progress--unknown">
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
}) {
  const [open, setOpen] = useState(true);
  const indexedGroups = section.groups.map((g, gi) => ({ g, gi }));
  const visibleGroups = indexedGroups.filter(({ g }) =>
    query ? g.courses.some((opt) => matchesSearch(opt, query)) : true
  );
  if (query && visibleGroups.length === 0) return null;

  return (
    <section className="s3-section">
      <button className="s3-section-header" onClick={() => setOpen((o) => !o)} type="button">
        <span className="s3-section-title">{section.title}</span>
        <span className="s3-section-hours">{section.credit_hours} SCH</span>
        <span className={`s3-caret${open ? " s3-caret--open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="s3-section-body">
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
  completed,
  manualEntries,
  onChange,
  onBack,
  onContinue,
}) {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcriptNote, setTranscriptNote] = useState("");
  const [transcriptParsing, setTranscriptParsing] = useState(false);

  const degreeTypes = useMemo(() => (major ? undergradDegreeTypes(major) : []), [major]);
  const [selectedDegreeType, setSelectedDegreeType] = useState(null);

  // Reset the manual pick whenever the major changes so a leftover
  // selection from a previous major can't get applied to this one.
  useEffect(() => {
    setSelectedDegreeType(null);
  }, [major]);

  const resolvedDegreeType = degreeTypes.length === 1 ? degreeTypes[0] : selectedDegreeType;
  const canonicalMajor = resolveMajorKey(major);

  useEffect(() => {
    if (!major) return;
    if (degreeTypes.length === 0) {
      setCatalog(null);
      setLoadError(`We don't have degree requirements on file for "${major}" yet.`);
      return;
    }
    if (!resolvedDegreeType) {
      // Ambiguous (e.g. a major with both BA and BS) — wait for the picker below.
      setCatalog(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setLoadError(null);

    // Use canonicalMajor (correct case from utd_degrees.json), not the raw
    // `major` prop, since static file paths are case-sensitive on Linux/Render.
    const slug = slugify(`${canonicalMajor} (${resolvedDegreeType})`);
    fetch(`${CATALOG_BASE_URL}/${slug}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load requirements for "${major} (${resolvedDegreeType})"`);
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
  }, [major, degreeTypes.length, resolvedDegreeType]);

  const allCodes = useMemo(() => (catalog ? collectAllCodes(catalog) : new Set()), [catalog]);

  const totalHours = catalog ? parseHours(catalog.total_credit_hours) : null;

  // Hours earned only counts groups whose SCH target is knowable: either
  // a choice:false group where every listed course is checked, or a
  // no-course group whose manual entries reach its credit_hours target.
  // See the doc comment at the top of this file for why per-course
  // tracking isn't possible with the data we have.
  const hoursEarned = useMemo(() => {
    if (!catalog) return 0;
    let earned = 0;
    catalog.sections.forEach((section, si) => {
      section.groups.forEach((group, gi) => {
        const target = parseHours(group.credit_hours);
        if (target == null) return;
        if (group.courses.length > 0) {
          if (groupSatisfied(group, completed)) earned += target;
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
    setTranscriptNote("Reading transcript…");
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
      onChange({ completed: next, manualEntries });

      setTranscriptNote(
        `Found ${foundCodes.length} completed courses in your transcript` +
          (newlyChecked > 0 ? ` — checked ${newlyChecked} new ones below.` : ", all already checked below.") +
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
    <div className="s3-screen">
      <header className="s3-header">
        <div className="s3-header-intro">
          <h1 className="s3-heading">Your academic history</h1>
          <p className="s3-subheading">
            Upload a transcript or check off completed courses for <strong>{major}</strong>.
          </p>
        </div>

        <div className="s3-header-actions">
          {catalog && totalHours != null && (
            <div className="s3-hours-banner">
              <span className="s3-hours-banner__value">{hoursLeft}</span>
              <span className="s3-hours-banner__label">
                SCH left to graduate
                <span className="s3-hours-banner__sub">
                  {hoursEarned} of {totalHours} satisfied
                </span>
              </span>
            </div>
          )}

          <div className="s3-upload">
            <label className={`s3-upload-button${transcriptParsing ? " s3-upload-button--busy" : ""}`}>
              {transcriptParsing ? "Reading…" : "Upload transcript"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleTranscriptChange}
                disabled={transcriptParsing}
                hidden
              />
            </label>
            {transcriptFile && <span className="s3-upload-filename">{transcriptFile.name}</span>}
          </div>
        </div>
      </header>

      {transcriptNote && <p className="s3-upload-note">{transcriptNote}</p>}

      {degreeTypes.length > 1 && !resolvedDegreeType && (
        <div className="s3-degree-picker">
          <p className="s3-degree-picker__label">Which degree track?</p>
          <div className="s3-degree-picker__options">
            {degreeTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="s3-degree-picker__btn"
                onClick={() => setSelectedDegreeType(type)}
              >
                {major} ({type})
              </button>
            ))}
          </div>
        </div>
      )}

      {loadError && <p className="s3-error">{loadError}</p>}

      {catalog && (
        <>
          <div className="s3-toolbar">
            <input
              type="text"
              className="s3-search"
              placeholder="Search courses (e.g. CS 3345 or Data Structures)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="s3-progress">
              {doneCount} of {allCodes.size} listed courses checked
            </span>
          </div>

          <div className="s3-requirements">
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
              />
            ))}
          </div>
        </>
      )}

      {!catalog && !loadError && <p className="s3-loading">Loading degree requirements…</p>}

      <div className="s3-footer">
        <button className="s3-btn s3-btn--ghost" type="button" onClick={onBack}>
          Back
        </button>
        <button
          className="s3-btn s3-btn--primary"
          type="button"
          disabled={!catalog}
          onClick={() =>
            onContinue({ completedCodes: [...completed], hoursEarned, hoursLeft, totalHours })
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
