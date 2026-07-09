import re
import json
import glob
import os
import pdfplumber

CATALOG_FOLDER = "Major_Catalogs"
OUTPUT_FOLDER = "Major_Catalogs_Parsed"

TOTAL_HOURS_RE = re.compile(r"Degree Requirements\s*\((\d+)\s*semester credit hours\)")
# Section markers must start at a line boundary and the label must be short
# (bounded to 60 chars). Without both constraints, a roman numeral appearing
# mid-text -- a faculty initial like "Dan I. Moldovan," or a nested "I./II."
# sub-choice inside a requirement description -- gets misread as a section
# start, and the lazy DOTALL match then swallows everything up to the next
# real ": N semester credit hours" (e.g. an entire faculty roster).
SECTION_RE = re.compile(
    r"(?:^|\n)(I{1,3}V?|IV)\.\s{0,3}(.{1,60}?)\s*[:\-\u2013]\s*(\d+)(?:\s*(?:[-\u2013]|or)\s*(\d+))?\s*(?:upper-division\s+)?semester\s+credit\s+hours",
    re.DOTALL,
)
CREDIT_LABEL_RE = re.compile(
    r"^(.+?):\s*(\d+)(?:[-\u2013](\d+))?\s*(?:upper-division\s+)?semester credit hours"
)
COURSE_RE = re.compile(r"\b([A-Z]{2,4}) (\d[0-9V]{3})\b")
CONNECTOR_RE = re.compile(r"^(or|and)\b", re.IGNORECASE)
CHOOSE_RE = re.compile(r"^(Choose|Select|Complete)\b", re.IGNORECASE)
TRAILING_MARKERS = re.compile(r"^(NOTE:|Minors\s*$|\d+\.\s|Updated:)")
MAJOR_HEADING_RE = re.compile(r"^Bachelor of (Arts|Sciences?) in (.+)$")
DEGREE_ABBR = {"Arts": "BA", "Science": "BS", "Sciences": "BS"}
# A parenthetical qualifier like "(Double Major)" sometimes wraps onto its
# own line right after the heading (e.g. Economics and Finance).
HEADING_CONTINUATION_RE = re.compile(r"^\(.+\)$")


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


FOOTNOTE_RE = re.compile(r"(?<=[^\d\s])(\d+(?:,\s*\d+)*)(?=\s*\(|\s*$)")


def strip_footnotes(text):
    """Strip footnote reference digits glued onto text with no space
    (e.g. 'Calculus I1, 2' -> 'Calculus I', 'Calculus I1 (BA only)' ->
    'Calculus I (BA only)'). Pdfplumber flattens PDF superscripts this
    way since it loses the vertical offset that marks them as footnotes."""
    return FOOTNOTE_RE.sub("", text).strip()


def extract_courses(line):
    """Find real course codes in a line, excluding X000-style level
    markers (e.g. 'ANGM 3000' meaning 'any 3000-level course', not an
    actual course), and excluding codes that are only *mentioned* inside
    a parenthetical aside (e.g. 'MATH 1325 ... (may substitute MATH 2413
    or MATH 2417 for MATH 1325)') rather than actually required."""
    masked = re.sub(r"\([^()]*\)", lambda m: " " * len(m.group(0)), line)
    courses = []
    for subject, number in COURSE_RE.findall(masked):
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
       (e.g. 'Complete 18 SCH from the following. These courses are'
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
    # Points at the option (a top-level course, or an "or" alternative to
    # one) that a following "and" line should attach to as a co-requisite.
    current_focus = None

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

        # A stray "or"/"and" with no course on its own line -- e.g. a nested
        # "I. ...\nand ...\nor\nII. ...\nand ..." sub-choice -- isn't a label
        # and isn't a course; skip it rather than let it become a phantom
        # one-word group.
        if line.lower() in ("or", "and"):
            continue

        # A bare footnote marker (e.g. the "2" left over when a section
        # header like "...45 or 53 semester credit hours2" is split right
        # after "hours", stranding the glued footnote digit on its own).
        if re.fullmatch(r"\d+(,\s*\d+)*", line):
            continue

        # A wrapped continuation of the previous section header (e.g.
        # "Major Requirements: 54-57 semester credit hours" / "beyond Core
        # Curriculum" on the next line) -- not a real group.
        if line.lower() == "beyond core curriculum":
            continue

        courses_found = extract_courses(line)

        if courses_found:
            connector_match = CONNECTOR_RE.match(line)
            connector = connector_match.group(1).lower() if connector_match else None
            for c in courses_found:
                c["connector"] = connector
                c["with"] = []
                c["alternatives"] = []
                if connector == "and" and current_focus is not None:
                    # Co-requisite of the option currently being built
                    # (e.g. the lab course paired with its lecture course).
                    current_focus["with"].append({"code": c["code"], "title": c["title"]})
                elif connector == "or" and current_courses:
                    # A full alternative option to the last top-level
                    # option (which may itself gain "and" co-requisites
                    # on subsequent lines, so it becomes the new focus).
                    current_courses[-1]["alternatives"].append(c)
                    current_focus = c
                else:
                    current_courses.append(c)
                    current_focus = c
            continue

        # A footnote digit can be glued directly onto a label line's
        # trailing punctuation (e.g. "...career track):2"), which would
        # otherwise hide the ':' that marks it as a group trigger.
        line = strip_footnotes(line)

        label_match = CREDIT_LABEL_RE.match(line)
        if label_match:
            flush()
            current_label = label_match.group(1).strip()
            lo, hi = label_match.group(2), label_match.group(3)
            current_hours = f"{lo}-{hi}" if hi else lo
            current_choice = False
            current_courses = []
            current_focus = None
            continue

        if CHOOSE_RE.match(line):
            flush()
            current_label = strip_footnotes(line)
            current_hours = None
            current_choice = True
            current_courses = []
            current_focus = None
            continue

        if line.endswith(":"):
            flush()
            current_label = strip_footnotes(line)
            current_hours = None
            current_choice = True
            current_courses = []
            current_focus = None
            continue

        # Short bare label (e.g. "Foundations", "Fundamentals") vs. prose
        if len(line) < 45 and not line.endswith(".") and "credit hours" not in line:
            flush()
            current_label = strip_footnotes(line)
            current_hours = None
            current_choice = False
            current_courses = []
            current_focus = None
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


def sanitize_filename(name):
    """Turn a major name into a safe filename, e.g. 'Economics and Finance
    (Double Major) (BS)' -> 'Economics_and_Finance_Double_Major_BS.json'."""
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") + ".json"


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
        name = m.group(2).strip()
        # Pick up a wrapped qualifier like "(Double Major)" on the next line.
        if i + 1 < len(raw_lines) and HEADING_CONTINUATION_RE.match(raw_lines[i + 1].strip()):
            name = f"{name} {raw_lines[i + 1].strip()}"
        major_starts.append((i, f"{name} ({degree})", hours_match.group(1)))

    majors = []
    for idx, (start_line, major_name, total_hours) in enumerate(major_starts):
        end_line = major_starts[idx + 1][0] if idx + 1 < len(major_starts) else len(raw_lines)
        block_lines = raw_lines[start_line:end_line]

        # Every degree plan ends with a stock sentence ("...sufficient
        # upper-division courses to total 45 upper-division semester
        # credit hours."). Everything after the LAST occurrence of it
        # (Fast Track programs, Minors, Certificates, UTeach Option,
        # policy notes, footnote definitions, etc.) isn't part of the
        # degree plan itself, so drop it before section-splitting --
        # otherwise it gets misread as bogus trailing groups.
        plan_end = None
        for j, bl in enumerate(block_lines):
            if "sufficient upper-division courses" in bl:
                plan_end = j
        if plan_end is not None:
            block_lines = block_lines[: plan_end + 1]

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
    pdf_paths = sorted(glob.glob(os.path.join(CATALOG_FOLDER, "*.pdf")))
    print(f"Found {len(pdf_paths)} PDFs in {CATALOG_FOLDER}/")
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    for path in pdf_paths:
        majors = parse_catalog_pdf(path)
        if not majors:
            print(f"  {os.path.basename(path)}: no major heading found — check manually")
            continue
        for data in majors:
            key = data["major"]
            n_courses = sum(len(g["courses"]) for s in data["sections"] for g in s["groups"])
            print(f"  {key}: {len(data['sections'])} sections, {n_courses} courses found")
            out_path = os.path.join(OUTPUT_FOLDER, sanitize_filename(key))
            with open(out_path, "w") as f:
                json.dump(data, f, indent=2)

    print(f"\nSaved to {OUTPUT_FOLDER}/")
