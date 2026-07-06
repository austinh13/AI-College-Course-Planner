import re
import json
import glob
import os
import pdfplumber

CATALOG_FOLDER = "Major_Catalogs"
OUTPUT_FILE = "majors_requirements.json"

TOTAL_HOURS_RE = re.compile(r"Degree Requirements\s*\((\d+)\s*semester credit hours\)")
SECTION_RE = re.compile(
    r"(I{1,3}V?|IV)\.\s*(.+?):\s*(\d+)(?:[-\u2013](\d+))?\s*semester\s+credit\s+hours",
    re.DOTALL,
)
CREDIT_LABEL_RE = re.compile(
    r"^(.+?):\s*(\d+)(?:[-\u2013](\d+))?\s*semester credit hours"
)
COURSE_RE = re.compile(r"\b([A-Z]{2,4}) (\d[0-9V]{3})\b")
CONNECTOR_RE = re.compile(r"^(or|and)\b", re.IGNORECASE)
CHOOSE_RE = re.compile(r"^(Choose|Select|Complete)\b", re.IGNORECASE)
TRAILING_MARKERS = re.compile(r"^(NOTE:|Minors\s*$|\d+\.\s|Updated:)")
MAJOR_HEADING_RE = re.compile(r"^Bachelor of (Arts|Science) in (.+)$")
DEGREE_ABBR = {"Arts": "BA", "Science": "BS"}


def merge_wrapped_parens(lines):
    """Merge PDF-wrapped continuation lines: either an unmatched open
    paren spanning multiple lines, or a parenthetical note wrapped onto
    its own line (e.g. '...Core courses' / '(see advisor)')."""
    merged = []
    buffer = None
    for line in lines:
        stripped = line.strip()
        if buffer is None:
            buffer = stripped
            continue
        open_count = buffer.count("(") - buffer.count(")")
        if open_count > 0 or stripped.startswith("("):
            buffer = f"{buffer} {stripped}".strip()
        else:
            merged.append(buffer)
            buffer = stripped
    if buffer is not None:
        merged.append(buffer)
    return merged


FOOTNOTE_RE = re.compile(r"(?<=[a-zA-Z])(\d+(?:,\s*\d+)*)(?=\s*\(|\s*$)")


def strip_footnotes(text):
    """Strip footnote reference digits glued onto text with no space
    (e.g. 'Calculus I1, 2' -> 'Calculus I', 'Calculus I1 (BA only)' ->
    'Calculus I (BA only)'). Pdfplumber flattens PDF superscripts this
    way since it loses the vertical offset that marks them as footnotes."""
    return FOOTNOTE_RE.sub("", text).strip()


def extract_courses(line):
    """Find real course codes in a line, excluding X000-style level
    markers (e.g. 'ANGM 3000' meaning 'any 3000-level course', not an
    actual course)."""
    courses = []
    for subject, number in COURSE_RE.findall(line):
        if number.endswith("000"):
            continue
        code = f"{subject} {number}"
        # Title = text after the code, up to the next course code or end
        idx = line.find(code) + len(code)
        rest = line[idx:]
        next_match = COURSE_RE.search(rest)
        title = rest[: next_match.start()] if next_match else rest
        courses.append(
            {
                "code": code,
                "title": strip_footnotes(title.strip(" -")),
                "connector": None,
            }
        )
    return courses


def merge_label_descriptions(groups):
    """Two cleanup passes over the raw group list:
    1. A bare credit-hour label ('Communication: 6 SCH') immediately
       followed by a description-only Select/Choose line folds into
       one group's 'description' field.
    2. An empty choice-trigger fragment - happens when a multi-line
       instruction wraps and BOTH halves end up looking like triggers
       (e.g. 'Complete 18 SCH from the following. These courses are' /
       'required for this concentration:') - merges its label forward
       into the next group, which actually holds the courses.
    """
    merged = []
    i = 0
    while i < len(groups):
        g = groups[i]
        nxt = groups[i + 1] if i + 1 < len(groups) else None

        if (
            not g["courses"]
            and not g["choice"]
            and g["credit_hours"] is not None
            and nxt
            and not nxt["courses"]
            and nxt["choice"]
        ):
            merged.append(
                {
                    "label": g["label"],
                    "credit_hours": g["credit_hours"],
                    "choice": False,
                    "description": nxt["label"],
                    "courses": [],
                }
            )
            i += 2
            continue

        if not g["courses"] and g["choice"] and nxt:
            merged.append(
                {
                    "label": f"{g['label']} {nxt['label']}".strip(),
                    "credit_hours": nxt["credit_hours"],
                    "choice": nxt["choice"],
                    "description": nxt["description"],
                    "courses": nxt["courses"],
                }
            )
            i += 2
            continue

        merged.append(g)
        i += 1
    return merged


def parse_section(name, hours_text, body_lines):
    groups = []
    notes = []
    current_label = None
    current_hours = None
    current_choice = False
    current_courses = []

    def flush():
        if current_courses or current_label:
            groups.append(
                {
                    "label": current_label,
                    "credit_hours": current_hours,
                    "choice": current_choice,
                    "description": None,
                    "courses": current_courses,
                }
            )

    for line in body_lines:
        line = line.strip()
        if not line:
            continue

        courses_found = extract_courses(line)

        if courses_found:
            connector_match = CONNECTOR_RE.match(line)
            connector = connector_match.group(1).lower() if connector_match else None
            for c in courses_found:
                c["connector"] = connector
            current_courses.extend(courses_found)
            continue

        label_match = CREDIT_LABEL_RE.match(line)
        if label_match:
            flush()
            current_label = label_match.group(1).strip()
            lo, hi = label_match.group(2), label_match.group(3)
            current_hours = f"{lo}-{hi}" if hi else lo
            current_choice = False
            current_courses = []
            continue

        if CHOOSE_RE.match(line):
            flush()
            current_label = strip_footnotes(line)
            current_hours = None
            current_choice = True
            current_courses = []
            continue

        if line.endswith(":"):
            flush()
            current_label = strip_footnotes(line)
            current_hours = None
            current_choice = True
            current_courses = []
            continue

        # Short bare label (e.g. "Foundations", "Fundamentals") vs. prose
        if len(line) < 45 and not line.endswith(".") and "credit hours" not in line:
            flush()
            current_label = line
            current_hours = None
            current_choice = False
            current_courses = []
            continue

        # Leftover descriptive/disclaimer prose
        notes.append(line)

    flush()
    return {
        "title": name.strip(),
        "credit_hours": hours_text,
        "groups": merge_label_descriptions(groups),
        "notes": notes,
    }


def parse_catalog_pdf(path):
    with pdfplumber.open(path) as pdf:
        raw_lines = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            raw_lines.extend(text.split("\n"))

    # Find every real "Bachelor of X in Y" heading (must be the entire
    # line, not a substring — catalogs sometimes use this exact phrase
    # in prose too, e.g. "Students pursuing a Bachelor of Science in
    # Finance degree will be..."). Confirm each with a nearby "Degree
    # Requirements (N semester credit hours)" line as a defensive
    # double-check against any other false positive we haven't seen yet.
    major_starts = []
    for i, line in enumerate(raw_lines):
        m = MAJOR_HEADING_RE.match(line.strip())
        if not m:
            continue
        lookahead = "\n".join(raw_lines[i : i + 4])
        hours_match = TOTAL_HOURS_RE.search(lookahead)
        if not hours_match:
            continue
        degree = DEGREE_ABBR.get(m.group(1), m.group(1))
        major_starts.append((i, f"{m.group(2).strip()} ({degree})", hours_match.group(1)))

    majors = []
    for idx, (start_line, major_name, total_hours) in enumerate(major_starts):
        end_line = major_starts[idx + 1][0] if idx + 1 < len(major_starts) else len(raw_lines)
        block_lines = raw_lines[start_line:end_line]
        full_text = "\n".join(block_lines)

        section_matches = list(SECTION_RE.finditer(full_text))
        sections = []
        for i, m in enumerate(section_matches):
            name = m.group(2)
            lo, hi = m.group(3), m.group(4)
            hours_text = f"{lo}-{hi}" if hi else lo
            b_start = m.end()
            b_end = (
                section_matches[i + 1].start()
                if i + 1 < len(section_matches)
                else len(full_text)
            )
            body_lines = full_text[b_start:b_end].split("\n")

            # Cut off trailing matter (footnote definitions, Minors, etc.)
            cut = len(body_lines)
            for j, bl in enumerate(body_lines):
                if TRAILING_MARKERS.match(bl.strip()):
                    cut = j
                    break
            body_lines = merge_wrapped_parens(body_lines[:cut])

            sections.append(parse_section(name, hours_text, body_lines))

        majors.append(
            {"major": major_name, "total_credit_hours": total_hours, "sections": sections}
        )

    return majors


if __name__ == "__main__":
    results = {}
    pdf_paths = sorted(glob.glob(os.path.join(CATALOG_FOLDER, "*.pdf")))
    print(f"Found {len(pdf_paths)} PDFs in {CATALOG_FOLDER}/")

    for path in pdf_paths:
        majors = parse_catalog_pdf(path)
        if not majors:
            print(f"  {os.path.basename(path)}: no major heading found — check manually")
            continue
        for data in majors:
            key = data["major"]
            results[key] = data
            n_courses = sum(len(g["courses"]) for s in data["sections"] for g in s["groups"])
            print(f"  {key}: {len(data['sections'])} sections, {n_courses} courses found")

    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {OUTPUT_FILE}")
