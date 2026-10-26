<p><b>Where are M'aol's Praetorians, can you still reach them, and what should you do next?</b> A button in Torn's header shows all six Halloween NPCs live, with flight times for your own travel perks.</p>
<center>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Maol%20Tracker/screenshot.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Maol%20Tracker/screenshot.png" alt="Torn M'aol tracker on desktop" width="620"></a>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Maol%20Tracker/screenshot-mobile.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Maol%20Tracker/screenshot-mobile.png" alt="Torn M'aol tracker on a phone" width="190"></a>
</center>
<center><small>Desktop and phone. Demo numbers.</small></center>
<h2>What it does</h2>
<ul>
<li><b>Header button.</b> Next to the binoculars (left of the magnifier on phones), red while M'aol is summoned. Green dot: something to do now. Orange: action on, nothing reachable.</li>
<li><b>All six NPCs.</b> Country, HP bar and time until each one falls, from the HP drop over the last 5 min.</li>
<li><b>Your flight times.</b> Reads your airstrip, WLT and travel book perks, adds the trip home and any hospital, jail or flight time left.</li>
<li><b>What to do next.</b> Hit now, fly to the nearest guard you can still reach, skip the ones that die before you land.</li>
<li><b>M'aol's timetable.</b> Where he is, when he leaves and his next stops with times, even before the bond breaks.</li>
<li><b>Stay or fly.</b> The first stop you can reach while he's still there.</li>
<li><b>Sleeps when there's no event.</b> Zero API calls outside Halloween week. Times show in your own clock.</li>
</ul>
<h2>How to use</h2>
<ol>
<li>Click the new button left of the search magnifier.</li>
<li>Paste a Minimal access API key (Torn PDA fills it in by itself).</li>
<li>Follow the tips; "Have business ticket?" switches the times to business class.</li>
</ol>
<h2>Good to know</h2>
<ul>
<li>Refreshes every 15 s: at most 28 API calls a minute, only while a Torn tab is visible, shared across tabs. Dead NPCs are checked every 10 min. When everything is dormant: 1 call every 10 min in Halloween week, none outside it.</li>
<li>Key and last snapshot stay in this browser (localStorage). Calls go only to api.torn.com.</li>
<li>Never attacks or travels for you: links open the attack or travel page.</li>
<li>Missed some guard deaths? The script learns M'aol's route from his own moves within one loop.</li>
</ul>
<details>
<summary><b>How the numbers work</b></summary>
<ul>
<li><b>Flight times:</b> standard minutes from the Torn wiki, airstrip x0.7, WLT x0.5, business x0.3, travel book x0.75. Real flights vary about 3%.</li>
<li><b>Time left:</b> HP now divided by HP lost per minute over the last 5 min. Under 5% HP M'aol's shield slows the kill, so no time is shown.</li>
<li><b>Reachable:</b> your trip plus 3 min is shorter than the time left.</li>
<li><b>Route:</b> M'aol loops through the dead guards' countries in defeat order, one stop every quarter hour, with no flight. He starts moving before the bond breaks, but can't be hit until all 5 Praetorians fall.</li>
</ul>
</details>
<details>
<summary><b>API key use (Torn API ToS)</b></summary>
<ul>
<li><b>Data storage:</b> only locally, in this browser.</li>
<li><b>Data sharing:</b> nobody.</li>
<li><b>Purpose of use:</b> personal M'aol and Praetorian tracking.</li>
<li><b>Key storage and sharing:</b> stored locally, never shared.</li>
<li><b>Key access level:</b> Minimal.</li>
</ul>
</details>
<p>Source and issues: <a href="https://github.com/Yoonutz/torn-scripts/tree/main/Torn%20Maol%20Tracker">GitHub</a></p>
