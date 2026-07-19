# OC Member Tracker

A userscript for [Torn](https://www.torn.com) that tracks which faction members are **not** currently participating in an Organized Crime (OC). Designed for faction leaders and organizers who need to quickly identify available members for recruitment.

## Overview

OC Member Tracker adds a floating, draggable panel to the faction page showing members who are out of OC, along with:

- **How long** they've been out of an OC
- **Current status** (Okay, Jail, Hospital, Traveling, etc.)
- **Last online time** with recency indicators
- **Urgency bands** color-coded by time since last OC

## Features

### Smart Urgency Classification

Members are automatically categorized by how long they've been out of OC:

| Band      | Color  | Time Range | Meaning                         |
| --------- | ------ | ---------- | ------------------------------- |
| ✅ OK     | Green  | < 3 hours  | Just finished — normal cooldown |
| 🟠 Watch  | Orange | 3h – 24h   | Attention needed soon           |
| 🔴 Warn   | Red    | 1 – 7 days | Should be recruited             |
| 🟣 Danger | Purple | > 7 days   | Priority recruitment target     |
| ⬜ None   | Gray   | No history | Never seen in completed OC      |

### Embedded Panel

- **Integrated** — Appears inside the faction crimes page
- **Minimizable** — Collapse to header only when not needed (matches Torn's loadout UI style)
- **Persistent state** — Minimized state stored between sessions

### Data & Refresh

- **Auto-refresh** every hour to keep data current
- **Manual refresh** button for on-demand updates
- **Smart caching** — Shows cached data immediately while fetching fresh data
- **Offline support** — Displays cached data if API is unreachable

## Installation

1. Install a userscript manager:
   - [Violentmonkey](https://violentmonkey.github.io/) (recommended)
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/)

2. Install the script:
   - Open `oc-tracker.user.js` in raw view
   - Your userscript manager should prompt to install
   - Or copy-paste the contents into a new userscript

3. Set your API key:
   - Navigate to any Torn faction page (`https://www.torn.com/factions.php*`)
   - Click the 🔑 (key) button in the panel header
   - Paste your Torn API key with **Faction** access (Limited or Full)
   - The panel will refresh automatically

## API Key Requirements

Your Torn API key needs:

- **Faction** access level (read-only Limited access is sufficient)

To create/modify your key:

1. Go to Torn → Settings → API Key
2. Enable "Faction" under Access Permissions
3. Copy the key and paste into the tracker

## Usage

Once installed and configured, the panel appears automatically at the top of the faction crimes page:

- **Members listed** — Only shows members NOT currently in an active OC
- **Click names** — Opens member profile in new tab
- **Collapse/Expand** — Click the ▶/▼ arrow to minimize/maximize the panel
- **Status colors**:
  - 🟢 Green = Okay
  - 🔴 Red = Jail
  - 🟠 Orange = Hospital
  - 🔵 Blue = Traveling/Abroad
  - 🟣 Purple = Federal

### Menu Commands

If your userscript manager supports `GM_registerMenuCommand`:

- **Set API Key** — Update your Torn API key
- **Force Refresh** — Immediately fetch fresh data

## How It Works

The script queries two Torn API v2 endpoints:

1. **`faction?selections=members`** — Gets all faction members with their current OC status and online state
2. **`faction?selections=crimes&cat=completed`** — Gets last 100 completed crimes to determine when each member last participated

By cross-referencing these, the tracker identifies members not in an active OC and calculates how long since their last completed crime.

## Privacy & Security

- API key is stored locally in your browser only
- No data is sent to external servers
- All API calls go directly to `api.torn.com`

## Troubleshooting

| Issue                  | Solution                                                                        |
| ---------------------- | ------------------------------------------------------------------------------- |
| "No API key set"       | Click the key icon 🔑 and enter your Torn API key                               |
| "Incorrect key"        | Verify your key is valid and has Faction access                                 |
| "Access level too low" | Go to Torn Settings → API Key and enable Faction access                         |
| Panel not appearing    | Ensure you're on the faction crimes tab (`/factions.php?step=your#/tab=crimes`) |
| Old data shown         | Click the refresh icon ↻ or wait for auto-refresh                               |

## Changelog

### v1.9

- Added urgency band classification
- Improved color coding for status and duration
- Added menu commands for API key and refresh
- Enhanced caching with offline support

## Credits

- **Author:** KamiRen [2805199]
- **Game:** [Torn](https://www.torn.com) — text-based MMORPG

## License

This userscript is provided as-is for the Torn community. Use at your own risk.
