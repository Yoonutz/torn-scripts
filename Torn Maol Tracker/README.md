# Torn M'aol tracker

**Live M'aol and Praetorian status, with the flight time each one costs you and what to do next.**
A button in Torn's header, left of the search, opens a Torn-styled dropdown.

<p align="center">
  <img src="screenshot.png" alt="Torn M'aol tracker on desktop" width="720">
  <img src="screenshot-mobile.png" alt="Torn M'aol tracker on mobile" width="200">
</p>
<p align="center"><sub>Desktop and phone. Demo numbers, mocked API.</sub></p>

## Features
- **Header button.** Sits left of Torn's search. Green dot: something to do now. Orange: action on, nothing reachable.
- **All six NPCs.** Country, HP bar and time until each one falls, from the HP drop over the last 15 min.
- **Your flight times.** Reads your travel perks (airstrip, WLT, travel book), adds the trip home when you are abroad
  and any hospital, jail or flight you are still in. Toggle *business ticket* to see those times.
- **What to do next.** Hit now, fly to the nearest guard you can still reach, skip the ones that die before you land,
  then M'aol's 15-minute route (defeat order) once the bond breaks.

## Install
1. Get a userscript manager ([Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)).
2. Install `torn-maol-tracker.user.js` from this folder.
3. Click the button left of the search and paste a Minimal access API key. Torn PDA fills it in by itself.

<details><summary><b>How it works</b></summary>

- NPC IDs: M'aol 23, Dyno'salam 100, Nol'dasaym 101, Asmol'yand 102, Sylo'nadam 103, Ladso'myna 104.
- API use: refresh every 15 s, 7 calls each (`user/{id}/profile` for the six NPCs, your `user/basic`), so 28 calls a minute,
  +1 `user/travel` per refresh only while you fly, `user/perks` every 6 h. About 28% of Torn's 100/min key limit. Only while a Torn tab is visible, shared across tabs,
  and once every 10 min when everything is dormant.
- Flight times: standard minutes from the [wiki](https://wiki.torn.com/wiki/Travel), airstrip ×0.7, WLT ×0.5,
  business ×0.3, travel book ×0.75. Real flights vary about 3%.
- Defeat order is only known for guards the script saw die. Earlier ones: [tornstats.com/maol](https://www.tornstats.com/maol).

</details>

<details><summary><b>Compliance</b></summary>

Reads the Torn API with your own key, about 28 calls a minute only while a Torn tab is visible. Adds one header button
and a dropdown; never clicks, attacks or travels for you. Links take you to the attack or travel page, you act yourself.
The key and the last snapshot stay in this browser's localStorage.

</details>
