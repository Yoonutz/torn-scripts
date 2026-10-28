// The one object every plug-in gets. Plug-ins use only this (or import core modules directly),
// never their own copies of storage, HTTP or theme code.
import { el, esc, safeIcon } from './dom.js';
import { store, keys, vault, isPda } from './storage.js';
import { http, parseJson } from './http.js';
import { torn, tornKey, TornApiError, TORN_ERRORS, KEY_TORN } from './torn.js';
import { ai, aiDirect, KEY_OR } from './ai.js';
import { card, errCard, button, accordion, keyField, tipper, toaster } from './ui.js';
import { mdToHtml, mdSections } from './md.js';

// host: 'occ' inside the Command Center, 'standalone' in a plug-in's own build.
// root: () => the script's root element (tooltips and toasts are appended there).
export function makeKit(host, root) {
  return {
    host,
    version: typeof VERSION !== 'undefined' ? VERSION : 'dev',
    el,
    esc,
    safeIcon,
    store,
    keys,
    vault,
    isPda,
    http,
    parseJson,
    torn,
    tornKey,
    TornApiError,
    TORN_ERRORS,
    KEY_TORN,
    KEY_OR,
    ai: host === 'occ' ? ai : aiDirect,
    ui: { card, errCard, button, accordion, keyField, md: mdToHtml, sections: mdSections },
    tip: tipper(root),
    toast: toaster(root, '.occ-badges'),
  };
}
