# Torn OC Best-Fit Role Recommender

**Pick the best Organized Crime role to join.** The script ranks every open role in your faction's OCs by a success score: your in-game CPR times your faction's real success rate for that crime. Colors: green 70+, yellow 50-69, red under 50.

## Features
- **Recommended role** with the reason for the pick, plus the next 2 best roles.
- **Presets:** Higher OC first, Highest success, Expected money, Expected respect, Most impact, Raw CPR. Expected money and respect use your cut times the success chance.
- **Slot tags** on Torn's OC page: success score, the role's minimum (Req) and how much your standing moves if the OC wins or fails.
- **Role weights** from tornprobability.com on each slot, and a weighted "Crime success" badge per OC.
- **Standing score** (Score tab) with a breakdown and history, and a CPR trend per role (Trend tab).
- **Item link:** tap the red item icon to open the Item Market for the missing item.
- Your preset, min score and item filter are saved.

## Install
1. Get a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)), or use Torn PDA.
2. Install `torn-oc-bestfit.user.js` from [Greasy Fork](https://greasyfork.org/scripts/583330) or this folder.
3. Open Faction → Crimes, press the **CPR Preset** tab (phone: the tab after Completed) and paste a **Limited** API key.

## Settings
| Setting | Default | What it does |
| --- | --- | --- |
| Share my CPR to the faction database | On | Sends your CPR snapshots and picks to your faction's database. Off = they stay in your browser. |
| Show computed CPR in place of raw CPR | Off | Puts the success score in the slot header instead of Torn's raw CPR. |
| Block Join when I do not meet the need | On | Turns off Torn's Join button for roles under your Req or Score. Off = red tags only. |
| Export my data | - | Shows all data the script holds about you as JSON. |

## Compliance
Works only with the Torn API and the OC page you opened and are looking at. It never clicks for you and makes no non-API requests to Torn. It does nothing in hidden tabs and nothing on pages other than `factions.php` and `organizedcrimes.php`.

**Requests**
| Where | What | When |
| --- | --- | --- |
| `api.torn.com` | `user/organizedcrimes`, `faction/crimes` (completed), `key/info` | Panel open or refresh. Crime history at most every 2 h, 0.7 s between pages. |
| OC Best-Fit gateway (Supabase, run by the author) | Your faction's completed crimes (no CPR), your CPR snapshots and picks if sharing is on, role weights | Panel open or refresh |
| `tornprobability.com` | Role weights | At most once per 24 h |

**API key terms**
| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
| --- | --- | --- | --- | --- |
| Crime history and CPR snapshots in your browser (IndexedDB). Faction crimes, and your CPR snapshots and picks if sharing is on, in the author's database, visible only to your faction. | Only with members of your faction, through the script. Success rates and reward medians per crime type are also shown to all users as a total over many factions, with no faction or player ids. | Recommend OC roles and show faction OC success. | Stored in your browser (userscript storage). Sent with each gateway request; the gateway checks it with Torn `key/info` and never stores it. | Limited |

Made by [KamiRen [2805199]](https://www.torn.com/profiles.php?XID=2805199). MIT license.
