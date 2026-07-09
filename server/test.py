import requests

resp = requests.get(
    "https://trends.utdnebula.com/dashboard",
    params={"searchTerms": "ACCT 3341", "availability": "26F"},
    timeout=15,
)
text = resp.text

idx = text.find('\\"enrollment_reqs\\"')
print("Found at index:", idx)
print("--- 2500 chars before ---")
print(text[idx-2500:idx])
print("\n--- 400 chars after ---")
print(text[idx:idx+400])