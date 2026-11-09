"""Install the local offer importer into an existing WINGLOBAL folder."""
from pathlib import Path
import shutil

folder = Path(input("Paste the folder containing your main START_WINGLOBAL.bat: ").strip().strip('"'))
index = folder / "index.html"
html = index.read_bytes()
if b'All Submitted Items' not in html or not (folder / "START_WINGLOBAL.bat").is_file():
    raise SystemExit("Choose the main WINGLOBAL program folder.")
script = b'<script src="winery-offer-import.js" defer></script>'
old_filter = b"const rows=state.records.filter(r=>r.registered==='Yes').filter(r=>{"
new_filter = b"const rows=state.records.filter(r=>r.registered==='Yes'||(mode==='active'&&r.wineryOfferKey)).filter(r=>{"
if old_filter not in html and new_filter not in html:
    raise SystemExit("This version of All Submitted Items does not match the installer.")
if b'</head>' not in html:
    raise SystemExit("Could not find the WINGLOBAL page header.")
backup = folder / "index.before-winery-bridge.html"
if not backup.exists():
    shutil.copy2(index, backup)
shutil.copy2(Path(__file__).with_name("winery-offer-import.js"), folder)
updated = html.replace(old_filter, new_filter, 1)
if script not in updated:
    updated = updated.replace(b'</head>', script + b'\n</head>', 1)
if updated != html:
    index.write_bytes(updated)
print("Installed. Reload the main WINGLOBAL program and sign in as administrator.")
