// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.1.0
// @description  One floating dashboard inside Torn. A sidebar of skill buttons, each one runs a tool and shows its result in the content pane. Mobile first, works in Torn PDA.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.1.0';
  const KEY_OPEN = 'occ.open';
  const KEY_SKILL = 'occ.skill';

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };

  const CSS = `
    .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:52px;height:52px;border-radius:50%;border:1px solid #3c3c3c;background:#1f1f1f;color:#e6e6e6;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.55);font:600 11px/1 Arial,sans-serif;letter-spacing:.5px;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-launch:active{transform:scale(.95)}
    .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-win{position:fixed;inset:0;z-index:99991;display:none;grid-template-rows:48px 1fr;grid-template-columns:56px 1fr;grid-template-areas:"head head" "side main";background:#181818;color:#e6e6e6;font:14px/1.4 Arial,sans-serif;overflow:hidden}
    .occ-win.occ-on{display:grid}
    .occ-head{grid-area:head;display:flex;align-items:center;gap:10px;padding:0 8px 0 14px;background:#222;border-bottom:1px solid #333}
    .occ-title{font-weight:700;font-size:15px;white-space:nowrap}
    .occ-ver{font-size:11px;color:#8a8a8a}
    .occ-sub{flex:1;font-size:12px;color:#9fd37c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
    .occ-x{width:36px;height:36px;border-radius:8px;border:1px solid #3c3c3c;background:#2a2a2a;color:#e6e6e6;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;line-height:1;-webkit-tap-highlight-color:transparent}
    .occ-x:active{background:#383838}
    .occ-side{grid-area:side;display:flex;flex-direction:column;gap:6px;padding:8px 5px;background:#202020;border-right:1px solid #333;overflow:hidden auto;box-sizing:border-box}
    .occ-btn{width:44px;height:44px;border-radius:10px;border:1px solid #3c3c3c;background:#2a2a2a;color:#bdbdbd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-size:9px;letter-spacing:.3px;text-transform:uppercase;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-btn.occ-act{background:#2f4a1f;border-color:#5f9a3a;color:#d6f2c2}
    .occ-btn:active{transform:scale(.95)}
    .occ-main{grid-area:main;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch}
    .occ-main::-webkit-scrollbar,.occ-side::-webkit-scrollbar{width:6px}
    .occ-main::-webkit-scrollbar-thumb,.occ-side::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
    .occ-card{background:#222;border:1px solid #333;border-radius:10px;padding:12px;margin-bottom:10px}
    .occ-card h3{margin:0 0 8px;font-size:13px;color:#9fd37c;text-transform:uppercase;letter-spacing:.5px}
    .occ-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}
    .occ-row .occ-l{width:96px;color:#bdbdbd;flex:none}
    .occ-row .occ-b{flex:1;height:8px;background:#2e2e2e;border-radius:4px;overflow:hidden}
    .occ-row .occ-b i{display:block;height:100%;background:#7cb342;border-radius:4px}
    .occ-row .occ-v{width:84px;text-align:right;font-variant-numeric:tabular-nums;flex:none}
    .occ-list{margin:0;padding:0 0 0 18px}
    .occ-list li{padding:2px 0}
    .occ-muted{color:#8a8a8a;font-size:12px}
    .occ-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#8a8a8a;text-align:center;gap:6px}
    .occ-err{background:#3a1f1f;border-color:#7a3a3a;color:#f2c2c2}
    .occ-spin{display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#9fd37c;border-radius:50%;animation:occspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
    @keyframes occspin{to{transform:rotate(360deg)}}
    @media (min-width:768px){
      .occ-launch{bottom:24px;right:24px}
      .occ-win{inset:auto 24px 88px auto;width:420px;height:640px;max-height:calc(100vh - 112px);border:1px solid #3c3c3c;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
    }
  `;

  const ICON = {
    dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    ledger: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function fmt(n) {
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(n);
  }

  function barRow(label, value, max, suffix) {
    const r = el('div', 'occ-row');
    r.appendChild(el('span', 'occ-l', label));
    const b = el('div', 'occ-b');
    const f = el('i');
    f.style.width = Math.max(2, Math.round((value / max) * 100)) + '%';
    b.appendChild(f);
    r.appendChild(b);
    r.appendChild(el('span', 'occ-v', fmt(value) + (suffix || '')));
    return r;
  }

  const ledgerMock = {
    date: '2026-08-23',
    income: [
      ['Company', 2870000],
      ['Bank', 3850000],
    ],
    networth: 14990000000,
    inventory: 359980000,
    stocks: { ready: 0, locked: 16, below: 401300000 },
    leaks: [
      'Bank matures in 2 days; reinvest same hour, idle day costs 3.85M.',
      '1 company slot empty (11/12).',
      '2 employees carrying inactivity penalty.',
      '1 employee under 100 effectiveness.',
      '401.30M in stocks below payout threshold (SYS, LOS).',
      'Unpaid fees 4.93M.',
      'Faction balance 345.96M earns nothing.',
    ],
    actions: ['Reinvest bank deposit on maturity day.', 'Fill empty company slot.'],
  };

  function renderLedger(d) {
    const wrap = el('div');
    const head = el('div', 'occ-card');
    head.appendChild(el('h3', '', 'Torn Ledger - ' + d.date));
    head.appendChild(el('div', 'occ-muted', 'Mock data. Networth ' + fmt(d.networth) + '. First snapshot, no trend yet.'));
    wrap.appendChild(head);

    const inc = el('div', 'occ-card');
    inc.appendChild(el('h3', '', 'Income per day'));
    const max = Math.max.apply(null, d.income.map((x) => x[1]));
    d.income.forEach((x) => inc.appendChild(barRow(x[0], x[1], max, '/day')));
    inc.appendChild(el('div', 'occ-muted', 'Stock payouts ' + d.stocks.ready + ' ready, ' + d.stocks.locked + ' floors locked.'));
    wrap.appendChild(inc);

    const inv = el('div', 'occ-card');
    inv.appendChild(el('h3', '', 'Inventory'));
    inv.appendChild(barRow('Inventory', d.inventory, d.inventory));
    inv.appendChild(barRow('Below floor', d.stocks.below, d.inventory));
    wrap.appendChild(inv);

    const lk = el('div', 'occ-card');
    lk.appendChild(el('h3', '', 'Leaks'));
    const ul = el('ul', 'occ-list');
    d.leaks.forEach((t) => ul.appendChild(el('li', '', t)));
    lk.appendChild(ul);
    wrap.appendChild(lk);

    const ac = el('div', 'occ-card');
    ac.appendChild(el('h3', '', 'Do this week'));
    const ol = el('ol', 'occ-list');
    d.actions.forEach((t) => ol.appendChild(el('li', '', t)));
    ac.appendChild(ol);
    wrap.appendChild(ac);
    return wrap;
  }

  const skills = [
    {
      id: 'ledger',
      label: 'Ledger',
      icon: ICON.ledger,
      run() {
        return new Promise((res) => setTimeout(() => res(renderLedger(ledgerMock)), 400));
      },
    },
  ];

  let win, main, sub, btns = {};

  async function runSkill(id) {
    const s = skills.find((x) => x.id === id);
    if (!s) return;
    store.set(KEY_SKILL, id);
    main.dataset.ran = "1";
    Object.keys(btns).forEach((k) => btns[k].classList.toggle('occ-act', k === id));
    sub.textContent = s.label;
    main.innerHTML = '';
    main.appendChild(el('div', 'occ-card', '<span class="occ-spin"></span>Running ' + s.label + '...'));
    try {
      const node = await s.run();
      main.innerHTML = '';
      main.appendChild(node);
    } catch (e) {
      main.innerHTML = '';
      main.appendChild(el('div', 'occ-card occ-err', '<h3>' + s.label + ' failed</h3>' + String((e && e.message) || e)));
    }
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on) {
      const last = store.get(KEY_SKILL, null);
      if (last && skills.some((s) => s.id === last) && !main.dataset.ran) runSkill(last);
    }
  }

  function build() {
    if (document.getElementById('occ-root')) return;
    const root = el('div');
    root.id = 'occ-root';
    const style = el('style', '', CSS);
    root.appendChild(style);

    const launch = el('button', 'occ-launch', ICON.dash);
    launch.type = 'button';
    launch.title = 'Operational Command Center';
    launch.addEventListener('click', () => setOpen(!win.classList.contains('occ-on')));
    root.appendChild(launch);

    win = el('div', 'occ-win');
    const head = el('div', 'occ-head');
    head.appendChild(el('span', 'occ-title', 'Command Center'));
    head.appendChild(el('span', 'occ-ver', 'v' + VERSION));
    sub = el('span', 'occ-sub', '');
    head.appendChild(sub);
    const x = el('button', 'occ-x', '&times;');
    x.type = 'button';
    x.addEventListener('click', () => setOpen(false));
    head.appendChild(x);
    win.appendChild(head);

    const side = el('div', 'occ-side');
    skills.forEach((s) => {
      const b = el('button', 'occ-btn', s.icon + '<span>' + s.label + '</span>');
      b.type = 'button';
      b.addEventListener('click', () => runSkill(s.id));
      btns[s.id] = b;
      side.appendChild(b);
    });
    win.appendChild(side);

    main = el('div', 'occ-main');
    main.appendChild(el('div', 'occ-empty', '<div>Pick a skill on the left.</div><div class="occ-muted">' + skills.length + ' available</div>'));
    win.appendChild(main);
    root.appendChild(win);

    document.body.appendChild(root);
    if (store.get(KEY_OPEN, false)) setOpen(true);
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
