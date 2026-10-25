<p><b>Never miss the start of a Torn event again.</b> Torn's header clock turns red a day before, orange when it's close and green while the event is live, timed to your own event start.</p>
<center>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Event%20Reminder/screenshot.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Event%20Reminder/screenshot.png" alt="Torn Event reminder on desktop" width="620"></a>
<a href="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Event%20Reminder/screenshot-mobile.png"><img src="https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/Torn%20Event%20Reminder/screenshot-mobile.png" alt="Torn Event reminder on a phone" width="190"></a>
</center>
<center><small>Desktop and phone, on the live Torn page. Avatar and key blurred.</small></center>
<h2>What it does</h2>
<ul>
<li><b>Colored clock.</b> Red, orange and green on Torn's own clock icon, with the next event under the time.</li>
<li><b>Your start time.</b> Reads your personal event start from the API or the calendar page.</li>
<li><b>Pick your events.</b> This month, this year or just the next one, a checkbox each.</li>
<li><b>Custom events.</b> Add your own, a whole day or a from-to time, with calendar and clock pickers.</li>
</ul>
<h2>How to use</h2>
<ol>
<li>Open Torn's clock in the header.</li>
<li>⚙ <b>Set API key</b>: reuse one another script saved, or make a calendar-only key on Torn's page.</li>
<li>Untick events you don't care about and set the red / orange / green hours.</li>
</ol>
<h2>Good to know</h2>
<ul>
<li>Settings and events stay in this browser. The API key is stored AES-encrypted.</li>
<li>Calls <code>api.torn.com</code> (<code>torn/calendar</code>, <code>user/calendar</code>) every 6 hours with your key. Torn PDA's key is used automatically.</li>
<li>Without a key, opening the calendar page once is enough: times are read from the page.</li>
</ul>
<details>
<summary><b>Colors and timing</b></summary>
<ul>
<li><b>Red:</b> 24 h or less before an event you watch starts (editable).</li>
<li><b>Orange:</b> 3 h or less before the start (editable).</li>
<li><b>Green:</b> the event is live, or from the hours you set before the start (0 = at start).</li>
<li><b>Ended events:</b> struck through and unticked. Last month's events still running stay in the list.</li>
</ul>
</details>
<p>Source and issues: <a href="https://github.com/Yoonutz/torn-scripts/tree/main/Torn%20Event%20Reminder">GitHub</a></p>
