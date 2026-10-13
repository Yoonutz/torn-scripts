# Torn Stock Block ROI

**Which stock should I buy next?** This script answers it.

Torn's stock market pays you for holding enough shares: cash, items, or points, every week or month.
Those payouts are very different from each other, and so are the share prices needed to unlock them, so
they are hard to compare by eye. This script puts every stock benefit block on the same scale: how many
days it takes to earn back what it cost, and what it returns over a year. The bank and TCI sit in the
same table, so you can see whether money is better off in a stock block or in the bank.

It works from live prices, live item market values and your own account. It knows what you already own,
what your bank deposit is, and what your bank cap is, so you can see at a glance what is worth buying
next and what is already covered.

![Stock Block ROI on desktop](screenshot.png)

<p align="center"><img src="screenshot-mobile.png" alt="Stock Block ROI on a phone" width="300"></p>

*(Screenshots use a demo account.)*

## At a glance

- Opens from an **ROI** button on the stock market page, as a window over the page.
- Every block, increments 1 to 4, plus the bank and TCI, ranked by days to break even or by ROI.
- Shows what you own, what you partly own (bank), and what is still open.
- Pick any rows to see their combined cost, weekly and monthly income and overall ROI.
- Works on desktop and phone (Torn PDA included). One API key, kept only in your browser.
- Cached, so it opens instantly and only asks Torn for fresh data when the cache is old.

## What it shows

| Column | Meaning |
| --- | --- |
| Stock | Acronym and name |
| Return | What the block pays, with the item's market value under it (or the cash amount, or the price per point) |
| Increment | 1 to 4 (the bank and TCI show *No merits* / *10 merits*) |
| Payout value | Value of one payout for that increment |
| Days per payout | 7 or 31 for stocks, 90 for the bank |
| Cost | Shares needed x current share price |
| Days to break even | Cost / (payout / days per payout) |
| ROI @365d | Yearly payout / cost |
| Owned? | **YES** if you hold that increment or more. Bank: **YES** at the deposit cap, **PARTLY** (orange) below it |

Increments stack: increment *n* needs requirement x (2^*n* - 1) shares in total and pays *n* x the base
return each cycle ([Torn wiki, Stock Market](https://wiki.torn.com/wiki/Stock_Market)).

- **Bank cap** is $2,000,000,000, or $3,000,000,000 when your property is an Oil Rig. Detected from
  your property, nothing to set.
- **Merits** are detected from the interest your current deposit earned (x1.5 with 10 merits).
- **TCI** pays 10% of the bank interest. The deposit and shares come back, so break-even there is a yield
  measure, not a payback.
- Click (tap) rows to add them to a selection. The summary shows the combined cost, income per week and
  per 30 days, ROI and break-even. **Select my holdings** picks what you own in one go.
- Sort by any column header, or with the Sort box on a phone. Filter by owned, not owned or selected.

Not included: passive stocks, HRG, BAG, EVL, MCS, CBD. Clothing Cache (TCC) uses the average market
value of the seven cache items and is marked *Est.*

## Torn PDA

Supported. The layout turns into cards on narrow screens. PDA substitutes its own key at install time,
so the script uses your PDA key automatically and never asks; `PDA_httpGet` is the transport when present.

## API key

Outside PDA the panel asks for your Torn API key the first time you press ROI. A **Limited Access** key
is enough. It is stored in your browser's localStorage only and sent only to `api.torn.com`.
**Add API key** replaces it, **Remove key** forgets it.

## Cached data

Everything is cached in localStorage as small objects with lists, so the table shows instantly:

| Key | Holds |
| --- | --- |
| `tsr.key` | your API key |
| `tsr.account` | bank, property, stock holdings (list) |
| `tsr.market` | stock prices (list), item values (list), bank rates (list), points price |
| `tsr.selection` | selected rows (list) |
| `tsr.settings` | filter, max increment, sort, row limit |

Pressing ROI refreshes only when the cache is older than five minutes. **Refresh** forces it.
Before the first refresh the table uses a built-in price snapshot (13 Oct 2026).

## Install

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/)), or use Torn PDA.
2. Install `Torn-Stock-ROI.user.js` from this folder.

## Compliance

Torn's Scripting Abuse rule permits software that relies on the API, or on a page you have manually
loaded and are actively viewing, and forbids non-API requests that are not directly and manually
initiated by you.

This script reads nothing from the page and clicks nothing. Its only network calls go to the official
API with your own key, and only after you press ROI (when the cache is stale) or Refresh.
