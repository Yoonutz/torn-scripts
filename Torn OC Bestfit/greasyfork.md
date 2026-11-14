<p><b>Pick the best Organized Crime role to join.</b> The script ranks every open role in your faction's OCs by a success score: your in-game CPR times your faction's real success rate for that crime. Colors: green 70+, yellow 50-69, red under 50.</p>
<h2>What it does</h2>
<ul>
<li><b>Recommended role</b> with the reason for the pick, plus the next 2 best roles.</li>
<li><b>Presets:</b> Higher OC first, Highest success, Expected money, Expected respect, Most impact, Raw CPR. Expected money and respect use your cut times the success chance.</li>
<li><b>Slot tags</b> on Torn's OC page: success score, the role's minimum (Req) and how much your standing moves if the OC wins or fails.</li>
<li><b>Role weights</b> from tornprobability.com on each slot, and a weighted "Crime success" badge per OC.</li>
<li><b>Standing score</b> with a breakdown and history, and a CPR trend per role.</li>
<li><b>Item link:</b> tap the red item icon to open the Item Market for the missing item.</li>
</ul>
<h2>How to use</h2>
<ol>
<li>Open Faction &rarr; Crimes.</li>
<li>Press the <b>CPR Preset</b> tab (phone: the tab after Completed).</li>
<li>Paste a <b>Limited</b> API key. Pick a preset; the script remembers it.</li>
</ol>
<h2>Good to know</h2>
<ul>
<li>Works only with the Torn API and the OC page you are looking at. Nothing in hidden tabs, nothing on other pages, no clicks for you.</li>
<li><b>Share my CPR</b> is on by default: your CPR snapshots and picks go to your faction's database. Turn it off in Settings.</li>
<li><b>Block Join</b> (Settings, on by default) turns off Torn's Join button for roles under your Req or Score.</li>
<li>Settings &rarr; <b>Export my data</b> shows everything the script holds about you.</li>
</ul>
<h2>Requests</h2>
<table>
<tr><th>Where</th><th>What</th><th>When</th></tr>
<tr><td><code>api.torn.com</code></td><td><code>user/organizedcrimes</code>, <code>faction/crimes</code> (completed), <code>key/info</code></td><td>Panel open or refresh. Crime history at most every 2 h.</td></tr>
<tr><td>OC Best-Fit gateway (Supabase, run by the author)</td><td>Faction completed crimes (no CPR); your CPR snapshots and picks if sharing is on; role weights</td><td>Panel open or refresh</td></tr>
<tr><td><code>tornprobability.com</code></td><td>Role weights</td><td>At most once per 24 h</td></tr>
</table>
<h2>API key terms</h2>
<table>
<tr><th>Data storage</th><th>Data sharing</th><th>Purpose of use</th><th>Key storage &amp; sharing</th><th>Key access level</th></tr>
<tr><td>Crime history and CPR snapshots in your browser. Faction crimes, and your CPR snapshots and picks if sharing is on, in the author's database, visible only to your faction.</td><td>Only with members of your faction, through the script. Success rates and reward medians per crime type are also shown to all users as a total over many factions, with no faction or player ids.</td><td>Recommend OC roles and show faction OC success.</td><td>Stored in your browser. Sent with each gateway request; the gateway checks it with Torn <code>key/info</code> and never stores it.</td><td>Limited</td></tr>
</table>
<p>Source and issues: <a href="https://github.com/Yoonutz/torn-scripts/tree/main/Torn%20OC%20Bestfit">GitHub</a>. Made by <a href="https://www.torn.com/profiles.php?XID=2805199">KamiRen [2805199]</a>.</p>
