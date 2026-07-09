import re
import json
import glob
import os
import time
import requests

COURSEBOOK_FOLDER = "All_Courses"
OUTPUT_FILE = "classes.json"

SEARCH_URL = "https://trends.utdnebula.com/dashboard"


def extract_field(text, key):
    """Pull a string value out of the page's embedded (backslash-escaped)
    JSON, e.g. \"title\":\"Cost Management Systems\"."""
    match = re.search(r'\\"' + re.escape(key) + r'\\":\\"(.*?)\\"', text)
    return match.group(1) if match else None


def collect_codes(coursebook_folder):
    """Read every CourseBook export JSON in the folder and collect the
    unique set of course codes, deduping multiple sections of the same
    course (and across files)."""
    codes = set()
    for path in glob.glob(os.path.join(coursebook_folder, "*.json")):
        with open(path) as f:
            data = json.load(f)
        for row in data["report_data"]:
            code = f"{row['course_prefix'].upper()} {row['course_number']}"
            codes.add(code)
    return codes


def fetch_class(code):
    """Fetch the search results page for a course code and pull out
    name/code/prereq from the page's embedded JSON fields."""
    resp = requests.get(
        SEARCH_URL, params={"searchTerms": code, "availability": "26F"}, timeout=15
    )
    print(f"    URL: {resp.url}")
    resp.raise_for_status()
    text = resp.text

    title = extract_field(text, "title")
    enrollment_reqs = extract_field(text, "enrollment_reqs")

    prereq = None
    if enrollment_reqs:
        prereq = re.sub(r"^Prerequisites?:\s*", "", enrollment_reqs).rstrip(".").strip()
        prereq = prereq or None

    return {"name": title, "code": code, "prereq": prereq}


if __name__ == "__main__":
    codes = collect_codes(COURSEBOOK_FOLDER)
    print(f"Found {len(codes)} unique course codes in {COURSEBOOK_FOLDER}/")

    results = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE) as f:
            results = json.load(f)

    todo = sorted(c for c in codes if c not in results)
    print(f"{len(todo)} not yet fetched")

    for i, code in enumerate(todo, 1):
        try:
            results[code] = fetch_class(code)
            status = "ok" if results[code]["prereq"] else "no prereq found"
        except requests.RequestException as e:
            status = f"error: {e}"
        print(f"  [{i}/{len(todo)}] {code}: {status}")
        time.sleep(1)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {OUTPUT_FILE}")
