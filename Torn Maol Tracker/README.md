# Torn M'aol tracker

**Live M'aol and Praetorian status, with the flight time each one costs you and what to do next.**
A small Torn-styled panel in the bottom-left corner of every Torn page.

<p align="center"><img src="screenshot.png" alt="Torn M'aol tracker panel" width="320"></p>

## Features
- **All six NPCs.** Country, HP bar and estimated time until each one falls, from the HP drop over the last 15 min.
- **Your flight times.** Reads your travel perks (airstrip, WLT, travel book), adds the trip home when you are abroad
  and any hospital, jail or flight you are still in. Toggle *business ticket* to see those times.
- **What to do next.** Hit now when one is in your country, fly to the nearest guard you can still reach, skip the
  ones that will die before you land, and M'aol's 15-minute route (defeat order) once the bond breaks.

## Install
1. Get a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)).
2. Install `torn-maol-tracker.user.js` from this folder.
3. Paste a Minimal access API key in the panel. Torn PDA fills it in by itself.

<details><summary><b>How it works</b></summary>

- NPC IDs: M'aol 23, Dyno'salam 100, Nol'dasaym 101, Asmol'yand 102, Sylo'nadam 103, Ladso'myna 104.
- API use: 7 calls a minute (`user/{id}/profile` for the six NPCs, your `user/basic`), +1 `user/travel` only while you fly,
  `user/perks` every 6 h. About 7% of Torn's 100/min key limit. Only while a Torn tab is visible, shared across tabs,
  and once every 10 min when everything is dormant.
- Flight times: standard minutes from the [wiki](https://wiki.torn.com/wiki/Travel), airstrip ×0.7, WLT ×0.5,
  business ×0.3, travel book ×0.75. Real flights vary about 3%.
- Defeat order is only known for guards the script saw die. Earlier ones: [tornstats.com/maol](https://www.tornstats.com/maol).

</details>
