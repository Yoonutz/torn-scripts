// ==UserScript==
// @name         Lazy Fill
// @namespace    https://github.com/Yoonutz/torn-scripts
// @version      1.0.0
// @description  Double-click any quantity or price input in Torn to fill it instantly: max buy in bazaars, buy/sell max in city shops and Big Al's, foreign travel max, trade fill, check-all boxes, and auto-undercut pricing for your own bazaar (Torn API v2).
// @author       Yoonutz
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @match        https://www.torn.com/shops.php*
// @match        https://www.torn.com/bigalgunshop.php*
// @match        https://www.torn.com/trade.php*
// @match        https://www.torn.com/index.php*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  const CONFIG = {
    autoFillCityShops: true, // pre-fill city shop buy inputs with 100 on page load
    cityShopBuyAmount: 100,  // Torn's per-purchase cap in city shops
    undercutBy: 1,           // list price = lowest market price - undercutBy
  };

  const KEY_STORAGE = 'lazyfill.apikey';

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
    try { input.select(); } catch (e) { /* not selectable */ }
  }

  function digits(text) {
    const m = String(text || '').match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
  }

  function ownedQty(text) {
    const m = String(text || '').match(/x([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function getApiKey() {
    let key = localStorage.getItem(KEY_STORAGE);
    if (!key) {
      key = prompt('Lazy Fill: enter your Torn API key (Public Access is enough).\nStored only in your browser.');
      if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function tornApi(path) {
    const key = getApiKey();
    if (!key) throw new Error('No API key');
    const res = await fetch(`https://api.torn.com/v2/${path}`, {
      headers: { Authorization: `ApiKey ${key}` },
    });
    const data = await res.json();
    if (data.error) {
      if (data.error.code === 2) localStorage.removeItem(KEY_STORAGE); // bad key -> re-prompt next time
      throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    }
    return data;
  }

  // Lowest item-market price via API v2. Guards against one troll listing far
  // below the pack: if the lowest sits under 75% of the average, use the next
  // distinct price instead.
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
    const menu = input.closest('div[class*="buyMenu"]');
    const amount = digits(menu?.querySelector('span[class*="amount"]')?.innerText);
    fillInput(input, amount ?? input.getAttribute('max') ?? 1);
  }

  // My bazaar -> Add: quantity input, fill with everything I own.
  function bazaarAddMaxQty(input) {
    const qty = ownedQty(input.closest('li')?.querySelector('.name-wrap')?.innerText);
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
    const row = input.closest('div[class*="row"]');
    const qty = ownedQty(row?.querySelector('div[class*="desc"]')?.innerText);
    fillInput(input, qty ?? 1);
  }

  // My bazaar -> Manage: price input, undercut the market.
  async function bazaarManageAutoPrice(input) {
    const row = input.closest('div[class*="row"]');
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
    const qty = ownedQty(input.closest('ul')?.querySelector('li.desc')?.innerText);
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
  document.addEventListener('dblclick', async (e) => {
    const target = e.target;
    try {
      if (target?.tagName === 'LABEL' && target.className.includes('marker-css')) {
        toggleAllSameItem(target);
        return;
      }
      if (target?.tagName !== 'INPUT') return;
      const input = target;
      const page = window.location.pathname;
      const hash = window.location.hash;

      if (page === '/bazaar.php') {
        if (hash.startsWith('#/add')) {
          if (input.className.includes('input-money')) await bazaarAddAutoPrice(input);
          else bazaarAddMaxQty(input);
        } else if (hash.startsWith('#/manage')) {
          if (input.className.includes('input-money')) await bazaarManageAutoPrice(input);
          else if (input.className.includes('numberInput')) bazaarManageMaxQty(input);
        } else if (input.className.includes('buyAmountInput')) {
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
      if (target?.tagName === 'INPUT') flashError(target, err);
      else console.warn('[Lazy Fill]', err);
    }
  });

  // -------------------------------------------------- city shop auto-fill
  if (CONFIG.autoFillCityShops &&
      (location.pathname === '/shops.php' || location.pathname === '/bigalgunshop.php')) {
    const fillShop = () => document.querySelectorAll('input[name="buyAmount[]"]')
      .forEach((input) => fillInput(input, CONFIG.cityShopBuyAmount));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillShop);
    else fillShop();
  }
})();
