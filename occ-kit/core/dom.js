// DOM helpers shared by shells and plug-ins.

export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Icons from outside the script land on torn.com as markup: accept only a plain inline <svg>.
export function safeIcon(svg) {
  const s = String(svg || '').trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return '';
  if (/<(script|foreignObject|iframe|image|use|a)[\s>]|\son\w+\s*=|javascript:|href\s*=/i.test(s)) return '';
  return s;
}

export function letterIcon(label) {
  return '<span style="font:bold 15px Arial,Helvetica,sans-serif">' + esc(String(label || '?').charAt(0)) + '</span>';
}
