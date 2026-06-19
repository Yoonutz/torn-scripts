// ==UserScript==
// @name         Torn Hello World
// @namespace    https://github.com/KamiRen
// @version      1.0.0
// @description  Test script — confirms userscript loads on Torn
// @author       KamiRen
// @match        https://www.torn.com/*
// @icon         https://www.torn.com/favicon.ico
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const badge = document.createElement('div');
    badge.textContent = 'Hello World — userscript loaded';
    badge.style.cssText = [
        'position:fixed',
        'bottom:12px',
        'right:12px',
        'z-index:99999',
        'padding:8px 12px',
        'background:#1b1b1b',
        'color:#7cfc00',
        'font:600 13px/1.2 sans-serif',
        'border:1px solid #7cfc00',
        'border-radius:6px',
        'box-shadow:0 2px 8px rgba(0,0,0,.4)'
    ].join(';');

    document.body.appendChild(badge);
    console.log('[Torn Hello World] loaded OK');
})();