**Which Torn stock should you buy next?** Ranks every stock benefit block, plus the bank and TCI, by how fast each one pays for itself.

<center>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Stock%20ROI/screenshot.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Stock%20ROI/screenshot.png" alt="Torn Stock Block ROI on desktop" width="620"></a>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Stock%20ROI/screenshot-mobile.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Stock%20ROI/screenshot-mobile.png" alt="Torn Stock Block ROI on a phone" width="190"></a>
</center>

<center><small>Desktop and phone. Demo account.</small></center>

## What it does

- **One scale for everything.** Cash, items and points blocks (increments 1 to 4) compared by days to break even and yearly ROI, using live prices and live item values.
- **Knows your account.** Shows what you own, your bank deposit and your bank cap (Oil Rig aware).
- **Pick and total.** Select rows to see their combined cost, weekly and monthly income and ROI.
- **Sort and filter any column.** Click a header to sort, or to keep only the values you tick (say increment 1, or increments 2 and 3) or a number range. Filters stack and are remembered.
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
<summary><b>Sort and filter</b></summary>
<ul>
<li>Click a column header: <b>Sort A to Z</b> or <b>Z to A</b> (smallest or largest first for numbers).</li>
<li>Stock, Return, Increment, Days per payout and Owned? also get a search box and a checklist. Five rows show, the rest scrolls. Type a value and press Enter to keep only the matches.</li>
<li>Payout value, Cost, Days to break even and ROI @365d get <b>Min</b> and <b>Max</b>. You can type 5m, 2b or 750k.</li>
<li>Filters stack. Each active one is a chip above the table: click it to remove it.</li>
<li>Fastest payback among increment 1: tick only 1 under Increment, then sort Days to break even smallest to largest.</li>
<li>On a phone use <b>Sort</b> and <b>Column filters</b> at the top.</li>
</ul>
</details>

<details>
<summary><b>Reading the table</b></summary>
<ul>
<li><b>Return:</b> what it pays, with the item's market value underneath.</li>
<li><b>Increment:</b> 1 to 4. Bank and TCI: <i>No merits</i> or <i>10 merits</i>.</li>
<li><b>Days to break even:</b> cost divided by (payout divided by days per payout).</li>
<li><b>ROI @365d:</b> yearly payout divided by cost.</li>
<li><b>Owned?:</b> <b>YES</b> if you hold that increment or more. Bank: <b>YES</b> at the cap, <b>PARTLY</b> below it.</li>
</ul>
</details>

Source and issues: [GitHub](https://github.com/Yoonutz/torn-scripts/tree/main/Torn%20Stock%20ROI)
