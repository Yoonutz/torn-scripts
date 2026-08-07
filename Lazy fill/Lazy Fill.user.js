// ==UserScript==
// @name         Lazy Fill
// @namespace    lazy-fill-torn
// @version      1.1.0
// @description  Double-click (or double-tap on Torn PDA) any quantity or price input in Torn to fill it instantly: max buy in bazaars, buy/sell max in city shops and Big Al's, foreign travel max, trade fill, check-all boxes, and auto-undercut pricing for your own bazaar (Torn API v2).
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  const CONFIG = {
    autoFillCityShops: true, // pre-fill city shop buy inputs with 100 on page load
    cityShopBuyAmount: 100,  // Torn's per-purchase cap in city shops
    undercutBy: 1,           // list price = lowest market price - undercutBy
    doubleTapMs: 400,        // max gap between two taps to count as a double-tap
  };

  const KEY_STORAGE = 'lazyfill.apikey';

  // Torn PDA rewrites this literal at install time. Untouched, it stays the
  // placeholder, which is how we know we are not running inside PDA.
  // Built by concatenation so PDA's literal search-and-replace cannot rewrite
  // the sentinel we are comparing against.
  const PDA_KEY_PLACEHOLDER = '###' + 'PDA-APIKEY' + '###';
  const PDA_KEY = '###PDA-APIKEY###';

  const IS_PDA = typeof window.flutter_inappwebview !== 'undefined' ||
                 typeof window.PDA_httpGet === 'function' ||
                 /TornPDA/i.test(navigator.userAgent || '');
  const IS_TOUCH = IS_PDA || (window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // ------------------------------------------------------------- utilities
  // Works for both React-rendered and classic inputs: set via the native
  // setter so React's value tracker sees the change, then fire the events
  // each kind of listener expects.
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function fillInput(input, value) {
    if (!input || value === undefined || value === null || value === '') return;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('keyup', { bubbles: true }));
    // Selecting pops the on-screen keyboard on mobile, so only do it on desktop.
    if (!IS_TOUCH) { try { input.select(); } catch (e) { /* not selectable */ } }
  }

  function digits(text) {
    const m = String(text || '').match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
  }

  function ownedQty(text) {
    const m = String(text || '').match(/x\s*([\d,]+)/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  // ------------------------------------------------------------- API key UI
  // window.prompt is unreliable inside PDA's webview, so ask with a real
  // in-page panel instead. Resolves to the key, or null if dismissed.
  let keyPromptOpen = null;
  function askForKey() {
    if (keyPromptOpen) return keyPromptOpen;
    keyPromptOpen = new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);' +
        'display:flex;align-items:center;justify-content:center;padding:16px;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#2b2b2b;color:#eee;border-radius:8px;padding:16px;max-width:340px;' +
        'width:100%;font:14px/1.45 Arial,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);';
      box.innerHTML =
        '<div style="font-weight:bold;margin-bottom:8px">Lazy Fill</div>' +
        '<div style="margin-bottom:10px">Enter your Torn API key to enable auto-pricing. ' +
        'A Public Access key is enough. It is stored in this browser only.</div>';
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'API key';
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;margin-bottom:10px;' +
        'border:1px solid #555;border-radius:4px;background:#1e1e1e;color:#eee;font-size:16px;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
      const cancel = document.createElement('button');
      const save = document.createElement('button');
      cancel.textContent = 'Cancel';
      save.textContent = 'Save';
      const btnCss = 'padding:8px 14px;border-radius:4px;border:1px solid #555;cursor:pointer;font-size:14px;';
      cancel.style.cssText = btnCss + 'background:#3a3a3a;color:#ddd;';
      save.style.cssText = btnCss + 'background:#4a7d3f;color:#fff;border-color:#4a7d3f;';
      row.append(cancel, save);
      box.append(input, row);
      wrap.append(box);
      document.body.append(wrap);
      input.focus();

      const close = (value) => {
        wrap.remove();
        keyPromptOpen = null;
        resolve(value);
      };
      save.addEventListener('click', () => {
        const v = input.value.trim();
        if (v) localStorage.setItem(KEY_STORAGE, v);
        close(v || null);
      });
      cancel.addEventListener('click', () => close(null));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    });
    return keyPromptOpen;
  }

  async function getApiKey() {
    if (IS_PDA && PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER) return PDA_KEY;
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored) return stored.trim();
    return await askForKey();
  }

  // ------------------------------------------------------------- Torn API
  // PDA's webview allows plain fetch to api.torn.com, but PDA_httpGet is the
  // sanctioned transport there, so prefer it when present.
  async function tornApi(path) {
    const key = await getApiKey();
    if (!key) throw new Error('No API key');
    const url = `https://api.torn.com/v2/${path}`;
    const headers = { Authorization: `ApiKey ${key}` };
    let text;
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, headers);
      text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
    } else {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Bad API response'); }
    if (data.error) {
      if (data.error.code === 2) localStorage.removeItem(KEY_STORAGE); // bad key -> ask again
      throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    }
    return data;
  }

  // Lowest item-market price. Guards against one troll listing far below the
  // pack: if the lowest sits under 75% of the average, use the next price.
  async function lowestMarketPrice(itemId) {
    const data = await tornApi(`market/${itemId}/itemmarket?limit=10`);
    const listings = data?.itemmarket?.listings || [];
    if (!listings.length) return data?.itemmarket?.item?.average_price || null;
    const prices = [...new Set(listings.map((l) => l.price))].sort((a, b) => a - b);
    const avg = data?.itemmarket?.item?.average_price || prices[0];
    if (prices.length > 1 && prices[0] < avg * 0.75) return prices[1];
    return prices[0];
  }

  let itemNameMap = null; // name -> id, fetched once, only if needed
  async function itemIdByName(name) {
    if (!itemNameMap) {
      const data = await tornApi('torn/items?sort=ASC');
      itemNameMap = Object.fromEntries((data.items || []).map((it) => [it.name, it.id]));
    }
    return itemNameMap[name] || null;
  }

  function itemIdFromImg(container) {
    const img = container?.querySelector('img[src*="/images/items/"]');
    const m = img?.src.match(/items\/(\d+)\//);
    return m ? m[1] : null;
  }

  function flashError(input, err) {
    console.warn('[Lazy Fill]', err);
    const old = input.style.outline;
    input.style.outline = '2px solid #c00';
    setTimeout(() => { input.style.outline = old; }, 1200);
  }

  // --------------------------------------------------------------- actions
  // Bazaar (someone else's): fill the buy input with everything available.
  function bazaarMaxBuy(input) {
    const menu = input.closest('div[class*="buyMenu"]') || input.closest('li, div[class*="item"]');
    const amount = digits(menu?.querySelector('span[class*="amount"]')?.innerText);
    fillInput(input, amount ?? input.getAttribute('max') ?? 1);
  }

  // My bazaar -> Add: quantity input, fill with everything I own.
  function bazaarAddMaxQty(input) {
    const li = input.closest('li');
    const qty = ownedQty(li?.querySelector('.name-wrap')?.innerText) ?? ownedQty(li?.innerText);
    fillInput(input, qty ?? 1);
  }

  // My bazaar -> Add: price input, undercut the market.
  async function bazaarAddAutoPrice(input) {
    const li = input.closest('li');
    let itemId = itemIdFromImg(li);
    if (!itemId) {
      const name = li?.querySelector('.name-wrap .t-overflow')?.innerText?.trim();
      if (name) itemId = await itemIdByName(name);
    }
    if (!itemId) throw new Error('Could not identify item');
    const lowest = await lowestMarketPrice(itemId);
    if (lowest) fillInput(input, Math.max(1, lowest - CONFIG.undercutBy));
  }

  // My bazaar -> Manage: quantity input, fill with full listed amount.
  function bazaarManageMaxQty(input) {
    const row = input.closest('div[class*="row"]') || input.closest('li');
    const qty = ownedQty(row?.querySelector('div[class*="desc"]')?.innerText) ?? ownedQty(row?.innerText);
    fillInput(input, qty ?? 1);
  }

  // My bazaar -> Manage: price input, undercut the market.
  async function bazaarManageAutoPrice(input) {
    const row = input.closest('div[class*="row"]') || input.closest('li');
    const itemId = itemIdFromImg(row);
    if (!itemId) throw new Error('Could not identify item');
    const lowest = await lowestMarketPrice(itemId);
    if (lowest) fillInput(input, Math.max(1, lowest - CONFIG.undercutBy));
  }

  // City shops / Big Al's: buy 100, or sell everything owned.
  function cityShopBuyMax(input) {
    fillInput(input, CONFIG.cityShopBuyAmount);
  }

  function cityShopSellAll(input) {
    const ul = input.closest('ul') || input.closest('li');
    const qty = ownedQty(ul?.querySelector('li.desc')?.innerText) ?? ownedQty(ul?.innerText);
    fillInput(input, qty ?? 1);
  }

  // Foreign shops while travelling: fill with remaining carry capacity.
  function foreignMaxBuy(input) {
    const msg = document.querySelector('div.user-info div.msg')?.innerText || '';
    const m = msg.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) {
      fillInput(input, Math.max(0, parseInt(m[2], 10) - parseInt(m[1], 10)));
    } else {
      fillInput(input, input.getAttribute('max') ?? 1);
    }
  }

  // Trade: fill the amount input with everything owned of the selected item.
  function tradeMaxQty(input) {
    const scope = input.closest('form') || document;
    const opt = scope.querySelector('select option:checked');
    const qty = ownedQty(opt?.textContent) ?? ownedQty(input.closest('li')?.innerText);
    fillInput(input, qty ?? 1);
  }

  // Check/uncheck every checkbox of the same item (bazaar add + Big Al's).
  function toggleAllSameItem(label) {
    const li = label.closest('li[data-item], li[data-group]');
    if (!li) return;
    const dataItem = li.getAttribute('data-item');
    if (dataItem) {
      document.querySelectorAll(`li[data-item="${dataItem}"] input[type="checkbox"]`)
        .forEach((cb) => { cb.checked = !cb.checked; });
      return;
    }
    const name = li.querySelector('img')?.getAttribute('alt');
    if (name) {
      document.querySelectorAll(`img[alt="${CSS.escape(name)}"]`).forEach((img) => {
        const box = img.closest('li[data-group]')?.querySelector('input[type="checkbox"]');
        if (box) box.checked = !box.checked;
      });
    }
  }

  // --------------------------------------------------------------- routing
  async function handleTarget(target) {
    if (target?.tagName === 'LABEL' && String(target.className).includes('marker-css')) {
      toggleAllSameItem(target);
      return;
    }
    if (target?.tagName !== 'INPUT') return;
    const input = target;
    const cls = String(input.className || '');
    const page = window.location.pathname;
    const hash = window.location.hash;

    try {
      if (page === '/bazaar.php') {
        if (hash.startsWith('#/add')) {
          if (cls.includes('input-money')) await bazaarAddAutoPrice(input);
          else bazaarAddMaxQty(input);
        } else if (hash.startsWith('#/manage')) {
          if (cls.includes('input-money')) await bazaarManageAutoPrice(input);
          else bazaarManageMaxQty(input);
        } else {
          bazaarMaxBuy(input);
        }
      } else if (page === '/shops.php' || page === '/bigalgunshop.php') {
        if (input.name === 'buyAmount[]') cityShopBuyMax(input);
        else if (input.id.includes('sell') || input.id.includes('item')) cityShopSellAll(input);
      } else if (page === '/trade.php') {
        if (input.name === 'amount') tradeMaxQty(input);
      } else if (input.id.includes('item')) {
        foreignMaxBuy(input); // abroad shop on index.php
      }
    } catch (err) {
      flashError(input, err);
    }
  }

  function isFillable(el) {
    if (!el) return false;
    if (el.tagName === 'LABEL') return String(el.className).includes('marker-css');
    return el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio';
  }

  // Desktop: the browser's own double-click.
  let lastTouchFill = 0;
  document.addEventListener('dblclick', (e) => {
    if (Date.now() - lastTouchFill < 700) return; // already handled as a tap
    handleTarget(e.target);
  });

  // Touch (Torn PDA and mobile browsers): webviews fire dblclick unreliably
  // and double-tap usually means zoom, so detect the pair ourselves.
  let lastTapTarget = null;
  let lastTapTime = 0;
  document.addEventListener('touchend', (e) => {
    const target = e.target;
    if (!isFillable(target)) { lastTapTarget = null; return; }
    const now = Date.now();
    if (lastTapTarget === target && now - lastTapTime < CONFIG.doubleTapMs) {
      e.preventDefault(); // stop the zoom gesture
      lastTapTarget = null;
      lastTapTime = 0;
      lastTouchFill = now;
      handleTarget(target);
    } else {
      lastTapTarget = target;
      lastTapTime = now;
    }
  }, { passive: false });

  // -------------------------------------------------- city shop auto-fill
  if (CONFIG.autoFillCityShops &&
      (location.pathname === '/shops.php' || location.pathname === '/bigalgunshop.php')) {
    const fillShop = () => document.querySelectorAll('input[name="buyAmount[]"]')
      .forEach((input) => fillInput(input, CONFIG.cityShopBuyAmount));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillShop);
    else fillShop();
  }

  // Double-tap zoom on an input is never wanted here.
  const style = document.createElement('style');
  style.textContent = 'input[type="text"],input[type="number"],input[type="tel"]{touch-action:manipulation}';
  (document.head || document.documentElement).append(style);
})();
