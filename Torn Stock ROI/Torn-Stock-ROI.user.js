// ==UserScript==
// @name         Torn Stock Block ROI
// @namespace    kamiren.torn-stock-roi
// @version      1.0.0
// @description  Ranks Torn stock benefit blocks, the bank and TCI by days to break even and ROI, using live prices, item values and your own holdings. Shows what you own and your bank cap (Oil Rig aware). Opens as an overlay on the stock market page, mobile friendly.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/page.php?sid=StockMarket*
// @match        https://www.torn.com/page.php?sid=stocks*
// @grant        none
// ==/UserScript==

/*
 * Adds an ROI button to the stock market page. Pressing it opens a full-screen table of every stock
 * block (increments 1-4), plus the bank and TCI, sorted by how fast they pay themselves back.
 *
 * Torn requests are made only after you press the button (and only when the cached data is older than
 * five minutes) or press Refresh, always with your own API key against api.torn.com. Nothing on the
 * page is read or clicked. Prices, item values, bank rates and your holdings are cached in
 * localStorage as small objects with lists (tsr.account, tsr.market, tsr.selection, tsr.settings,
 * tsr.key), so the table shows instantly on open and refreshes in the background.
 */
(function () {
  'use strict';

  if (document.getElementById('tsr-host')) return;

  // Torn PDA rewrites this literal at install time. Untouched, it stays the placeholder, which is how
  // we know we are not running inside PDA. Built by concatenation so PDA's literal search-and-replace
  // cannot rewrite the sentinel we are comparing against.
  const PDA_KEY_PLACEHOLDER = '###' + 'PDA-APIKEY' + '###';
  const PDA_KEY = '###PDA-APIKEY###';
  const IS_PDA =
    typeof window.flutter_inappwebview !== 'undefined' ||
    typeof window.PDA_httpGet === 'function' ||
    /TornPDA/i.test(navigator.userAgent || '');
  const PDA_KEY_IN_USE = IS_PDA && PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER ? PDA_KEY : '';

  // ------------------------------------------------------------------ styles
  const CSS = `
:host {
  all: initial;
  --page: #191919;
  --panel: #333;
  --panel-hi: #444;
  --row-a: #2e2e2e;
  --row-b: #333;
  --line: #222;
  --text: #ddd;
  --text-dim: #999;
  --text-faint: #696969;
  --green: #99cc00;
  --blue: #74c0fc;
  --red: #e54c19;
  --gold: #ca9800;
  --head: linear-gradient(180deg, #555 0%, #333 100%);
  --btn: linear-gradient(180deg, #111111 0%, #555555 25%, #333333 60%, #333333 78%, #111111 100%);
  --btn-hover: linear-gradient(180deg, #333333 0%, #777777 25%, #333333 59%, #666666 78%, #333333 100%);
  --btn-active: linear-gradient(180deg, #000000 0%, #333333 100%);
  --sel: rgba(110, 160, 55, 0.18);
  --sel-hover: rgba(110, 160, 55, 0.3);
  color-scheme: dark;
}
.ov {
  background: var(--page);
  color: var(--text);
}
.ov {
  margin: 0;
  padding: 12px max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  font:
    12px/1.2 Arial,
    Helvetica,
    sans-serif;
  -webkit-tap-highlight-color: transparent;
}
.wrap {
  max-width: 1040px;
  margin: 0 auto;
}
.titlebar {
  background: var(--head);
  color: #fff;
  text-shadow: 0 0 2px #000;
  font-size: 13px;
  font-weight: 700;
  padding: 9px 10px;
  border-top: 1px solid #222;
  border-bottom: 1px solid #444;
  border-radius: 5px 5px 0 0;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-top: 0;
  border-radius: 0 0 5px 5px;
  margin-bottom: 12px;
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid var(--line);
  box-shadow: 0 1px 0 #ffffff14;
}
.ctl label,
.kr label {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--text-dim);
}
input[type='text'],
input[type='password'] {
  background: linear-gradient(0deg, #111, #000);
  color: #fff;
  border: 1px solid var(--panel-hi);
  border-radius: 4px;
  padding: 6px 8px;
  font: 12px Arial;
  min-width: 260px;
  flex: 1;
}
input[type='text']:hover,
input[type='password']:hover {
  border-color: #666;
  box-shadow: 0 0 2px #ffffff40;
}
input[type='text']:focus,
input[type='password']:focus {
  outline: none;
  border-color: #1864ab80;
  box-shadow: 0 0 2px #1c7ed6a6;
}
option {
  background: #111;
  color: #ddd;
}
select {
  background: linear-gradient(0deg, #111, #000);
  color: #fff;
  border: 1px solid var(--panel-hi);
  border-radius: 4px;
  padding: 5px 6px;
  font: 12px Arial;
}
.dd {
  position: relative;
  display: inline-block;
}
.dd > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 72px;
  height: auto;
  background: linear-gradient(0deg, #111, #000);
  color: #fff;
  border: 1px solid var(--panel-hi);
  border-radius: 4px;
  padding: 5px 8px;
  font: 12px Arial;
  text-shadow: none;
}
.dd > button:active {
  background: linear-gradient(0deg, #111, #000);
  border-color: #666;
  box-shadow: 0 0 2px #ffffff40;
  color: #fff;
  text-shadow: none;
}
.dd > button::after {
  content: '';
  width: 5px;
  height: 5px;
  border-right: 1.5px solid #ccc;
  border-bottom: 1.5px solid #ccc;
  transform: rotate(45deg);
  margin-top: -3px;
}
.dd > button[aria-expanded='true']::after {
  transform: rotate(225deg);
  margin-top: 3px;
}
.dd ul {
  position: absolute;
  z-index: 20;
  left: 0;
  top: calc(100% + 2px);
  min-width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  background: #111;
  border: 1px solid var(--panel-hi);
  border-radius: 4px;
  box-shadow: 0 1px 2px 1px #00000040;
  overflow: hidden;
}
.dd li {
  padding: 6px 8px;
  color: #999;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
}
.dd li:hover {
  background: #222;
  color: #fff;
}
.dd li[aria-selected='true'] {
  background: #213110;
  color: #fff;
}
input[type='checkbox'] {
  accent-color: #82c91e;
}
button,
a.btn {
  background: var(--btn);
  color: #eee;
  border: 1px solid #111;
  border-radius: 5px;
  padding: 0 12px;
  height: 24px;
  font: 700 12px/22px Arial;
  text-shadow: 0 0 5px #000;
  cursor: pointer;
  touch-action: manipulation;
}
button:active,
a.btn:active {
  background: var(--btn-active);
  color: #ddd;
  text-shadow: 0 0 2px #00000073;
  border-color: transparent;
  box-shadow: inset 0 -1px 0 #ffffff12;
}
button:disabled {
  background: var(--btn-active);
  color: #555;
  text-shadow: none;
  border-color: transparent;
  box-shadow: inset 0 -1px 0 #ffffff12;
  cursor: default;
}
a.btn {
  display: inline-block;
  box-sizing: border-box;
  text-decoration: none;
}
:focus-visible {
  outline: 1px solid var(--blue);
  outline-offset: 1px;
}
.st {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.4;
}
.st b {
  color: var(--text);
}
.warn {
  color: #f08c00;
}
.kp {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  background: #2b2b2b;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.kp b {
  color: #fff;
  font-size: 12px;
}
.kp p,
.kp ol {
  margin: 6px 0;
}
.kp ol {
  padding-left: 18px;
}
.kr {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  margin-top: 8px;
}
.sum {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1px;
  background: var(--line);
}
.sum div {
  background: var(--panel);
  padding: 9px 10px;
}
.sum small {
  display: block;
  color: var(--text-dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 5px;
}
.sum b {
  font-size: 15px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.tw {
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
th {
  background: var(--head);
  color: var(--text);
  text-shadow: 0 0 2px #000a;
  font-weight: 700;
  text-align: right;
  padding: 8px;
  border-top: 1px solid #222;
  border-bottom: 1px solid #444;
  border-left: 1px solid #2a2a2a;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
th:first-child {
  border-left: 0;
}
th.l,
td.l {
  text-align: left;
}
th.on {
  color: #fff;
}
th .ar {
  display: inline-block;
  width: 0;
  height: 0;
  margin-left: 6px;
  vertical-align: middle;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}
th .ar.up {
  border-bottom: 5px solid #ccc;
}
th .ar.dn {
  border-top: 5px solid #ccc;
}
td {
  padding: 7px 8px;
  text-align: right;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
tbody tr:nth-child(odd) td {
  background: var(--row-a);
}
tbody tr:nth-child(even) td {
  background: var(--row-b);
}
tbody tr {
  cursor: pointer;
}
tbody tr.s td {
  background: var(--sel);
  box-shadow: inset 0 1px 0 #6ea03733;
}
@media (hover: hover) {
  button:hover,
  a.btn:hover {
    background: var(--btn-hover);
    color: #fff;
    text-shadow: 0 0 5px #ffffff40;
  }
  .dd > button:hover {
    background: linear-gradient(0deg, #111, #000);
    border-color: #666;
    box-shadow: 0 0 2px #ffffff40;
    color: #fff;
    text-shadow: none;
  }
  button:disabled:hover {
    background: var(--btn-active);
    color: #555;
    text-shadow: none;
  }
  tbody tr:hover td {
    background: var(--panel-hi);
  }
  tbody tr.s:hover td {
    background: var(--sel-hover);
  }
}
.acr {
  font-weight: 700;
  color: #fff;
}
.nm {
  display: block;
  color: var(--text-dim);
  font-size: 10px;
  margin-top: 3px;
  font-weight: 400;
}
.sub {
  display: block;
  color: var(--text-dim);
  font-size: 10px;
  margin-top: 3px;
}
.est {
  color: var(--gold);
}
.pill {
  display: inline-block;
  min-width: 30px;
  text-align: center;
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 10px;
  font-weight: 700;
}
.y {
  background: rgba(110, 160, 55, 0.22);
  color: var(--green);
}
.n {
  background: rgba(221, 221, 221, 0.1);
  color: var(--text-dim);
}
.pp {
  background: rgba(240, 140, 0, 0.2);
  color: #f08c00;
}
.ppn {
  display: block;
  color: #f08c00;
  font-size: 10px;
  margin-top: 3px;
}
.d {
  color: var(--text-faint);
}
.hi {
  color: var(--green);
}
.mid {
  color: var(--blue);
}
.lo {
  color: var(--red);
}
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  align-items: center;
  color: var(--text-dim);
  font-size: 11px;
}
.note {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
  padding: 10px;
  border-top: 1px solid var(--line);
  box-shadow: 0 -1px 0 #ffffff14;
}
.note b {
  color: var(--text);
}
.sp {
  flex: 1;
}
[hidden] {
  display: none !important;
}
.mob {
  display: none;
}
.dd ul {
  max-height: 60vh;
  overflow-y: auto;
  max-width: calc(100vw - 32px);
}
/* ---------- phones and small tablets: table becomes cards ---------- */
@media (max-width: 860px) {
  .ov {
    padding-top: 8px;
    padding-left: max(8px, env(safe-area-inset-left));
    padding-right: max(8px, env(safe-area-inset-right));
  }
  .mob {
    display: flex;
  }
  button.mob {
    display: inline-block;
  }
  button,
  a.btn {
    height: 36px;
    line-height: 34px;
    padding: 0 14px;
  }
  .dd > button {
    min-height: 36px;
    padding: 7px 10px;
    font-size: 14px;
  }
  .dd li {
    padding: 11px 12px;
    font-size: 14px;
  }
  input[type='text'],
  input[type='password'] {
    font-size: 16px;
    min-width: 0;
    width: 100%;
    flex: 1 1 100%;
    padding: 9px 10px;
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
  }
  .ctl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-items: end;
  }
  .ctl label,
  .kr label {
    font-size: 12px;
  }
  .ctl > label {
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
  }
  .ctl > label[for='f'] {
    grid-column: 1;
    grid-row: 1;
  }
  .ctl > label[for='inc'] {
    grid-column: 2;
    grid-row: 1;
  }
  .ctl > label[for='so'] {
    grid-column: 1;
    grid-row: 2;
  }
  #sd {
    grid-column: 2;
    grid-row: 2;
  }
  .ctl > label[for='nb'] {
    grid-column: 1/-1;
    grid-row: 3;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  #mine {
    grid-column: 1;
    grid-row: 4;
  }
  #clr {
    grid-column: 2;
    grid-row: 4;
  }
  button {
    white-space: nowrap;
  }
  .dd > button span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ctl .dd {
    display: block;
  }
  .ctl .dd > button {
    width: 100%;
  }
  .ctl .sp,
  .st .sp {
    display: none;
  }
  .ctl button {
    width: 100%;
  }
  #mine,
  #clr {
    align-self: stretch;
  }
  #km:empty {
    display: none;
  }
  #km {
    flex: 1 1 100%;
  }
  .st {
    font-size: 12px;
  }
  #stl {
    flex: 1 1 100%;
  }
  .st button {
    flex: 1 1 40%;
  }
  .kp {
    font-size: 12px;
  }
  .kr button,
  .kr a.btn {
    flex: 1 1 40%;
    text-align: center;
  }
  .sum {
    grid-template-columns: repeat(2, 1fr);
  }
  .sum div:last-child {
    grid-column: 1/-1;
  }
  .sum div {
    padding: 7px 10px;
  }
  .sum small {
    margin-bottom: 3px;
  }
  .tw {
    overflow: visible;
  }
  table,
  tbody {
    display: block;
    min-width: 0;
    width: auto;
  }
  thead {
    display: none;
  }
  tbody tr {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px 10px;
    padding: 11px 10px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
  }
  tbody tr:nth-child(odd) {
    background: var(--row-a);
  }
  tbody tr:nth-child(even) {
    background: var(--row-b);
  }
  tbody tr.s {
    background: var(--sel);
    box-shadow: inset 3px 0 0 #6ea037;
  }
  tbody tr td,
  tbody tr:nth-child(odd) td,
  tbody tr:nth-child(even) td,
  tbody tr.s td {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    text-align: left;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  td[data-l]::before {
    content: attr(data-l);
    display: block;
    color: var(--text-dim);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 3px;
    font-weight: 400;
  }
  td:nth-child(1) {
    grid-column: 1/3;
    grid-row: 1;
  }
  td:nth-child(8) {
    grid-column: 3;
    grid-row: 1;
    text-align: right;
    font-size: 17px;
    font-weight: 700;
  }
  td:nth-child(8)::before {
    font-size: 10px;
    font-weight: 400;
    text-align: right;
  }
  td:nth-child(2) {
    grid-column: 1/3;
    grid-row: 2;
  }
  td:nth-child(9) {
    grid-column: 3;
    grid-row: 2;
    text-align: right;
  }
  td:nth-child(3) {
    grid-column: 1;
    grid-row: 3;
  }
  td:nth-child(4) {
    grid-column: 2;
    grid-row: 3;
  }
  td:nth-child(5) {
    grid-column: 3;
    grid-row: 3;
  }
  td:nth-child(6) {
    grid-column: 1/3;
    grid-row: 4;
  }
  td:nth-child(7) {
    grid-column: 3;
    grid-row: 4;
  }
  .acr {
    font-size: 14px;
  }
  .nm,
  .sub,
  .ppn {
    font-size: 11px;
  }
  .pill {
    padding: 4px 8px;
    font-size: 11px;
  }
  .foot span {
    flex: 1 1 100%;
  }
  .foot button {
    flex: 1 1 100%;
  }
}
@media (min-width: 600px) and (max-width: 860px) {
  tbody tr {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  td:nth-child(1) {
    grid-column: 1/3;
    grid-row: 1;
  }
  td:nth-child(2) {
    grid-column: 3/5;
    grid-row: 1;
  }
  td:nth-child(8) {
    grid-column: 5;
    grid-row: 1;
  }
  td:nth-child(9) {
    grid-column: 6;
    grid-row: 1;
  }
  td:nth-child(3) {
    grid-column: 1;
    grid-row: 2;
  }
  td:nth-child(4) {
    grid-column: 2;
    grid-row: 2;
  }
  td:nth-child(5) {
    grid-column: 3;
    grid-row: 2;
  }
  td:nth-child(6) {
    grid-column: 4/6;
    grid-row: 2;
  }
  td:nth-child(7) {
    grid-column: 6;
    grid-row: 2;
  }
  .ctl {
    grid-template-columns: repeat(4, 1fr);
  }
  .ctl > label[for='f'] {
    grid-column: 1;
    grid-row: 1;
  }
  .ctl > label[for='inc'] {
    grid-column: 2;
    grid-row: 1;
  }
  .ctl > label[for='so'] {
    grid-column: 3;
    grid-row: 1;
  }
  #sd {
    grid-column: 4;
    grid-row: 1;
  }
  .ctl > label[for='nb'] {
    grid-column: 1/3;
    grid-row: 2;
  }
  #mine {
    grid-column: 3;
    grid-row: 2;
  }
  #clr {
    grid-column: 4;
    grid-row: 2;
  }
  .sum {
    grid-template-columns: repeat(5, 1fr);
  }
  .sum div:last-child {
    grid-column: auto;
  }
}
@media (max-width: 380px) {
  .sum b {
    font-size: 14px;
  }
  td:nth-child(8) {
    font-size: 15px;
  }
}

/* ---------- userscript shell: launcher and full-screen overlay ---------- */
.ov {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  overflow: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
}
.fab {
  position: fixed;
  right: 10px;
  bottom: calc(52px + env(safe-area-inset-bottom));
  z-index: 2147482000;
  height: 30px;
  line-height: 28px;
  padding: 0 12px;
  box-shadow: 0 1px 4px #000a;
}
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.xb {
  height: 22px;
  line-height: 20px;
  padding: 0 10px;
}
@media (max-width: 860px) {
  .xb {
    height: 30px;
    line-height: 28px;
  }
}
`;

  // ------------------------------------------------------------------ markup
  const MARKUP = `
<div class="wrap">
<div class="titlebar"><span>Stock Block ROI</span><button id="x" type="button" class="xb">Close</button></div>
<div class="panel">
<div class="ctl">
<label for="f">Show <select id="f"><option value="all">All rows</option><option value="own">Owned</option><option value="not">Not owned</option><option value="sel">Selected</option></select></label>
<label for="nb"><input type="checkbox" id="nb"> Hide Bank and TCI</label>
<label for="inc">Max increment <select id="inc"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
<label class="mob" for="so">Sort <select id="so"><option value="be">Break-even</option><option value="roi">ROI @365d</option><option value="c">Cost</option><option value="p">Payout</option><option value="d">Days / payout</option><option value="i">Increment</option><option value="a">Stock</option><option value="r">Return</option><option value="o">Owned</option></select></label>
<button id="sd" class="mob" type="button" aria-label="Sort direction"></button>
<span class="sp"></span>
<button id="mine" type="button">Select my holdings</button>
<button id="clr" type="button">Clear selection</button>
</div>
<div class="st"><span id="stl"></span><span class="sp"></span><button id="kb" type="button">Add API key</button><button id="rf" type="button">Refresh</button></div>
<div class="kp" id="kp" hidden>
<b>Torn API key</b>
<p>Create a key in Torn with limited access or higher, paste it here and press Save. The key is stored only in this browser (localStorage) and is sent only to api.torn.com.</p>
<div class="kr"><input type="password" id="ki" placeholder="Paste your Torn API key" autocomplete="off" spellcheck="false" aria-label="Torn API key"><label for="ks"><input type="checkbox" id="ks"> Show</label></div>
<div class="kr"><button id="kv" type="button">Save and load</button><a class="btn" href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener">Create a key in Torn</a><button id="kr" type="button">Remove key</button><button id="kd" type="button">Clear cached data</button><button id="kc" type="button">Close</button><span id="km" class="warn"></span></div>
</div>
<div class="sum">
<div><small>Selected cost</small><b id="sc">-</b></div>
<div><small>Income / week</small><b id="sw">-</b></div>
<div><small>Income / 30 days</small><b id="sm">-</b></div>
<div><small>ROI @365d</small><b id="sr">-</b></div>
<div><small>Break-even (days)</small><b id="sb">-</b></div>
</div>
<div class="tw">
<table>
<thead><tr>
<th class="l" data-k="a">Stock<span class="ar"></span></th>
<th class="l" data-k="r">Return<span class="ar"></span></th>
<th data-k="i">Increment<span class="ar"></span></th>
<th data-k="p">Payout value<span class="ar"></span></th>
<th data-k="d">Days per payout<span class="ar"></span></th>
<th data-k="c">Cost<span class="ar"></span></th>
<th data-k="be">Days to break even<span class="ar"></span></th>
<th data-k="roi">ROI @365d<span class="ar"></span></th>
<th data-k="o">Owned?<span class="ar"></span></th>
</tr></thead>
<tbody id="tb"></tbody>
</table>
</div>
<div class="foot"><button id="more" type="button">Show more</button><span>Tap a row to add it to the selection. Tap a column header (or use Sort) to sort.</span></div>
<div class="note">
<b>Rules used.</b> Increment n needs requirement x (2<sup>n</sup> - 1) shares in total and pays n x the base return each cycle (Torn wiki, Stock Market). Cost = shares x price. ROI @365d = yearly payout / cost.<br>
<b>Data.</b> Prices, item market values, bank rates, your bank, property and stock holdings come from the Torn API. Everything is cached in localStorage (tsr.market, tsr.account, tsr.settings, tsr.selection, tsr.key) so the table shows instantly on open, then refreshes in the background. Before the first refresh the page uses a 13 Oct 2026 snapshot.<br>
<b>Bank and TCI.</b> Deposit cap is $2,000,000,000, or $3,000,000,000 when your property is an Oil Rig, for 90 days at the 90-day bank rate. Bank YES = invested at the cap, PARTLY = below it, NO = nothing invested. Merits are detected from your bank profit (x1.5 interest). TCI pays 10% of that interest. The deposit and the shares come back, so break-even there is a yield measure, not a payback.<br>
<b class="est">Estimated:</b> Clothing Cache uses the average market value of 7 cache items. Not included: passive stocks, HRG, BAG, EVL, MCS, CBD.
</div>
</div>
</div>
`;

  // Everything lives in a shadow root so Torn's own CSS cannot touch it and ours cannot leak out.
  const host = document.createElement('div');
  host.id = 'tsr-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<button class="fab" id="fab" type="button" aria-label="Open stock ROI table">ROI</button>' +
    '<div class="ov" id="ov" hidden>' + MARKUP + '</div>';
  document.body.appendChild(host);

  // --------------------------------------------------------------------- app
  var NS = 'tsr.';
  var DAYS = 90;
  var DEF_SETTINGS = {
    filter: 'all',
    maxIncrement: 4,
    hideBank: false,
    sortKey: 'be',
    sortAsc: true,
    limit: 25,
  };
  var DEF_ACCOUNT = {
    updatedAt: 0,
    bank: { invested: 0, profit: 0, durationDays: 0, ratePct: 0, until: 0, meritRatio: 0 },
    property: { id: 0, name: '', oilRig: false },
    holdings: [],
  };
  var DEF_MARKET = {
    updatedAt: 0,
    stocks: [
      {
        id: 1,
        acronym: 'TSB',
        name: 'Torn and Shanghai Banking',
        price: 1171.57,
        requirement: 3000000,
        frequency: 31,
      },
      {
        id: 2,
        acronym: 'TCI',
        name: 'Torn City Investments',
        price: 1158.72,
        requirement: 1500000,
        frequency: 7,
      },
      {
        id: 4,
        acronym: 'LAG',
        name: 'Legal Authorities Group',
        price: 466.83,
        requirement: 750000,
        frequency: 7,
      },
      { id: 5, acronym: 'IOU', name: 'Insured On Us', price: 178.03, requirement: 3000000, frequency: 31 },
      { id: 6, acronym: 'GRN', name: 'Grain', price: 331, requirement: 500000, frequency: 31 },
      {
        id: 7,
        acronym: 'THS',
        name: 'Torn City Health Service',
        price: 389.54,
        requirement: 150000,
        frequency: 7,
      },
      {
        id: 9,
        acronym: 'TCT',
        name: 'The Torn City Times',
        price: 324.15,
        requirement: 100000,
        frequency: 31,
      },
      { id: 10, acronym: 'CNC', name: 'Crude and Co', price: 825.85, requirement: 7500000, frequency: 31 },
      {
        id: 12,
        acronym: 'TMI',
        name: 'TC Music Industries',
        price: 225.64,
        requirement: 6000000,
        frequency: 31,
      },
      {
        id: 15,
        acronym: 'FHG',
        name: 'Feathery Hotels Group',
        price: 874.08,
        requirement: 2000000,
        frequency: 7,
      },
      { id: 16, acronym: 'SYM', name: 'Symbiotic Ltd.', price: 740.37, requirement: 500000, frequency: 7 },
      { id: 17, acronym: 'LSC', name: 'Lucky Shot Casino', price: 588.4, requirement: 500000, frequency: 7 },
      {
        id: 18,
        acronym: 'PRN',
        name: 'Performance Ribaldry',
        price: 641.37,
        requirement: 1000000,
        frequency: 7,
      },
      {
        id: 19,
        acronym: 'EWM',
        name: 'Eaglewood Mercenary',
        price: 289.08,
        requirement: 1000000,
        frequency: 7,
      },
      {
        id: 24,
        acronym: 'MUN',
        name: 'Munster Beverage Corp.',
        price: 535.62,
        requirement: 5000000,
        frequency: 7,
      },
      {
        id: 31,
        acronym: 'TCC',
        name: 'Torn City Clothing',
        price: 525.63,
        requirement: 7500000,
        frequency: 31,
      },
      {
        id: 32,
        acronym: 'ASS',
        name: 'Alcoholics Synonymous',
        price: 352.08,
        requirement: 1000000,
        frequency: 7,
      },
      { id: 35, acronym: 'PTS', name: 'PointLess', price: 80.22, requirement: 10000000, frequency: 7 },
    ],
    items: [
      { id: 364, name: 'Box of Grenades', marketValue: 1075663 },
      { id: 365, name: 'Box of Medical Supplies', marketValue: 281053 },
      { id: 366, name: 'Erotic DVD', marketValue: 4289131 },
      { id: 367, name: 'Feathery Hotel Coupon', marketValue: 14103730 },
      { id: 368, name: "Lawyer's Business Card", marketValue: 220069 },
      { id: 369, name: 'Lottery Voucher', marketValue: 903341 },
      { id: 370, name: 'Drug Pack', marketValue: 4563825 },
      { id: 817, name: 'Six-Pack of Alcohol', marketValue: 840400 },
      { id: 818, name: 'Six-Pack of Energy Drink', marketValue: 16256461 },
      { id: 1057, name: 'Gentleman Cache', marketValue: 3159732 },
      { id: 1112, name: 'Elegant Cache', marketValue: 3716296 },
      { id: 1113, name: 'Naughty Cache', marketValue: 5730131 },
      { id: 1114, name: 'Elderly Cache', marketValue: 1196313 },
      { id: 1115, name: 'Denim Cache', marketValue: 814900 },
      { id: 1116, name: 'Wannabe Cache', marketValue: 4460561 },
      { id: 1117, name: 'Cutesy Cache', marketValue: 3224683 },
    ],
    bankRates: [
      { days: 7, rate: 35.5 },
      { days: 14, rate: 40.35 },
      { days: 30, rate: 40.89 },
      { days: 60, rate: 47.62 },
      { days: 90, rate: 47.91 },
    ],
    pointPrice: 31099,
  };
  var CACHES = [1057, 1112, 1113, 1114, 1115, 1116, 1117];
  var ITEM_IDS = [364, 365, 366, 367, 368, 369, 370, 817, 818].concat(CACHES);
  /* What each stock pays. cash = money, item = item id, points = points per payout, cache = list of item ids averaged. */
  var RET = [
    { a: 'TSB', t: 'Cash', cash: 50000000 },
    { a: 'IOU', t: 'Cash', cash: 12000000 },
    { a: 'GRN', t: 'Cash', cash: 4000000 },
    { a: 'TCT', t: 'Cash', cash: 1000000 },
    { a: 'CNC', t: 'Cash', cash: 80000000 },
    { a: 'TMI', t: 'Cash', cash: 25000000 },
    { a: 'LAG', t: "Lawyer's Business Card", item: 368 },
    { a: 'THS', t: 'Box of Medical Supplies', item: 365 },
    { a: 'FHG', t: 'Feathery Hotel Coupon', item: 367 },
    { a: 'SYM', t: 'Drug Pack', item: 370 },
    { a: 'LSC', t: 'Lottery Voucher', item: 369 },
    { a: 'PRN', t: 'Erotic DVD', item: 366 },
    { a: 'EWM', t: 'Box of Grenades', item: 364 },
    { a: 'MUN', t: 'Six-Pack of Energy Drink', item: 818 },
    { a: 'ASS', t: 'Six-Pack of Alcohol', item: 817 },
    { a: 'PTS', t: '100 Points', points: 100 },
    { a: 'TCC', t: 'Clothing Cache', cache: CACHES, est: true },
  ];

  /* ---------- storage: one JSON object per key, lists inside ---------- */
  var storageOk = true;
  var Store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem(NS + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(NS + k, JSON.stringify(v));
        return true;
      } catch (e) {
        storageOk = false;
        return false;
      }
    },
    del: function (k) {
      try {
        localStorage.removeItem(NS + k);
      } catch (e) {}
    },
  };
  try {
    localStorage.setItem(NS + 'test', '1');
    localStorage.removeItem(NS + 'test');
  } catch (e) {
    storageOk = false;
  }
  function merge(d, v) {
    var o = {},
      k;
    for (k in d) o[k] = d[k];
    if (v && typeof v === 'object') for (k in v) o[k] = v[k];
    return o;
  }
  var settings = merge(DEF_SETTINGS, Store.get('settings', {}));
  var account = merge(DEF_ACCOUNT, Store.get('account', {}));
  account.bank = merge(DEF_ACCOUNT.bank, account.bank);
  account.property = merge(DEF_ACCOUNT.property, account.property);
  if (!Array.isArray(account.holdings)) account.holdings = [];
  var market = merge(DEF_MARKET, Store.get('market', {}));
  var selection = merge({ initialised: false, rows: [] }, Store.get('selection', {}));
  if (!Array.isArray(selection.rows)) selection.rows = [];
  var apiKey = PDA_KEY_IN_USE || Store.get('key', '') || '';
  var ui = { busy: false, err: '' };

  /* ---------- helpers ---------- */
  function $(i) {
    return root.getElementById(i);
  }
  function fm(v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function sh(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'b';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'm';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(v);
  }
  function when(ms) {
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function stockOf(a) {
    var l = market.stocks,
      i;
    for (i = 0; i < l.length; i++) if (l[i].acronym === a) return l[i];
    l = DEF_MARKET.stocks;
    for (i = 0; i < l.length; i++) if (l[i].acronym === a) return l[i];
    return null;
  }
  function itemVal(id) {
    var l = market.items,
      i;
    for (i = 0; i < l.length; i++) if (l[i].id === id && l[i].marketValue > 0) return l[i].marketValue;
    l = DEF_MARKET.items;
    for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i].marketValue;
    return 0;
  }
  function incOf(a) {
    for (var i = 0; i < account.holdings.length; i++)
      if (account.holdings[i].acronym === a) return account.holdings[i].increment || 0;
    return 0;
  }
  function hasAccount() {
    return account.updatedAt > 0;
  }
  function cap() {
    return account.property.oilRig ? 3e9 : 2e9;
  }
  function rate90() {
    var l = market.bankRates;
    for (var i = 0; i < l.length; i++) if (l[i].days === DAYS) return l[i].rate / 100;
    return 0.4791;
  }
  function unit(r) {
    if (r.cash) return { v: r.cash, sub: 'Cash payout' };
    if (r.item) {
      var v = itemVal(r.item);
      return { v: v, sub: 'Market value ' + fm(v) };
    }
    if (r.points) {
      var p = market.pointPrice || DEF_MARKET.pointPrice;
      return { v: p * r.points, sub: fm(p) + ' per point' };
    }
    var t = 0;
    r.cache.forEach(function (id) {
      t += itemVal(id);
    });
    var a = t / r.cache.length;
    return { v: a, sub: 'Market value ' + fm(a) };
  }

  /* ---------- rows ---------- */
  function buildRows() {
    var rows = [],
      has = hasAccount(),
      cp = cap();
    RET.forEach(function (r) {
      var st = stockOf(r.a);
      if (!st) return;
      var u = unit(r);
      for (var n = 1; n <= 4; n++) {
        rows.push({
          a: r.a,
          nm: st.name,
          rt: r.t,
          sub: u.sub,
          est: r.est,
          i: n,
          pay: u.v * n,
          d: st.frequency,
          c: st.requirement * (Math.pow(2, n) - 1) * st.price,
          own: has && incOf(r.a) >= n,
          key: r.a + n,
          kind: 'stock',
        });
      }
    });
    var tci = stockOf('TCI');
    [
      ['No merits', 1],
      ['10 merits', 1.5],
    ].forEach(function (m) {
      var bi = ((cp * rate90() * DAYS) / 365) * m[1];
      var inv = account.bank.invested;
      rows.push({
        a: 'Bank',
        nm: 'Torn City Bank, ' + m[0],
        rt: 'Bank interest',
        sub: (rate90() * 100).toFixed(2) + '% APR, ' + fm(cp) + ' cap',
        i: m[0],
        pay: bi,
        d: DAYS,
        c: cp,
        own: has && inv >= cp,
        key: 'Bank ' + m[0],
        kind: 'bank',
        m: m[1],
      });
      if (tci)
        rows.push({
          a: 'TCI',
          nm: 'Torn City Investments, ' + m[0],
          rt: '10% bank interest bonus',
          sub: 'On ' + fm(bi) + ' interest',
          i: m[0],
          pay: bi * 0.1,
          d: DAYS,
          c: tci.requirement * tci.price,
          own: has && incOf('TCI') >= 1,
          key: 'TCI ' + m[0],
          kind: 'tci',
          m: m[1],
        });
    });
    rows.forEach(function (r) {
      r.be = r.c / (r.pay / r.d);
      r.roi = (((r.pay / r.d) * 365) / r.c) * 100;
      r.sel = selection.rows.indexOf(r.key) >= 0;
    });
    return rows;
  }
  function ownRank(r) {
    if (!hasAccount()) return 0;
    if (r.kind === 'bank') {
      var v = account.bank.invested;
      return v >= cap() ? 3 : v > 0 ? 2.5 : 0;
    }
    return r.own ? 3 : 0;
  }
  function saveSel() {
    Store.set('selection', selection);
  }
  function selectHoldings(rows) {
    selection.rows = [];
    var merits = account.bank.meritRatio >= 1.4;
    rows.forEach(function (r) {
      if (r.kind === 'stock' && incOf(r.a) === r.i) selection.rows.push(r.key);
      else if (r.kind === 'bank' && account.bank.invested > 0 && (r.m === 1.5) === merits)
        selection.rows.push(r.key);
    });
    selection.initialised = true;
    saveSel();
  }

  /* ---------- drawing ---------- */
  function draw() {
    var rows = buildRows(),
      has = hasAccount(),
      mx = +settings.maxIncrement;
    var list = rows.filter(function (r) {
      if (settings.hideBank && (r.kind === 'bank' || r.kind === 'tci')) return false;
      if (typeof r.i === 'number' && r.i > mx) return false;
      if (settings.filter === 'own') return r.own;
      if (settings.filter === 'not') return !r.own;
      if (settings.filter === 'sel') return r.sel;
      return true;
    });
    var k = settings.sortKey,
      asc = settings.sortAsc;
    list.sort(function (x, y) {
      var a, b;
      if (k === 'a') {
        a = x.a + x.i;
        b = y.a + y.i;
      } else if (k === 'r') {
        a = x.rt;
        b = y.rt;
      } else if (k === 'i') {
        a = typeof x.i === 'number' ? x.i : 0;
        b = typeof y.i === 'number' ? y.i : 0;
      } else if (k === 'p') {
        a = x.pay;
        b = y.pay;
      } else if (k === 'd') {
        a = x.d;
        b = y.d;
      } else if (k === 'c') {
        a = x.c;
        b = y.c;
      } else if (k === 'roi') {
        a = x.roi;
        b = y.roi;
      } else if (k === 'o') {
        a = ownRank(x);
        b = ownRank(y);
      } else {
        a = x.be;
        b = y.be;
      }
      return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
    });
    var h = '',
      cp = cap(),
      iv = account.bank.invested;
    list.slice(0, settings.limit).forEach(function (r) {
      var cls = r.roi >= 35 ? 'hi' : r.roi >= 15 ? 'mid' : 'lo',
        ow;
      if (!has) ow = '<span class="d">-</span>';
      else if (r.kind === 'bank')
        ow =
          iv >= cp
            ? '<span class="pill y">YES</span><span class="sub">' + fm(iv) + '</span>'
            : iv > 0
              ? '<span class="pill pp">PARTLY</span><span class="ppn">' +
                Math.round((iv / cp) * 100) +
                '% of ' +
                sh(cp) +
                '</span>'
              : '<span class="pill n">NO</span>';
      else ow = r.own ? '<span class="pill y">YES</span>' : '<span class="pill n">NO</span>';
      h +=
        '<tr data-k="' +
        esc(r.key) +
        '" class="' +
        (r.sel ? 's' : '') +
        '"><td class="l"><span class="acr">' +
        esc(r.a) +
        '</span><span class="nm">' +
        esc(r.nm) +
        '</span></td>' +
        '<td class="l">' +
        esc(r.rt) +
        '<span class="sub' +
        (r.est ? ' est' : '') +
        '">' +
        (r.est ? 'Est. ' : '') +
        esc(r.sub) +
        '</span></td>' +
        '<td data-l="Increment">' +
        esc(r.i) +
        '</td><td data-l="Payout">' +
        fm(r.pay) +
        '</td><td data-l="Days / payout">' +
        r.d +
        '</td><td data-l="Cost">' +
        fm(r.c) +
        '</td><td data-l="Break-even days">' +
        Math.round(r.be).toLocaleString('en-US') +
        '</td>' +
        '<td data-l="ROI @365d" class="' +
        cls +
        '">' +
        r.roi.toFixed(2) +
        '%</td><td>' +
        ow +
        '</td></tr>';
    });
    $('tb').innerHTML = h;
    $('more').hidden = list.length <= settings.limit;
    $('more').textContent = 'Show more (' + (list.length - settings.limit) + ' left)';
    var so = $('so');
    if (so.value !== k) {
      so.value = k;
      if (so.syncDD) so.syncDD();
    }
    $('sd').textContent = asc ? 'Low to high' : 'High to low';
    root.querySelectorAll('th').forEach(function (t) {
      var on = t.getAttribute('data-k') === k;
      t.className = t.className.replace(' on', '') + (on ? ' on' : '');
      t.querySelector('.ar').className = 'ar' + (on ? (asc ? ' up' : ' dn') : '');
    });
    var c = 0,
      d = 0;
    rows.forEach(function (r) {
      if (r.sel) {
        c += r.c;
        d += r.pay / r.d;
      }
    });
    $('sc').textContent = c ? sh(c) : '-';
    $('sw').textContent = d ? sh(d * 7) : '-';
    $('sm').textContent = d ? sh(d * 30) : '-';
    $('sr').textContent = c ? (((d * 365) / c) * 100).toFixed(1) + '%' : '-';
    $('sb').textContent = c ? Math.round(c / d).toLocaleString('en-US') : '-';
    renderStatus();
  }
  function renderStatus() {
    var p = [];
    if (ui.busy) p.push('<b>Refreshing…</b>');
    if (hasAccount()) {
      p.push('<b>' + (ui.busy ? 'Cached' : 'Account') + '</b> ' + when(account.updatedAt));
      p.push('Bank ' + sh(account.bank.invested) + ' of ' + sh(cap()) + ' cap');
      p.push(
        'Property: ' +
          esc(account.property.name || 'none') +
          (account.property.oilRig && !/oil\s*rig/i.test(account.property.name) ? ' (Oil Rig)' : ''),
      );
    } else
      p.push(apiKey ? 'No account data yet.' : 'No API key saved. Showing the 13 Oct 2026 price snapshot.');
    if (market.updatedAt) p.push('Prices ' + when(market.updatedAt));
    var s = p.join(' · ');
    if (ui.err) s += ' · <span class="warn">' + esc(ui.err) + '</span>';
    if (!storageOk)
      s += ' · <span class="warn">Browser storage is blocked, nothing will be remembered.</span>';
    $('stl').innerHTML = s;
  }

  /* ---------- Torn API ---------- */
  function apiErr(code, msg) {
    var e = new Error(msg);
    e.code = code;
    return e;
  }
  function authHeaders() {
    return { Authorization: 'ApiKey ' + apiKey };
  }
  // Same transport as the other scripts here: PDA_httpGet inside Torn PDA, plain fetch elsewhere.
  async function fetchJson(url) {
    var text;
    try {
      if (typeof window.PDA_httpGet === 'function') {
        var r = await window.PDA_httpGet(url, authHeaders());
        text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
      } else {
        var res = await fetch(url, { headers: authHeaders() });
        text = await res.text();
      }
    } catch (e) {
      throw apiErr('network', 'Could not reach api.torn.com. Check your connection.');
    }
    var j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      throw apiErr('parse', 'Torn returned an unreadable response.');
    }
    if (j && j.error) {
      var c = j.error.code,
        m = j.error.error || 'Torn API error';
      if (c === 2) m = 'Incorrect API key.';
      else if (c === 16) m = 'This key has too low access. Use limited access or higher.';
      else if (c === 5) m = 'Too many requests. Wait a minute and press Refresh.';
      throw apiErr(c, m);
    }
    return j;
  }
  function withComment(u) {
    u.searchParams.set('comment', 'TornStockROI');
    return u.toString();
  }
  async function api(path, params) {
    var u = new URL('https://api.torn.com/v2/' + path);
    Object.keys(params || {}).forEach(function (k) {
      u.searchParams.set(k, params[k]);
    });
    return fetchJson(withComment(u));
  }
  async function apiList(path, params, listKey) {
    var all = [],
      j = await api(path, params),
      pages = 0;
    while (true) {
      all = all.concat((j && j[listKey]) || []);
      var nx = j && j._metadata && j._metadata.links && j._metadata.links.next;
      if (!nx || ++pages >= 6) break;
      j = await fetchJson(nx);
    }
    return all;
  }
  async function refresh() {
    if (!apiKey) {
      ui.err = '';
      draw();
      openKey();
      return;
    }
    if (ui.busy) return;
    ui.busy = true;
    ui.err = '';
    $('rf').disabled = true;
    draw();
    var errs = [];
    var jobs = [
      ['money', api('user/money')],
      ['property', api('user/property')],
      ['stocks', api('user/stocks')],
      ['tstocks', api('torn/stocks')],
      ['bank', api('torn/bank')],
      ['packs', apiList('torn/items', { cat: 'Supply Pack' }, 'items')],
      ['boosters', apiList('torn/items', { cat: 'Booster' }, 'items')],
      ['points', api('market/pointsmarket')],
    ];
    var res = await Promise.allSettled(
      jobs.map(function (j) {
        return j[1];
      }),
    );
    var R = {};
    res.forEach(function (x, i) {
      if (x.status === 'fulfilled') R[jobs[i][0]] = x.value;
      else errs.push(x.reason);
    });
    var bad = errs.filter(function (e) {
      return e.code === 2 || e.code === 16 || e.code === 5 || e.code === 'network';
    });
    try {
      /* account */
      if (R.money && R.property && R.stocks) {
        var cb = (R.money.money && R.money.money.city_bank) || {},
          amt = +cb.amount || 0,
          pr = +cb.profit || 0,
          inv = Math.max(0, amt - pr);
        var ratio =
          inv > 0 && cb.interest_rate && cb.duration
            ? pr / ((((inv * cb.interest_rate) / 100) * cb.duration) / 365)
            : 0;
        var pn =
          (R.property.property && R.property.property.property && R.property.property.property.name) || '';
        var idToAcr = {};
        market.stocks.forEach(function (s) {
          idToAcr[s.id] = s.acronym;
        });
        if (R.tstocks && Array.isArray(R.tstocks.stocks))
          R.tstocks.stocks.forEach(function (s) {
            idToAcr[s.id] = s.acronym;
          });
        var hold = (R.stocks.stocks || []).map(function (x) {
          return {
            id: x.id,
            acronym: idToAcr[x.id] || String(x.id),
            shares: +x.shares || 0,
            increment: (x.bonus && +x.bonus.increment) || 0,
          };
        });
        account = {
          updatedAt: Date.now(),
          bank: {
            invested: inv,
            profit: pr,
            durationDays: +cb.duration || 0,
            ratePct: +cb.interest_rate || 0,
            until: +cb.until || 0,
            meritRatio: ratio,
          },
          property: {
            id: (R.property.property && R.property.property.id) || 0,
            name: pn,
            oilRig: /oil\s*rig/i.test(pn),
          },
          holdings: hold,
        };
        Store.set('account', account);
      }
      /* market */
      var changed = false;
      if (R.tstocks && Array.isArray(R.tstocks.stocks) && R.tstocks.stocks.length) {
        market.stocks = R.tstocks.stocks
          .map(function (s) {
            return {
              id: s.id,
              acronym: s.acronym,
              name: s.name,
              price: +(s.market && s.market.price) || 0,
              requirement: +(s.bonus && s.bonus.requirement) || 0,
              frequency: +(s.bonus && s.bonus.frequency) || 0,
            };
          })
          .filter(function (s) {
            return s.price > 0 && s.requirement > 0 && s.frequency > 0;
          });
        changed = true;
      }
      if (R.bank && Array.isArray(R.bank.bank) && R.bank.bank.length) {
        market.bankRates = R.bank.bank.map(function (b) {
          return { days: +b.days, rate: +b.rate };
        });
        changed = true;
      }
      var its = [].concat(
        R.packs && R.packs.length ? R.packs : [],
        R.boosters && R.boosters.length ? R.boosters : [],
      );
      var got = [];
      its.forEach(function (it) {
        if (ITEM_IDS.indexOf(it.id) >= 0 && it.value && +it.value.market_price > 0)
          got.push({ id: it.id, name: it.name, marketValue: +it.value.market_price });
      });
      if (got.length) {
        market.items = got;
        changed = true;
      }
      if (R.points && Array.isArray(R.points.pointsmarket) && R.points.pointsmarket.length) {
        var lo = Math.min.apply(
          null,
          R.points.pointsmarket.map(function (p) {
            return +p.cost;
          }),
        );
        if (lo > 0) {
          market.pointPrice = lo;
          changed = true;
        }
      }
      if (changed) {
        market.updatedAt = Date.now();
        Store.set('market', market);
      }
      if (hasAccount() && !selection.initialised) selectHoldings(buildRows());
    } catch (e) {
      ui.err = 'Could not read the Torn response (' + e.message + ').';
    }
    if (!ui.err && errs.length) {
      var e0 = bad[0] || errs[0];
      ui.err = e0.message + (errs.length > 1 && !bad.length ? ' (' + errs.length + ' requests failed)' : '');
    }
    ui.busy = false;
    $('rf').disabled = false;
    draw();
  }

  /* ---------- key panel ---------- */
  function openKey() {
    $('kp').hidden = false;
    $('ki').value = '';
    $('km').textContent = apiKey ? 'A key is saved. Paste a new one to replace it.' : '';
    $('ki').focus();
  }
  $('kb').addEventListener('click', function () {
    if ($('kp').hidden) openKey();
    else $('kp').hidden = true;
  });
  $('kc').addEventListener('click', function () {
    $('kp').hidden = true;
  });
  $('ks').addEventListener('change', function () {
    $('ki').type = $('ks').checked ? 'text' : 'password';
  });
  $('kv').addEventListener('click', function () {
    var v = $('ki').value.trim();
    if (!/^[A-Za-z0-9]{16}$/.test(v)) {
      $('km').textContent = 'A Torn API key is 16 letters and digits.';
      return;
    }
    apiKey = v;
    Store.set('key', apiKey);
    $('km').textContent = '';
    $('kp').hidden = true;
    $('ks').checked = false;
    $('ki').type = 'password';
    selection.initialised = false;
    refresh();
  });
  $('ki').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('kv').click();
  });
  $('kr').addEventListener('click', function () {
    apiKey = '';
    Store.del('key');
    $('ki').value = '';
    $('km').textContent = 'Key removed.';
    ui.err = '';
    draw();
  });
  $('kd').addEventListener('click', function () {
    ['account', 'market', 'selection', 'settings'].forEach(Store.del);
    account = merge(DEF_ACCOUNT, {});
    account.bank = merge(DEF_ACCOUNT.bank, {});
    account.property = merge(DEF_ACCOUNT.property, {});
    account.holdings = [];
    market = merge(DEF_MARKET, {});
    selection = { initialised: false, rows: [] };
    $('km').textContent = 'Cached data cleared.';
    draw();
  });

  /* ---------- controls ---------- */
  $('f').value = settings.filter;
  $('inc').value = String(settings.maxIncrement);
  $('nb').checked = !!settings.hideBank;
  function saveSettings() {
    Store.set('settings', settings);
  }
  $('f').addEventListener('change', function () {
    settings.filter = $('f').value;
    saveSettings();
    draw();
  });
  $('inc').addEventListener('change', function () {
    settings.maxIncrement = +$('inc').value;
    saveSettings();
    draw();
  });
  $('nb').addEventListener('change', function () {
    settings.hideBank = $('nb').checked;
    saveSettings();
    draw();
  });
  $('more').addEventListener('click', function () {
    settings.limit += 25;
    saveSettings();
    draw();
  });
  $('clr').addEventListener('click', function () {
    selection.rows = [];
    saveSel();
    draw();
  });
  $('mine').addEventListener('click', function () {
    selectHoldings(buildRows());
    draw();
  });
  $('rf').addEventListener('click', refresh);
  $('tb').addEventListener('click', function (e) {
    var t = e.target.closest('tr');
    if (!t) return;
    var k = t.getAttribute('data-k'),
      i = selection.rows.indexOf(k);
    if (i >= 0) selection.rows.splice(i, 1);
    else selection.rows.push(k);
    saveSel();
    draw();
  });
  function setSort(k, toggle) {
    if (settings.sortKey === k) {
      if (toggle) settings.sortAsc = !settings.sortAsc;
    } else {
      settings.sortKey = k;
      settings.sortAsc = !(k === 'roi' || k === 'p');
    }
    saveSettings();
    draw();
  }
  root.querySelectorAll('th').forEach(function (t) {
    t.addEventListener('click', function () {
      setSort(t.getAttribute('data-k'), true);
    });
  });
  $('so').value = settings.sortKey;
  $('so').addEventListener('change', function () {
    setSort($('so').value, false);
  });
  $('sd').addEventListener('click', function () {
    settings.sortAsc = !settings.sortAsc;
    saveSettings();
    draw();
  });

  /* Torn-style dropdowns */
  root.querySelectorAll('.ctl select').forEach(function (sel) {
    var w = document.createElement('div');
    w.className = 'dd';
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'listbox');
    b.setAttribute('aria-expanded', 'false');
    var lab = sel.closest('label');
    b.setAttribute('aria-label', lab ? lab.firstChild.textContent.trim() : 'Select');
    var tx = document.createElement('span');
    b.appendChild(tx);
    var ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.hidden = true;
    function close() {
      ul.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    }
    function render() {
      tx.textContent = sel.options[sel.selectedIndex].text;
      ul.innerHTML = '';
      Array.prototype.forEach.call(sel.options, function (o, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = o.text;
        li.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
        li.addEventListener('click', function (e) {
          e.preventDefault();
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event('change'));
          close();
          render();
          b.focus();
        });
        ul.appendChild(li);
      });
    }
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (ul.hidden) {
        ul.hidden = false;
        b.setAttribute('aria-expanded', 'true');
      } else close();
    });
    document.addEventListener('click', function (e) {
      // Inside a shadow root the document sees the host as the target, so use the event path.
      if (e.composedPath().indexOf(w) < 0) close();
    });
    w.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        close();
        b.focus();
      }
    });
    sel.syncDD = render;
    sel.style.display = 'none';
    sel.parentNode.insertBefore(w, sel);
    w.appendChild(b);
    w.appendChild(ul);
    render();
  });

  /* ---------- launcher and overlay ---------- */
  var STALE_MS = 5 * 60 * 1000;
  var ov = $('ov');
  if (PDA_KEY_IN_USE) $('kb').hidden = true;

  function openOverlay() {
    ov.hidden = false;
    $('fab').hidden = true;
    draw(); // cached data, instantly
    if (!apiKey) openKey();
    else if (!hasAccount() || Date.now() - account.updatedAt > STALE_MS) refresh();
  }
  function closeOverlay() {
    ov.hidden = true;
    $('fab').hidden = false;
  }
  $('fab').addEventListener('click', openOverlay);
  $('x').addEventListener('click', closeOverlay);
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && !ov.hidden) closeOverlay();
    },
    true,
  );
  // Keep typing in the panel away from Torn's own page shortcuts.
  host.addEventListener('keydown', function (e) {
    e.stopPropagation();
  });

  draw();

})();
