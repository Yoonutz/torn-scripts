// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.8.10
// @description  One floating dashboard inside Torn. Buttons come from the repo's skills: each runs its skill on a private Cloudflare runner with your Torn key, free OpenRouter models write the answer, and it lands in the content pane. Mobile first, works in Torn PDA.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      occ-runner.yoonutz.workers.dev
// @connect      api.torn.com
// @connect      live.chain-race.workers.dev
// @connect      openrouter.ai
// @run-at       document-idle
// ==/UserScript==
