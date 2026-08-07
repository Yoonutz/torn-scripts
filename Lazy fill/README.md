# Lazy Fill

Double-click any quantity or price input in [Torn](https://www.torn.com) and it fills itself.

A modern replacement for the abandoned *Max Buy* and *TC Bazaar+ v2* userscripts, combined into
one script and updated for Torn's current pages and API v2.

## What it does

| Where | Double-click | Result |
|---|---|---|
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

## API key

Auto-pricing uses the official Torn API v2 item market. The first time you double-click a price
input, the script asks for an API key (a **Public Access** key is enough) and stores it in your
browser's localStorage only. A rejected key is forgotten automatically so you can re-enter it.

Everything else works without a key.

## Install

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/)).
2. Install the script from
   [Greasy Fork](https://greasyfork.org/en/users/lazy-fill) or directly from this folder's
   `Lazy Fill.user.js`.

## Compliance

Interacts only with pages you have manually loaded and are actively viewing, plus the official
Torn API with your own key. No background requests to Torn pages, no automation of game actions:
it fills inputs, you still click the button.

## Credits

Inspired by [Max Buy](https://greasyfork.org/en/scripts/398361-max-buy) by Cryosis7 and
[TC Bazaar+ v2](https://greasyfork.org/en/scripts/408585-tc-bazaar-v2) by tos.
