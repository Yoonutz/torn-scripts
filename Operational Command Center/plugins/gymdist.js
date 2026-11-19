// Gym Stat Distribution (was the Greasy Fork script "Torn Gym Stat Distribution"): each battle stat in the gym shows its share of your total, e.g. "(47.30%)".
// Desktop: a small badge in the corner of the stat box. Phone (600 px and less): a second line,
// right-aligned under the stat value, so it never covers the number and never widens the box.
// Data: only the four stat values Torn already prints on gym.php. No API call, nothing on a hidden tab.
// The badge never goes inside Torn's value span: other tools read that text as a plain number.

const STATS = ['strength', 'defense', 'speed', 'dexterity'];
const PHONE = '(max-width: 600px)';

function onPage() {
  return /gym\.php/.test(location.pathname);
}

function statLi(name) {
  return document.querySelector('ul[class*="properties___"] li[class*="' + name + '___"]');
}

function readValue(li) {
  const v = li && li.querySelector('[class*="propertyValue___"]');
  if (!v) return null;
  const m = (v.textContent || '').match(/[\d,]+/);
  return m ? Number(m[0].replace(/,/g, '')) || 0 : null;
}

let lastTotal = null;

function paint() {
  if (document.hidden || !onPage()) return;
  const lis = STATS.map(statLi);
  if (lis.some((li) => !li)) return;
  const vals = lis.map(readValue);
  if (vals.some((v) => v === null)) return;
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return;
  // Torn re-renders one stat at a time; skip a half-loaded state.
  if (lastTotal !== null && total < lastTotal * 0.5) return;
  lastTotal = total;
  const phone = window.matchMedia(PHONE).matches;
  lis.forEach((li, i) => {
    const title = li.querySelector('[class*="propertyTitle___"]');
    const parent = phone && title ? title : li;
    let b = li.querySelector('.occ-gd');
    if (!b) {
      b = document.createElement('span');
      b.className = 'occ-gd';
    }
    if (b.parentElement !== parent) parent.appendChild(b);
    const text = '(' + ((vals[i] / total) * 100).toFixed(2) + '%)';
    if (b.textContent !== text) b.textContent = text;
  });
}

function start() {
  if (!onPage()) return;
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('visibilitychange', later);
  window.matchMedia(PHONE).addEventListener('change', later);
  later();
}

export default {
  id: 'gymdist',
  label: 'Gym Stat Distribution',
  about: 'Gym: each stat as a percent of your total.',
  access: 'public',
  start,
  css: `
    ul[class*="properties___"]>li{position:relative}
    .occ-gd{position:absolute;top:43px;right:6px;font-size:.85em;font-weight:bold;font-variant-numeric:tabular-nums;
      background:rgba(32,32,32,.85);color:#fff;padding:2px 6px;border-radius:4px;pointer-events:none}
    @media ${PHONE}{
      ul[class*="properties___"]>li>[class*="propertyTitle___"]{flex-wrap:wrap}
      [class*="propertyTitle___"]>.occ-gd{position:static;display:block;flex:0 0 100%;order:99;box-sizing:border-box;
        width:100%;text-align:right;font-size:.85em;line-height:1.2;padding:0 0 2px;background:none;color:inherit}
    }
  `,
};
