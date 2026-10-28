// The floating window both shells draw: title-bar header, stats row, scrolling body, tab bar.
// Phone: fills the screen with a 10px margin. Desktop: 420x640, bottom right.
export function frameCss(R) {
  return `
  ${R} .occ-win{position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99991;display:none;grid-template-rows:34px auto 1fr 50px;grid-template-areas:"head" "stats" "main" "tabs";background:var(--occ-bg);color:var(--occ-fg);font:var(--occ-font);overflow:hidden;text-align:left;color-scheme:dark;border:1px solid var(--occ-div-dark);border-radius:5px;box-shadow:0 0 12px rgba(0,0,0,.7)}
  ${R} .occ-win.occ-on{display:grid}
  ${R} .occ-head{grid-area:head;display:flex;align-items:center;gap:4px;padding:0 4px 0 10px;min-width:0;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);border-bottom:1px solid var(--occ-div-dark)}
  ${R} .occ-title{font:bold 13px/1 Arial,Helvetica,sans-serif;white-space:nowrap;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}
  ${R} .occ-sub{flex:1;min-width:0;font:11px/1 Arial,Helvetica,sans-serif;color:var(--occ-fg);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;padding-right:4px}
  ${R} .occ-sub .occ-dot{color:var(--occ-ok)}
  ${R} .occ-sub .occ-old{color:var(--occ-warn)}
  ${R} .occ-hb{width:26px;height:26px;flex:none;border:var(--occ-btn-border);border-radius:5px;background:var(--occ-btn-bg);color:var(--occ-btn-fg);display:flex;align-items:center;justify-content:center;font:bold 15px/1 Arial,sans-serif;text-shadow:var(--occ-btn-shadow)}
  ${R} .occ-hb svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px #000)}
  ${R} .occ-hb:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
  ${R} .occ-hb:active,${R} .occ-hb.occ-act{background:var(--occ-btn-active-bg)}
  ${R} .occ-hb.occ-busy{opacity:.45;pointer-events:none}
  ${R} .occ-hb[hidden]{display:none}
  ${R} .occ-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 8px 0;min-width:0}
  ${R} .occ-stats:empty{display:none;padding:0}
  ${R} .occ-main{grid-area:main;overflow-x:hidden;overflow-y:auto;padding:8px 8px 12px;min-width:0;position:relative;-webkit-overflow-scrolling:touch;overflow-wrap:anywhere}
  ${R} .occ-main>*{max-width:100%}
  ${R} .occ-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--occ-muted);text-align:center;gap:6px}
  ${R} .occ-tabs{grid-area:tabs;display:flex;background:var(--occ-tabs-bg);border-top:1px solid var(--tabs-border-top-color,#555);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  ${R} .occ-tabs::-webkit-scrollbar{display:none}
  ${R} .occ-tab{flex:1 0 64px;min-width:64px;align-self:stretch;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 4px;font:bold 10px/1 Arial,Helvetica,sans-serif;color:var(--occ-tabs-fg);text-shadow:var(--occ-tabs-shadow);user-select:none;border-left:1px solid var(--tabs-divider-border-left-color,#000);box-shadow:inset 1px 0 0 rgba(255,255,255,.08)}
  ${R} .occ-tab:first-child{border-left:0;box-shadow:none}
  ${R} .occ-tab:hover{background:var(--occ-tabs-hover-bg);color:var(--occ-tabs-active-fg)}
  ${R} .occ-tab svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 2px #00000073)}
  ${R} .occ-tab span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  ${R} .occ-tab.occ-act{background:var(--occ-tabs-active-bg);color:var(--occ-tabs-active-fg)}
  ${R} .occ-tabs:empty::before{content:"No tabs yet";margin:auto;color:var(--occ-muted);font-size:11px}
  ${R} .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:48px;height:48px;border-radius:50%;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.6);user-select:none}
  ${R} .occ-launch.occ-hide{display:none}
  ${R} .occ-launch:hover{background:var(--occ-btn-hover-bg)}
  ${R} .occ-launch:active{background:var(--occ-btn-active-bg)}
  ${R} .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px #000)}
  ${R} .occ-win.occ-solo{grid-template-rows:34px auto 1fr;grid-template-areas:"head" "stats" "main"}
  @media (min-width:768px){
    ${R} .occ-launch{bottom:24px;right:24px}
    ${R} .occ-win{top:auto;left:auto;right:24px;bottom:84px;width:420px;height:640px;max-height:calc(100vh - 108px)}
  }
`;
}
