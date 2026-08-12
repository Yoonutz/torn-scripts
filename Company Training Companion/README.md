# Company Training Companion

Adds a **Paid** column to the company employee list in [Torn](https://www.torn.com), so Directors
can see at a glance how many paid trains each employee has left.

## What it does

- Inserts a properly aligned **Paid** column next to **Train** on the employees page.
- Values come from a shared Google Sheets snapshot, published through Google Apps Script, so every
  director sees the same numbers.
- Clicking **Train** counts the employee's number down locally, so the column stays current
  between snapshot refreshes. Disabled Train entries (plain text, not a link) never count down.
- The snapshot refreshes automatically every 5 minutes.

## Install

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/)).
2. Install from [Greasy Fork](https://greasyfork.org/en/scripts/558987-company-training-companion),
   or directly from this folder's `Company Training Companion.user.js`.

## Setup

The script needs the Apps Script deployment that serves the paid-trains snapshot:

1. On first run it asks for the deployment ID (starts with `AKfy...`). Paste either the ID or the
   full `/macros/s/.../exec` URL.
2. To change it later, use the userscript manager menu: **Set Snapshot Deployment ID**.

The backend lives in this repo under `Torn Paid Trains App/`.

## Compliance

The script only reads what Torn already rendered on the page in front of you. Its only network
calls go to your own Google Apps Script deployment for the snapshot - it never sends requests to
Torn and never clicks anything for you.
