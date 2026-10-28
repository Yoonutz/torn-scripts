// Torn's own look for every kit script. Colors, gradients and shadows come from the CSS variables
// Torn itself defines on the page (title bars, tabs, buttons, inputs, panels), so the scripts follow
// Torn's dark and light mode. The value after each comma is Torn's dark mode value, used only where
// a page lacks the variable (taken from torn.com computed styles, 2026-10-28). Plug-ins draw with
// var(--occ-*) and never hardcode colors. No native controls: buttons, inputs and scrollbars are
// all restyled here. Torn's page CSS colors bare elements (td, li, p, label, h3...) for its own
// layout, so every such element here inherits the script's text color instead, in both modes.
// color-scheme follows Torn's mode (body.dark-mode) for anything native that is left.
import { el } from './dom.js';

export const THEME_VARS = [
  '--occ-font:12px/1.4 Arial,Helvetica,sans-serif',
  '--occ-bg:var(--main-bg,#191919)',
  '--occ-panel:var(--default-bg-panel-color,#333)',
  '--occ-panel-hi:var(--default-bg-panel-active-color,#444)',
  '--occ-sunk:var(--items-cont-bg-color,#242424)',
  '--occ-raise:var(--default-gray-e4-color,#444)',
  '--occ-line:var(--panel-border-bottom-color,#3b3b3b)',
  '--occ-line2:var(--default-gray-e4-color,#444)',
  '--occ-div-dark:var(--divider-dark-color,#222)',
  '--occ-div-light:var(--divider-light-color,#474747)',
  '--occ-fg:var(--default-color,#ddd)',
  '--occ-hi:var(--default-white-color,#fff)',
  '--occ-muted:var(--default-content-title-color,#999)',
  '--occ-dim:var(--default-gray-9-hover-color,#999)',
  '--occ-accent:var(--default-blue-color,#74c0fc)',
  '--occ-accent-hi:var(--default-blue-hover-color,#a5d8ff)',
  '--occ-good:var(--default-green-color,#82c91e)',
  '--occ-ok:var(--default-green-color,#82c91e)',
  '--occ-warn:var(--default-orange-color,#F08C00)',
  '--occ-bad:var(--default-red-color,#E54C19)',
  '--occ-bad-bg:var(--default-bg-red-color,rgba(228,74,27,.15))',
  '--occ-good-bg:var(--default-bg-green-color,rgba(110,160,55,.15))',
  '--occ-code:var(--default-full-text-color,#ccc)',
  '--occ-title-bg:var(--title-black-gradient,linear-gradient(180deg,#555 0%,#333 100%))',
  '--occ-title-fg:var(--title-color,#fff)',
  '--occ-title-shadow:var(--title-text-shadow,0 0 2px #000)',
  '--occ-tabs-bg:var(--tabs-bg-gradient,linear-gradient(180deg,#666 0%,#333 100%))',
  '--occ-tabs-hover-bg:var(--tabs-hover-bg-gradient,linear-gradient(180deg,#555 0%,#444 100%))',
  '--occ-tabs-active-bg:var(--tabs-active-bg-gradient,linear-gradient(180deg,#333 0%,#666 100%))',
  '--occ-tabs-fg:var(--default-tabs-color,#999)',
  '--occ-tabs-active-fg:var(--default-tabs-active-color,#ddd)',
  '--occ-tabs-shadow:var(--tabs-text-shadow,0 0 2px #000)',
  '--occ-btn-fg:var(--btn-color,#eee)',
  '--occ-btn-shadow:var(--btn-text-shadow,0 0 5px #000)',
  '--occ-btn-bg:var(--btn-background,linear-gradient(180deg,#111 0%,#555 25%,#333 60%,#333 78%,#111 100%))',
  '--occ-btn-border:var(--btn-border,1px solid #111)',
  '--occ-btn-hover-fg:var(--btn-hover-color,#fff)',
  '--occ-btn-hover-bg:var(--btn-hover-background,linear-gradient(180deg,#333 0%,#777 25%,#333 59%,#666 78%,#333 100%))',
  '--occ-btn-active-bg:var(--btn-active-background,linear-gradient(180deg,#000 0%,#333 100%))',
  '--occ-input-fg:var(--input-color,#fff)',
  '--occ-input-bg:var(--input-background-color,linear-gradient(0deg,#111 0%,#000 100%))',
  '--occ-input-border:var(--input-border-color,#444)',
  '--occ-input-hover-border:var(--input-hover-border-color,#666)',
  '--occ-input-focus-border:var(--input-focus-border-color,#1864AB80)',
  '--occ-input-focus-shadow:var(--input-focus-box-shadow,0 0 2px #1C7ED6A6)',
  '--occ-tip-bg:var(--tooltip-bg-color,#444)',
  '--occ-tip-border:var(--tooltip-border-color,#333)',
  '--occ-tip-shadow:var(--tooltip-shadow,0 0 2px rgba(0,0,0,.65))',
].join(';');

// R = the script's root selector, e.g. '#occ-root'. Everything is scoped under it, so two kit
// scripts of different versions on one page cannot restyle each other.
export function themeCss(R) {
  return `
    ${R}{${THEME_VARS}}
    ${R},${R} *{box-sizing:border-box}
    ${R} :where(table,thead,tbody,tr,td,th,ul,ol,li,p,dt,dd,label,caption,h1,h2,h3,h4,h5,h6,pre,code,blockquote,small,strong,b,em,i){color:inherit}
    :where(${R}) button{font:var(--occ-font);margin:0;padding:0;border:0;background:none;color:inherit;text-shadow:none;text-transform:none;letter-spacing:normal;appearance:none;-webkit-appearance:none;outline:none;cursor:pointer;-webkit-tap-highlight-color:transparent;height:auto;min-height:0;width:auto;min-width:0;max-width:none;box-shadow:none;text-indent:0;border-radius:0;float:none}
    :where(${R}) button:focus-visible{box-shadow:var(--occ-input-focus-shadow);outline:1px solid var(--occ-input-focus-border)}
    :where(${R}) p,:where(${R}) ul,:where(${R}) ol,:where(${R}) h3,:where(${R}) pre,:where(${R}) table{margin:0;padding:0;font-family:inherit}
    ${R} .occ-scroll{scrollbar-width:thin;scrollbar-color:var(--occ-line2) transparent}
    ${R} .occ-scroll::-webkit-scrollbar{width:8px;height:0}
    ${R} .occ-scroll::-webkit-scrollbar-track{background:transparent}
    ${R} .occ-scroll::-webkit-scrollbar-thumb{background:var(--occ-line2);border-radius:4px;border:2px solid var(--occ-bg)}
    ${R} .occ-title-bar{background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif}
    ${R} .occ-acc{margin-bottom:8px;border-radius:5px;overflow:hidden;background:var(--occ-panel);box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-acc-bar{width:100%;display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;text-align:left;border-bottom:1px solid var(--occ-div-dark)}
    ${R} .occ-acc-bar .occ-n{margin-left:auto;flex:none;background:var(--occ-div-dark);color:var(--occ-fg);border-radius:8px;font:bold 10px/1 Arial,sans-serif;padding:3px 7px;text-shadow:none}
    ${R} .occ-acc-bar .occ-car{flex:none;color:var(--occ-title-fg);opacity:.7;font-size:9px;transition:transform .15s}
    ${R} .occ-acc.occ-shut .occ-acc-bar{border-bottom:0}
    ${R} .occ-acc.occ-shut .occ-acc-bar .occ-car{transform:rotate(-90deg)}
    ${R} .occ-acc-body{padding:8px 10px;border-top:1px solid var(--occ-div-light)}
    ${R} .occ-acc.occ-shut .occ-acc-body{display:none}
    ${R} .occ-card{background:var(--occ-panel);border-radius:5px;padding:10px;margin-bottom:8px;min-width:0;max-width:100%;box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-card h3{margin:-10px -10px 9px;padding:0 10px;height:30px;display:flex;align-items:center;border-radius:5px 5px 0 0;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;border-bottom:1px solid var(--occ-div-dark)}
    ${R} .occ-muted{color:var(--occ-muted);font-size:11.5px;line-height:1.45}
    ${R} .occ-err{background:var(--occ-panel);box-shadow:inset 3px 0 0 var(--occ-bad),0 1px 2px rgba(0,0,0,.35);color:var(--occ-fg)}
    ${R} .occ-err h3{background:var(--title-red-gradient,linear-gradient(180deg,#904B2D 0%,#512A15 100%))}
    ${R} .occ-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--occ-line2);border-top-color:var(--occ-fg);border-radius:50%;animation:occspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
    @keyframes occspin{to{transform:rotate(360deg)}}
    ${R} .occ-bar{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;min-width:0}
    ${R} .occ-act-btn{height:28px;padding:0 12px;border-radius:5px;flex:none;white-space:nowrap;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);text-shadow:var(--occ-btn-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px}
    ${R} .occ-act-btn:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
    ${R} .occ-act-btn:active{background:var(--occ-btn-active-bg)}
    ${R} .occ-act-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    ${R} .occ-cancel{margin-left:auto}
    ${R} .occ-field{display:block;width:100%;height:30px;padding:0 9px;margin:7px 0 2px;border:1px solid var(--occ-input-border);border-radius:5px;background:var(--occ-input-bg);color:var(--occ-input-fg);font:12px/1 Arial,Helvetica,sans-serif;outline:none;appearance:none;-webkit-appearance:none;color-scheme:light}
    body.dark-mode ${R} .occ-field{color-scheme:dark}
    ${R} .occ-field:hover{border-color:var(--occ-input-hover-border)}
    ${R} .occ-field:focus{border-color:var(--occ-input-focus-border);box-shadow:var(--occ-input-focus-shadow)}
    ${R} .occ-field::placeholder{color:var(--occ-muted)}
    ${R} .occ-field::-ms-reveal,${R} .occ-field::-ms-clear{display:none}
    ${R} .occ-field:-webkit-autofill,${R} .occ-field:-webkit-autofill:hover,${R} .occ-field:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 40px #000 inset;-webkit-text-fill-color:var(--occ-input-fg);caret-color:var(--occ-input-fg);transition:background-color 9999s}
    ${R} .occ-md{font:12px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word;min-width:0}
    ${R} .occ-md>:first-child{margin-top:0}
    ${R} .occ-md>:last-child{margin-bottom:0}
    ${R} .occ-md h1,${R} .occ-md h2,${R} .occ-md h3,${R} .occ-md h4{margin:10px 0 5px;color:var(--occ-hi);font:bold 12px/1.3 Arial,Helvetica,sans-serif}
    ${R} .occ-md p{margin:6px 0}
    ${R} .occ-md ul{margin:6px 0;padding-left:16px;list-style:disc outside}
    ${R} .occ-md ol{margin:6px 0;padding-left:18px;list-style:decimal outside}
    ${R} .occ-md li{display:list-item;margin:3px 0;padding-left:2px}
    ${R} .occ-md li::marker{color:var(--occ-muted)}
    ${R} .occ-md code{background:var(--occ-sunk);border-radius:3px;padding:1px 4px;font:11px/1.4 Consolas,Menlo,monospace;color:var(--occ-code);overflow-wrap:anywhere}
    ${R} .occ-md pre{background:var(--occ-sunk);border-radius:5px;padding:8px 10px;margin:6px 0;max-width:100%;overflow:hidden;font:11px/1.5 Consolas,Menlo,monospace;color:var(--occ-code);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
    @media (max-width:420px){${R} .occ-md pre{font-size:10.5px}}
    ${R} .occ-md pre code{padding:0;background:transparent;color:inherit}
    ${R} .occ-md strong{color:var(--occ-hi);font-weight:bold}
    ${R} .occ-md em{color:var(--occ-code)}
    ${R} .occ-md a{color:var(--occ-accent);text-decoration:none}
    ${R} .occ-md a:hover{color:var(--occ-accent-hi);text-decoration:underline}
    ${R} .occ-md hr{border:0;height:2px;margin:10px 0;border-top:1px solid var(--occ-div-dark);border-bottom:1px solid var(--occ-div-light)}
    ${R} .occ-tbl{margin:6px 0;overflow-x:auto;border-radius:5px;background:var(--occ-sunk);scrollbar-width:none}
    ${R} .occ-tbl::-webkit-scrollbar{display:none}
    ${R} .occ-tbl table{border-collapse:collapse;width:100%;font:12px/1.3 Arial,Helvetica,sans-serif}
    ${R} .occ-tbl th,${R} .occ-tbl td{padding:5px 8px;text-align:left;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums}
    ${R} .occ-tbl td{border-top:1px solid var(--occ-div-dark);box-shadow:inset 0 1px 0 var(--occ-div-light)}
    ${R} .occ-tbl th{background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font-weight:bold}
    ${R} .occ-stat{background:var(--occ-panel);border-radius:5px;padding:6px 9px;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-stat .k{font:11px/1.3 Arial,Helvetica,sans-serif;color:var(--occ-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${R} .occ-stat .v{font:bold 15px/1.3 Arial,Helvetica,sans-serif;color:var(--occ-hi);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${R} .occ-stat .v small{font-size:10px;color:var(--occ-muted);font-weight:normal}
    ${R} .occ-stat.occ-hot{background:var(--occ-panel) linear-gradient(var(--occ-good-bg),var(--occ-good-bg))}
    ${R} .occ-stat.occ-hot .v{color:var(--occ-good)}
    ${R} .occ-tip{position:fixed;z-index:2147483600;display:none;pointer-events:none;max-width:260px;padding:6px 9px;background:var(--occ-tip-bg);border:1px solid var(--occ-tip-border);border-radius:5px;font:12px/1.4 Arial,Helvetica,sans-serif;color:var(--occ-fg);box-shadow:var(--occ-tip-shadow);text-align:left}
    ${R} .occ-toast{position:fixed;z-index:2147483600;display:none;max-width:260px;padding:7px 10px;background:var(--occ-tip-bg);border:1px solid var(--occ-tip-border);border-left:3px solid var(--occ-good);border-radius:5px;font:12px/1.4 Arial,Helvetica,sans-serif;color:var(--occ-fg);box-shadow:var(--occ-tip-shadow);cursor:pointer;text-align:left}
    ${R} .occ-toast.bad{border-left-color:var(--occ-bad)}
  `;
}

export function injectTheme(root, R, extra) {
  root.appendChild(el('style', '', themeCss(R) + (extra || '')));
}
