**Which Torn stock should you buy next?** Ranks every stock benefit block, plus the bank and TCI, by how fast each one pays for itself.

<center><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Stock%20ROI/screenshot.png" alt="Torn Stock Block ROI" width="720"></center>

<center><small>Demo account.</small></center>

## What it does

- **One scale for everything.** Cash, items and points blocks (increments 1 to 4) compared by days to break even and yearly ROI, using live prices and live item values.
- **Knows your account.** Shows what you own, your bank deposit and your bank cap (Oil Rig aware).
- **Pick and total.** Select rows to see their combined cost, weekly and monthly income and ROI.
- **Desktop and Torn PDA.** Opens instantly from cache, refreshes only when the data is old.

## How to use

1. Open the [stock market](https://www.torn.com/page.php?sid=StockMarket) and press the green **ROI** button.
2. Paste a Torn API key (Limited Access is enough).
3. Torn PDA uses your PDA key automatically.

## Good to know

- Your key is stored only in your browser (localStorage) and sent only to `api.torn.com`.
- It reads nothing from the page and clicks nothing. Its only network calls go to the official Torn API with your own key, after you press ROI (stale cache) or Refresh.
- Not included: passive stocks, HRG, BAG, EVL, MCS, CBD. Clothing Cache is an estimate (average of the seven caches).

<details>
<summary><b>Reading the table</b></summary>

- **Return:** what it pays, with the item's market value underneath.
- **Increment:** 1 to 4. Bank and TCI: *No merits* or *10 merits*.
- **Days to break even:** cost divided by (payout divided by days per payout).
- **ROI @365d:** yearly payout divided by cost.
- **Owned?:** **YES** if you hold that increment or more. Bank: **YES** at the cap, **PARTLY** below it.

</details>

Source and issues: [GitHub](https://github.com/Yoonutz/torn-scripts/tree/main/Torn%20Stock%20ROI)
