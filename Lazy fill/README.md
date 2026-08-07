# Lazy Fill

Bazaar and city shop quantities start at the full stack instead of 1, so buying is just Buy then
Accept. Every other quantity or price input in [Torn](https://www.torn.com) fills on double-click,
or double-tap on Torn PDA.

A modern replacement for the abandoned *Max Buy* and *TC Bazaar+ v2* userscripts, combined into
one script and updated for Torn's current pages and API v2.

## What it does

Automatic, no interaction needed:

- **Someone's bazaar** - every quantity starts at the full stack instead of 1.
- **City shops and Big Al's** - every buy box starts at 100.

Nothing is ever clicked for you. You still press Buy and confirm.

Everything else fills on demand:

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

Torn's Scripting Abuse rule permits software that relies on the API, or on a page you have
manually loaded and are actively viewing, and forbids non-API requests that are not directly and
manually initiated by you.

Lazy Fill stays inside that. The quantities it pre-fills are read from what Torn already rendered
on the page in front of you, so no extra request is made. It never clicks Buy, never confirms a
purchase, never touches a page you are not looking at, and raises no alerts. The only network
calls it makes are to the official API with your own key, for pricing.

## Turning the automatic fills off

Both are flags at the top of the script, if you would rather type the numbers yourself:

```js
autoFillCityShops: true,
autoFillBazaar: true,
```

## Credits

Inspired by [Max Buy](https://greasyfork.org/en/scripts/398361-max-buy) by Cryosis7 and
[TC Bazaar+ v2](https://greasyfork.org/en/scripts/408585-tc-bazaar-v2) by tos.
