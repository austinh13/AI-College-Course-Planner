import requests
from bs4 import BeautifulSoup
import json
import os

URL = "https://academics.utdallas.edu/degrees/"
SNAPSHOT_FILE = "utd_degrees.json"


def scrape_degrees():
    resp = requests.get(
        URL, headers={"User-Agent": "Mozilla/5.0 (compatible; UTD-degree-checker/1.0)"}
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Degree names are h3 headings. "SEARCH FILTERS" is the only other h3
    # on the page (the filter widget title), so skip it explicitly.
    headings = [h for h in soup.find_all("h3") if h.get_text(strip=True) != "SEARCH FILTERS"]

    degrees = {}
    for h in headings:
        name = h.get_text(strip=True)
        schools, levels = {}, {}
        # Walk forward in document order until the next degree heading
        # (or the footer) rather than relying on exact DOM nesting/classes.
        for el in h.find_all_next():
            if el.name in ("h3", "footer"):
                break
            if el.name == "a":
                href = el.get("href", "")
                text = el.get_text(strip=True)
                if "/fact-sheets/" in href:
                    levels[href] = text
                elif href.startswith("http") and "academics.utdallas.edu" not in href:
                    schools[href] = text
        entry = degrees.setdefault(name, {"schools": {}, "levels": {}})
        entry["schools"].update(schools)
        entry["levels"].update(levels)

    # Flatten + dedupe (the page renders the whole list twice)
    return {
        name: {
            "schools": sorted(set(data["schools"].values())),
            "levels": sorted(set(data["levels"].values())),
        }
        for name, data in degrees.items()
    }


def diff(old, new):
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(name for name in (set(old) & set(new)) if old[name] != new[name])
    return added, removed, changed


if __name__ == "__main__":
    new_data = scrape_degrees()
    print(f"Scraped {len(new_data)} degree programs")

    if os.path.exists(SNAPSHOT_FILE):
        with open(SNAPSHOT_FILE) as f:
            old_data = json.load(f)
        added, removed, changed = diff(old_data, new_data)
        if added or removed or changed:
            print("\nChanges since last run:")
            for name in added:
                print(f"  + added: {name}")
            for name in removed:
                print(f"  - removed: {name}")
            for name in changed:
                print(f"  ~ changed: {name}")
        else:
            print("No changes since last run.")
    else:
        print("No previous snapshot found — this is the baseline.")

    with open(SNAPSHOT_FILE, "w") as f:
        json.dump(new_data, f, indent=2)
