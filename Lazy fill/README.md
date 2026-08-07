# Lazy Fill

Double-click any quantity or price input in [Torn](https://www.torn.com) and it fills itself.
On Torn PDA, double-tap instead.

A modern replacement for the abandoned *Max Buy* and *TC Bazaar+ v2* userscripts, combined into
one script and updated for Torn's current pages and API v2.

## What it does

| Where | Double-click / double-tap | Result |
| --- | --- | --- |
| Someone's bazaar | quantity input | fills the full available amount |
| My bazaar → Add | quantity input | fills everything you own |
| My bazaar → Add | price input | undercuts the lowest item-market price by $1 |
| My bazaar → Manage | quantity input | fills the full listed amount |
| My bazaar → Manage | price input | undercuts the lowest item-market price by $1 |
| My bazaar → Add / Big Al's | item checkbox label | checks/unchecks all copies of that item |
| City shops / Big Al's | buy input | fills 100 (also auto-filled on page load) |
| City shops / Big Al's | sell input | fills everything you own |
| Foreign shop (travelling) | buy input | fills your remaining carry capacity |
| Trade | amount input | fills everything you own of the selected item |

## Torn PDA

Fully supported. Three things differ from a desktop browser and are handled:

- **Double-tap instead of double-click.** Webviews fire `dblclick` unreliably, so the script
  detects the tap pair itself and suppresses the zoom gesture that would otherwise fire.
- **No `window.prompt`.** The API key is requested through an in-page panel instead.
- **API key.** PDA substitutes its own key placeholder at install time, so the script uses your
  PDA key automatically and never asks. `PDA_httpGet` is used as the transport when present.

## API key

Auto-pricing uses the official Torn API v2 item market. Outside PDA, the first time you
double-click a price input the script asks for an API key (a **Public Access** key is enough) and
stores it in your browser's localStorage only. A rejected key is forgotten automatically so you
can re-enter it.

Everything except auto-pricing works without a key.

## Install

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/)), or use Torn PDA.
2. Install from [Greasy Fork](https://greasyfork.org/en/scripts/590287-lazy-fill), or directly
   from this folder's `Lazy Fill.user.js`.

## Compliance

Interacts only with pages you have manually loaded and are actively viewing, plus the official
Torn API with your own key. No background requests to Torn pages, no automation of game actions:
it fills inputs, you still click the button.

## Credits

Inspired by [Max Buy](https://greasyfork.org/en/scripts/398361-max-buy) by Cryosis7 and
[TC Bazaar+ v2](https://greasyfork.org/en/scripts/408585-tc-bazaar-v2) by tos.
