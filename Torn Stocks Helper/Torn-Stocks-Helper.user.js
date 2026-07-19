// ==UserScript==
// @name         Torn Stocks Helper
// @namespace    torn.stocks.helper
// @version      1.0.9
// @description  View-only helper for Torn stocks page. No auto-actions, no extra Torn requests.
// @author       You
// @license      MIT
// @match        https://www.torn.com/page.php?sid=stocks*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.1.5';
    const DEFAULT_BANKROLL = 1000000; // Users must explicitly set this to enable buy/sell recommendations based on bankroll allocation. Defaulting to 1 prevents accidental recommendations.
    const MAX_ROWS_TO_USE = 5;
    const PANEL_POSITION_KEY = 'tsh.panel.position';
    const PANEL_MINIMIZED_KEY = 'tsh.panel.minimized';
    const BANKROLL_KEY = 'tsh.bankroll';
    const LOT_CACHE_KEY = 'tsh.lots.v1';
    const SELL_MIN_PROFIT_USD = 50000;
    const SELL_MIN_PROFIT_PCT = 1.0;

    /**
     * Detect the currently selected time period from the Torn chart dropdown
     * Returns: { code: '7d', label: 'Last week', isShortTerm: true/false }
     */
    function detectChartPeriod() {
        const input = document.querySelector('input[name="chartPeriod"]');
        const periodLabels = {
            live: 'Live',
            '1h': 'Last hour',
            '24h': 'Last day',
            '7d': 'Last week',
            '1m': 'Last month',
            '1y': 'Last year'
        };
        
        if (!input) {
            return { code: '7d', label: 'Last week (default)', isShortTerm: true };
        }

        const code = input.value || 'unknown';
        const dropdownRoot = input.closest('div');
        const selected = dropdownRoot ? dropdownRoot.querySelector('[role="option"][aria-selected="true"]') : null;
        const label = selected ? selected.textContent.trim() : (periodLabels[code] || code);
        
        // Classify short-term vs long-term based on period
        const isShortTerm = ['live', '1h', '24h'].includes(code);
        const isLongTerm = ['1m', '1y'].includes(code);
        
        return { code, label, isShortTerm, isLongTerm };
    }

    function parseMoney(text) {
        if (!text) return 0;
        const cleaned = text.replace(/[$,\s]/g, '');
        const value = Number(cleaned);
        return Number.isFinite(value) ? value : 0;
    }

    function parsePercent(text) {
        if (!text) return 0;
        const match = text.replace(',', '.').match(/-?\d+(\.\d+)?/);
        return match ? Number(match[0]) : 0;
    }

    function formatMoney(value) {
        return '$' + Math.round(value).toLocaleString('en-US');
    }

    function formatNumber(value) {
        return Math.round(value).toLocaleString('en-US');
    }

    function parseBankrollInput(rawValue) {
        if (!rawValue) return null;

        const normalized = String(rawValue).trim().toLowerCase().replace(/,/g, '');
        const match = normalized.match(/^(\d+(?:\.\d+)?)([km]?)$/);
        if (!match) return null;

        const base = Number(match[1]);
        if (!Number.isFinite(base)) return null;

        const suffix = match[2];
        const multiplier = suffix === 'k' ? 1000 : suffix === 'm' ? 1000000 : 1;
        return Math.round(base * multiplier);
    }

    function getSavedBankroll() {
        const raw = localStorage.getItem(BANKROLL_KEY);
        if (!raw) return DEFAULT_BANKROLL;

        const value = Number(raw);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_BANKROLL;
    }

    function saveBankroll(value) {
        if (!Number.isFinite(value) || value <= 0) return;
        localStorage.setItem(BANKROLL_KEY, String(Math.round(value)));
    }

    function loadLotCache() {
        try {
            const raw = sessionStorage.getItem(LOT_CACHE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    }

    function saveLotCache(cache) {
        try {
            sessionStorage.setItem(LOT_CACHE_KEY, JSON.stringify(cache));
        } catch (_) { /* storage full */ }
    }

    /**
     * Calculate a compound investment score based on multiple factors:
     * - Dip severity: larger negative moves score higher
     * - Price level: cheaper stocks are more volatile (higher potential return)
     * - Volatility: extreme moves hint at recovery potential
     * - Time period: adjusts interpretation (live dips are riskier, long-term dips are deeper trends)
     */
    function calculateInvestmentScore(stock, allStocks, period) {
        if (stock.percent >= 0) return 0; // Only consider dips

        // Factor 1: Dip magnitude (0-10)
        const dips = allStocks.filter(s => s.percent < 0).map(s => s.percent);
        const minDip = Math.min(...dips);
        const maxDip = Math.max(...dips);
        const dipRange = maxDip - minDip;
        const dipScore = dipRange > 0
            ? 10 * (stock.percent - maxDip) / (minDip - maxDip)
            : 5;

        // Factor 2: Price level volatility (0-10)
        const priceScore = stock.price < 10 ? 10 : Math.max(0, 10 - (stock.price / 10));

        // Factor 3: Stability indicator adjusted by time period
        // Short-term: small moves are more meaningful; long-term: large moves are more meaningful
        let recoveryPotential = Math.abs(stock.percent) > 2 ? 8 : 4;
        
        if (period.isShortTerm) {
            // In live/1h/24h: even small moves matter
            recoveryPotential = Math.abs(stock.percent) > 0.5 ? 8 : 3;
        } else if (period.isLongTerm) {
            // In 1m/1y: only large moves are significant buying opportunities
            recoveryPotential = Math.abs(stock.percent) > 5 ? 9 : Math.abs(stock.percent) > 2 ? 6 : 2;
        }

        // Final weighted score
        const score = (dipScore * 0.45) + (priceScore * 0.25) + (recoveryPotential * 0.30);
        return Math.max(0, Math.min(10, score));
    }

    /**
     * Calculate risk rating based on volatility, dip severity, and time period context
     */
    function calculateRiskRating(stock, period) {
        const dip = Math.abs(stock.percent);
        
        if (period.isShortTerm) {
            // Short timeframes: tighter thresholds, volatility is normal
            if (dip >= 3) return { level: 'HIGH', emoji: '🔴' };
            if (dip >= 1.5) return { level: 'MED', emoji: '🟡' };
            return { level: 'LOW', emoji: '🟢' };
        } else if (period.isLongTerm) {
            // Long timeframes: larger moves are expected normally
            if (dip >= 10) return { level: 'HIGH', emoji: '🔴' };
            if (dip >= 5) return { level: 'MED', emoji: '🟡' };
            return { level: 'LOW', emoji: '🟢' };
        }
        
        // Default (weekly)
        if (dip >= 5) return { level: 'HIGH', emoji: '🔴' };
        if (dip >= 2.5) return { level: 'MED', emoji: '🟡' };
        return { level: 'LOW', emoji: '🟢' };
    }

    /**
     * Determine if this dip looks temporary (recovery likely) or structural (long-term issue)
     * Interpretation changes based on the time period being analyzed
     */
    function assessRecoveryOutlook(stock, allStocks, period) {
        const dip = Math.abs(stock.percent);
        
        if (period.isShortTerm) {
            // In short timeframes, volatility is expected and reversals are common
            if (dip > 2) {
                return { outlook: 'Likely intraday reversal', confidence: '↑' };
            }
            if (dip > 0.5) {
                return { outlook: 'Minor noise, moderate rebound', confidence: '→' };
            }
            return { outlook: 'Sideways movement', confidence: '=' };
        } else if (period.isLongTerm) {
            // In long timeframes, moves reflect actual company performance
            if (dip > 10) {
                return { outlook: 'Major sell-off, distant recovery', confidence: '↓' };
            }
            if (dip > 5) {
                return { outlook: 'Significant trend, slow recovery', confidence: '↓' };
            }
            return { outlook: 'Stable with minor dips', confidence: '→' };
        }
        
        // Default (weekly)
        if (dip > 4) {
            return { outlook: 'Likely temporary bounce', confidence: '↑' };
        }
        if (dip < 1) {
            return { outlook: 'Potential structural shift', confidence: '↓' };
        }
        return { outlook: 'Moderate recovery expected', confidence: '→' };
    }

    function ensurePanelStyles() {
        if (document.getElementById('tsh-style')) return;

        const style = document.createElement('style');
        style.id = 'tsh-style';
        style.textContent = `
            #torn-stocks-helper-panel {
                position: fixed;
                top: 80px;
                right: 16px;
                width: 460px;
                max-width: calc(100vw - 24px);
                max-height: 78vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                z-index: 99999;
                border-radius: 14px;
                border: 1px solid #30424f;
                background: linear-gradient(165deg, rgba(18, 28, 35, 0.96), rgba(13, 21, 27, 0.96));
                color: #eaf1f5;
                padding: 12px;
                box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
                font-family: "Segoe UI", Tahoma, sans-serif;
                font-size: 13px;
                backdrop-filter: blur(2px);
            }

            #torn-stocks-helper-panel #tsh-body {
                display: flex;
                flex-direction: column;
                overflow: hidden;
                flex: 1;
                min-height: 0;
            }

            #torn-stocks-helper-panel #tsh-content-fixed {
                flex-shrink: 0;
            }

            #torn-stocks-helper-panel #tsh-content-scroll {
                overflow-y: auto;
                overflow-x: hidden;
                flex: 1;
                min-height: 0;
            }

            #torn-stocks-helper-panel .tsh-title {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 17px;
                font-weight: 700;
                margin-bottom: 10px;
                color: #e8f7ff;
                cursor: move;
                user-select: none;
                gap: 8px;
            }

            #torn-stocks-helper-panel .tsh-title-left,
            #torn-stocks-helper-panel .tsh-title-right {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            #torn-stocks-helper-panel .tsh-version {
                font-size: 11px;
                color: #8fb8cc;
                font-weight: 600;
            }

            #torn-stocks-helper-panel .tsh-min-btn {
                width: 24px;
                height: 24px;
                border: 1px solid #3c5565;
                border-radius: 6px;
                background: #13222c;
                color: #cfe7f4;
                cursor: pointer;
                font-weight: 700;
                line-height: 1;
            }

            #torn-stocks-helper-panel .tsh-min-btn:hover {
                background: #1a3040;
            }

            #torn-stocks-helper-panel.tsh-minimized {
                max-height: none;
                overflow: hidden;
            }

            #torn-stocks-helper-panel.tsh-minimized #tsh-body {
                display: none;
            }

            #torn-stocks-helper-panel .tsh-input-label {
                display: block;
                margin-bottom: 8px;
                color: #b9d2de;
                font-weight: 600;
            }

            #torn-stocks-helper-panel .tsh-input {
                width: 100%;
                margin-top: 5px;
                padding: 8px 9px;
                border-radius: 9px;
                border: 1px solid #3c5565;
                background: #12202a;
                color: #ecf6fa;
                outline: none;
                overflow: hidden;
            }

            #torn-stocks-helper-panel #tsh-bankroll {
                padding-left: 24px;
                background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 16"><text x="0" y="12" font-size="12" fill="%236b8fa1" font-family="monospace" font-weight="bold">$</text></svg>');
                background-repeat: no-repeat;
                background-position: left 8px center;
                background-size: 14px 14px;
                background-color: #12202a;
            }

            #torn-stocks-helper-panel .tsh-input:focus {
                border-color: #5aa7d4;
                box-shadow: 0 0 0 2px rgba(90, 167, 212, 0.2);
            }

            #torn-stocks-helper-panel .tsh-refresh {
                width: 100%;
                padding: 9px;
                border: none;
                border-radius: 10px;
                background: linear-gradient(180deg, #2c90d1, #2179ae);
                color: #ffffff;
                cursor: pointer;
                margin-bottom: 10px;
                font-weight: 700;
                letter-spacing: 0.2px;
            }

            #torn-stocks-helper-panel .tsh-refresh:hover {
                filter: brightness(1.08);
            }

            #torn-stocks-helper-panel .tsh-open-btn {
                border: 1px solid #3c5565;
                border-radius: 8px;
                background: #173648;
                color: #cfe7f4;
                padding: 3px 8px;
                font-size: 11px;
                cursor: pointer;
            }

            #torn-stocks-helper-panel .tsh-open-btn:hover {
                background: #1f4359;
            }

            #torn-stocks-helper-panel .tsh-card {
                margin-bottom: 12px;
                padding: 10px;
                border: 1px solid #344a58;
                border-radius: 10px;
                background: rgba(12, 19, 24, 0.7);
            }

            #torn-stocks-helper-panel .tsh-card-title {
                font-weight: 700;
                margin-bottom: 7px;
                color: #8ed0f2;
            }

            #torn-stocks-helper-panel .tsh-decision-title {
                font-weight: 800;
                font-size: 14px;
            }

            #torn-stocks-helper-panel .tsh-decision-reason {
                margin-top: 6px;
                color: #d7e6ee;
                font-size: 12px;
            }

            #torn-stocks-helper-panel .tsh-decision-list {
                margin: 8px 0 0 18px;
                padding: 0;
                color: #b9cad4;
                font-size: 12px;
            }

            #torn-stocks-helper-panel .tsh-table-wrap {
                max-height: 260px;
                overflow: auto;
                border: 1px solid #304552;
                border-radius: 10px;
                overscroll-behavior: contain;
            }

            #torn-stocks-helper-panel .tsh-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
            }

            #torn-stocks-helper-panel .tsh-table thead th {
                position: sticky;
                top: 0;
                background: #15232c;
                color: #a8c4d2;
                text-align: left;
                padding: 6px 7px;
                border-bottom: 1px solid #36515f;
            }

            #torn-stocks-helper-panel .tsh-table td {
                padding: 6px 7px;
                border-bottom: 1px solid #22343f;
                color: #e7f0f5 !important;
            }

            #torn-stocks-helper-panel .tsh-table th {
                color: #bfd5e0 !important;
            }

            #torn-stocks-helper-panel .tsh-table:not(.tsh-plan-table) td strong,
            #torn-stocks-helper-panel .tsh-table:not(.tsh-plan-table) td small,
            #torn-stocks-helper-panel .tsh-table:not(.tsh-plan-table) td span,
            #torn-stocks-helper-panel .tsh-table:not(.tsh-plan-table) td div {
                color: inherit !important;
            }

            #torn-stocks-helper-panel .tsh-plan-table tbody tr td:nth-child(1) {
                color: #d9f2ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-table tbody tr td:nth-child(2) {
                color: #c2d5e0 !important;
            }

            #torn-stocks-helper-panel .tsh-plan-table tbody tr td:nth-child(3) {
                color: #9ef0b8 !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-table tbody tr td:nth-child(4) {
                color: #9ee4ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-table .tsh-plan-score {
                color: #7fd4ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-row-up { color: #86e4a8 !important; }
            #torn-stocks-helper-panel .tsh-row-down { color: #ffaf8c !important; }
            #torn-stocks-helper-panel .tsh-row-flat { color: #98a5ad !important; }

            #torn-stocks-helper-panel .tsh-plan-code {
                color: #d9f2ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-price {
                color: #c2d5e0 !important;
            }

            #torn-stocks-helper-panel .tsh-plan-score {
                color: #7fd4ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-amount {
                color: #9ef0b8 !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-plan-shares {
                color: #9ee4ff !important;
                font-weight: 700;
            }

            #torn-stocks-helper-panel .tsh-risk-low { color: #98e6af !important; }
            #torn-stocks-helper-panel .tsh-risk-med { color: #ffd785 !important; }
            #torn-stocks-helper-panel .tsh-risk-high { color: #ffad8c !important; }

            #torn-stocks-helper-panel .tsh-trend-up { color: #9be9bc !important; }
            #torn-stocks-helper-panel .tsh-trend-mid { color: #9ec7dc !important; }
            #torn-stocks-helper-panel .tsh-trend-down { color: #ffbc9f !important; }

            #torn-stocks-helper-panel .tsh-percent-pill {
                display: inline-block;
                min-width: 58px;
                text-align: center;
                font-weight: 700;
                border-radius: 999px;
                padding: 2px 8px;
                letter-spacing: 0.2px;
            }

            #torn-stocks-helper-panel .tsh-percent-up {
                background: rgba(57, 160, 91, 0.28);
                border: 1px solid rgba(92, 225, 132, 0.45);
                color: #b4f5c6 !important;
            }

            #torn-stocks-helper-panel .tsh-percent-down {
                background: rgba(170, 74, 74, 0.28);
                border: 1px solid rgba(255, 135, 135, 0.42);
                color: #ffc7b6 !important;
            }

            #torn-stocks-helper-panel .tsh-percent-flat {
                background: rgba(111, 125, 134, 0.28);
                border: 1px solid rgba(150, 166, 175, 0.42);
                color: #d4dfe5 !important;
            }

            #torn-stocks-helper-panel .tsh-badge {
                display: inline-block;
                background: #173648;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 11px;
                color: #8fc8e6;
                margin-left: 8px;
            }

            #torn-stocks-helper-panel .tsh-help {
                margin-top: 8px;
                padding: 8px;
                background: #132534;
                border-radius: 8px;
                font-size: 11px;
                color: #b4c5cf;
                line-height: 1.5;
            }

            #torn-stocks-helper-panel .tsh-muted {
                color: #9ab0bb;
            }

            /* Scrollbar styling */
            #torn-stocks-helper-panel::-webkit-scrollbar,
            #torn-stocks-helper-panel .tsh-table-wrap::-webkit-scrollbar,
            #torn-stocks-helper-panel #tsh-content-scroll::-webkit-scrollbar {
                width: 9px;
            }

            #torn-stocks-helper-panel::-webkit-scrollbar-track,
            #torn-stocks-helper-panel .tsh-table-wrap::-webkit-scrollbar-track,
            #torn-stocks-helper-panel #tsh-content-scroll::-webkit-scrollbar-track {
                background: #1a2831;
                border-radius: 4px;
            }

            #torn-stocks-helper-panel::-webkit-scrollbar-thumb,
            #torn-stocks-helper-panel .tsh-table-wrap::-webkit-scrollbar-thumb,
            #torn-stocks-helper-panel #tsh-content-scroll::-webkit-scrollbar-thumb {
                background: #3c5565;
                border-radius: 4px;
                border: 2px solid #1a2831;
            }

            #torn-stocks-helper-panel::-webkit-scrollbar-thumb:hover,
            #torn-stocks-helper-panel .tsh-table-wrap::-webkit-scrollbar-thumb:hover,
            #torn-stocks-helper-panel #tsh-content-scroll::-webkit-scrollbar-thumb:hover {
                background: #5aa7d4;
            }
        `;

        document.head.appendChild(style);
    }

    function ensureLotStyles() {
        if (document.getElementById('tsh-lot-style')) return;

        const style = document.createElement('style');
        style.id = 'tsh-lot-style';
        style.textContent = `
            .tsh-tx-sell-now {
                background: rgba(76, 175, 80, 0.12) !important;
                border-left: 3px solid rgba(76, 175, 80, 0.85) !important;
            }

            .tsh-tx-sell-wait {
                background: rgba(239, 83, 80, 0.10) !important;
                border-left: 3px solid rgba(239, 83, 80, 0.75) !important;
            }

            .tsh-tx-break-even {
                background: rgba(255, 215, 64, 0.13) !important;
                border-left: 3px solid rgba(255, 215, 64, 0.7) !important;
            }

            .tsh-sell-highlight {
                outline: 2px solid #4caf50 !important;
                outline-offset: -2px !important;
            }
        `;
        document.head.appendChild(style);
    }

    function createPanel() {
        ensurePanelStyles();
        const initialBankroll = getSavedBankroll();

        const panel = document.createElement('div');
        panel.id = 'torn-stocks-helper-panel';
        panel.innerHTML = `
            <div class="tsh-title">
                <span class="tsh-title-left">
                    <span>Stocks Helper</span>
                    <span class="tsh-version">v${SCRIPT_VERSION}</span>
                </span>
                <span class="tsh-title-right">
                    <button id="tsh-minimize" class="tsh-min-btn" type="button" title="Minimize">-</button>
                </span>
            </div>
            <div id="tsh-body">
                <div id="tsh-content-fixed">
                    <label class="tsh-input-label">
                        Bankroll:
                        <input id="tsh-bankroll" class="tsh-input" type="text" value="${formatNumber(initialBankroll)}" placeholder="$ e.g. 50k, 2.5m, 400000">
                    </label>
                    <button id="tsh-refresh" class="tsh-refresh">
                        Refresh analysis
                    </button>
                    <div id="tsh-decision"></div>
                </div>
                <div id="tsh-content-scroll">
                    <div id="tsh-content">Reading page...</div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        return panel;
    }

    function savePanelPosition(panel) {
        const rect = panel.getBoundingClientRect();
        localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({
            left: Math.round(rect.left),
            top: Math.round(rect.top)
        }));
    }

    function restorePanelPosition(panel) {
        const raw = localStorage.getItem(PANEL_POSITION_KEY);
        if (!raw) return;

        try {
            const pos = JSON.parse(raw);
            if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;

            panel.style.left = `${Math.max(8, pos.left)}px`;
            panel.style.top = `${Math.max(8, pos.top)}px`;
            panel.style.right = 'auto';
        } catch (_err) {
            // Ignore malformed saved state.
        }
    }

    function setMinimized(panel, minimized) {
        const btn = panel.querySelector('#tsh-minimize');
        if (!btn) return;

        panel.classList.toggle('tsh-minimized', minimized);
        btn.textContent = minimized ? '+' : '-';
        btn.title = minimized ? 'Restore' : 'Minimize';
        localStorage.setItem(PANEL_MINIMIZED_KEY, minimized ? '1' : '0');
    }

    function restoreMinimized(panel) {
        const minimized = localStorage.getItem(PANEL_MINIMIZED_KEY) === '1';
        setMinimized(panel, minimized);
    }

    function makePanelDraggable(panel) {
        const title = panel.querySelector('.tsh-title');
        if (!title) return;

        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        title.addEventListener('mousedown', event => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('button')) return;

            isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            panel.style.right = 'auto';
            event.preventDefault();
        });

        document.addEventListener('mousemove', event => {
            if (!isDragging) return;

            const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
            const maxTop = Math.max(8, window.innerHeight - 48);
            const nextLeft = Math.min(maxLeft, Math.max(8, event.clientX - offsetX));
            const nextTop = Math.min(maxTop, Math.max(8, event.clientY - offsetY));

            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            savePanelPosition(panel);
        });
    }

    function wirePanelControls(panel) {
        const minButton = panel.querySelector('#tsh-minimize');
        if (minButton) {
            minButton.addEventListener('click', () => {
                const willMinimize = !panel.classList.contains('tsh-minimized');
                setMinimized(panel, willMinimize);
            });
        }

        // Keep nested table scrolling isolated from the panel scroll container.
        panel.addEventListener('wheel', (e) => {
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;

            const tableWrap = target.closest('.tsh-table-wrap');
            if (tableWrap instanceof HTMLElement) {
                const isScrollingDown = e.deltaY > 0;
                const isScrollingUp = e.deltaY < 0;
                const isAtBottom = tableWrap.scrollHeight - tableWrap.scrollTop - tableWrap.clientHeight < 1;
                const isAtTop = tableWrap.scrollTop < 1;

                // Never let table wheel events bubble to #tsh-content-scroll.
                e.stopPropagation();

                if ((isScrollingDown && isAtBottom) || (isScrollingUp && isAtTop)) {
                    e.preventDefault();
                }
                return;
            }

            const contentScroll = target.closest('#tsh-content-scroll');
            if (!(contentScroll instanceof HTMLElement)) return;

            const isScrollingDown = e.deltaY > 0;
            const isScrollingUp = e.deltaY < 0;
            const isAtBottom = contentScroll.scrollHeight - contentScroll.scrollTop - contentScroll.clientHeight < 1;
            const isAtTop = contentScroll.scrollTop < 1;

            if ((isScrollingDown && isAtBottom) || (isScrollingUp && isAtTop)) {
                e.preventDefault();
            }
        }, { passive: false });

        // Bankroll input: show current value as placeholder on focus, restore if no changes on blur
        const bankrollInput = panel.querySelector('#tsh-bankroll');
        if (bankrollInput) {
            let originalValue = bankrollInput.value;
            let lastAutoAppliedRaw = '';
            bankrollInput.addEventListener('focus', function() {
                originalValue = this.value;
                this.placeholder = originalValue;
                this.value = '';
                lastAutoAppliedRaw = '';
            });

            bankrollInput.addEventListener('input', function() {
                const raw = this.value.trim();
                const shorthandDone = /^\d+(?:\.\d+)?[km]$/i.test(raw);
                if (!shorthandDone || raw === lastAutoAppliedRaw) return;

                const parsed = parseBankrollInput(raw);
                if (!parsed) return;

                lastAutoAppliedRaw = raw;
                refresh();
            });

            bankrollInput.addEventListener('blur', function() {
                if (this.value === '') {
                    this.value = originalValue;
                }

                const parsed = parseBankrollInput(this.value);
                if (parsed) {
                    this.value = formatNumber(parsed);
                    saveBankroll(parsed);
                }

                this.placeholder = '$ e.g. 50k, 2.5m, 400000';
            });

            bankrollInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    refresh();
                }
            });
        }

        restorePanelPosition(panel);
        restoreMinimized(panel);
        makePanelDraggable(panel);
    }

    function getVisibleStockRows() {
        // Find nodes that look like the stock code/name line, then resolve each to its nearest row container.
        const allNodes = Array.from(document.querySelectorAll('div, li, span, p'));
        const codeNodes = allNodes.filter(node => {
            const text = (node.innerText || '').trim();
            return /^\([A-Z]{2,4}\)\s+/.test(text);
        });

        const seenCodes = new Set();
        const rows = [];

        codeNodes.forEach(node => {
            const codeMatch = (node.innerText || '').match(/^\(([A-Z]{2,4})\)/);
            const code = codeMatch ? codeMatch[1] : '';
            if (!code || seenCodes.has(code)) return;

            let current = node;
            let resolvedRow = null;

            // Climb up to find a row-like ancestor that contains this code with price + percent.
            for (let depth = 0; depth < 10 && current; depth += 1) {
                const text = (current.innerText || '').trim();
                const hasCode = text.includes(`(${code})`);
                const hasPrice = /\$\s*\d+(?:\.\d+)?/.test(text);
                const hasPercent = /-?\d+(?:\.\d+)?%/.test(text);
                const isReasonableSize = text.length < 1200;

                if (hasCode && hasPrice && hasPercent && isReasonableSize) {
                    resolvedRow = current;
                    break;
                }

                current = current.parentElement;
            }

            if (resolvedRow) {
                seenCodes.add(code);
                rows.push(resolvedRow);
            }
        });

        return rows;
    }

    function extractStockData(row) {
        const text = row.innerText.replace(/\n+/g, '\n').trim();

        const codeMatch = text.match(/\(([A-Z]{2,4})\)/);
        const code = codeMatch ? codeMatch[1] : 'N/A';

        const lines = text.split('\n').map(x => x.trim()).filter(Boolean);

        // Try to infer name: the line containing "(XXX)" is usually name/code line
        let name = lines.find(line => line.includes(`(${code})`)) || lines[0] || 'Unknown';

        // Read the real share price from Torn's price tab, and the daily/period move from changePrice___.
        const priceTabEl = row.querySelector('[data-name="priceTab"], li[aria-controls="panel-priceTab"]');
        const changePriceEl = row.querySelector('[class*="changePrice___"]');

        let price = 0;
        let percent = 0;
        let hasDownClass = false;

        if (priceTabEl) {
            const priceLabel = priceTabEl.getAttribute('aria-label') || '';
            const priceLabelMatch = priceLabel.match(/Share stock price:\s*\$(\d+(?:\.\d+)?)/i);
            const priceTextEl = priceTabEl.querySelector('[class*="price___"]');
            const priceText = priceTextEl ? (priceTextEl.innerText || '').trim() : '';
            const priceTextMatch = priceText.match(/(\d+(?:\.\d+)?)/);

            price = priceLabelMatch
                ? Number(priceLabelMatch[1])
                : priceTextMatch
                    ? Number(priceTextMatch[1])
                    : 0;
        }

        if (changePriceEl) {
            const changePriceText = changePriceEl.innerText || '';

            // Percent = percentage value inside changePrice container
            const percentMatch = changePriceText.match(/(\d+(?:\.\d+)?)%/);
            percent = percentMatch ? Number(percentMatch[1]) : 0;

            // Direction = CSS class on elements inside changePrice container
            hasDownClass = !!changePriceEl.querySelector('[class*="down___"]');
        } else {
            // Fallback: extract from full row text if price/change containers are not found
            if (!price) {
                const priceMatch = text.match(/\$\s*(\d+(?:\.\d+)?)/);
                price = priceMatch ? Number(priceMatch[1]) : 0;
            }

            const percentMatches = [...text.matchAll(/-?\d+(?:\.\d+)?%/g)].map(m => m[0]);
            percent = percentMatches.length ? parsePercent(percentMatches[0]) : 0;

            hasDownClass = !!row.querySelector('[class*="down___"]');
        }

        if (hasDownClass && percent > 0) {
            percent = -percent;
        }

        return {
            name,
            code,
            price,
            percent,
            row
        };
    }

    function rankStocks(stocks, period) {
        // Filter valid stocks and enrich with score data
        const validStocks = stocks
            .filter(stock => Number.isFinite(stock.price) && stock.price > 0);

        // Add compound investment scores, adjusted for the current time period
        const scored = validStocks.map(stock => ({
            ...stock,
            score: calculateInvestmentScore(stock, validStocks, period),
            risk: calculateRiskRating(stock, period),
            recovery: assessRecoveryOutlook(stock, validStocks, period)
        }));

        // Rank by score (highest first), breaking ties by dip magnitude
        return scored
            .filter(stock => stock.percent < 0)
            .sort((a, b) => b.score - a.score || a.percent - b.percent);
    }

    function buildAllocations(sortedStocks, bankroll) {
        // Take top-rated picks based on compound score
        const picks = sortedStocks.slice(0, MAX_ROWS_TO_USE);

        if (!picks.length) return [];

        // Weight by investment score (stocks with higher scores get more allocation)
        const weights = picks.map(stock => stock.score + 0.5);
        const totalWeight = weights.reduce((sum, value) => sum + value, 0);

        return picks.map((stock, index) => {
            const allocation = bankroll * 0.5 * (weights[index] / totalWeight); // use 50% bankroll max
            const shares = Math.floor(allocation / stock.price);

            return {
                ...stock,
                allocation,
                shares
            };
        });
    }

    function getBeginnerDecision(allStocks, rankedStocks, allocations, period, bankroll) {
        const maxDeployNow = bankroll * 0.5;
        const upCount = allStocks.filter(s => s.percent > 0).length;
        const downCount = allStocks.filter(s => s.percent < 0).length;

        const timeframeTipByCode = {
            '24h': 'High noise, consider 7d for cleaner pullbacks.',
            '7d': 'Balanced view, confirm direction on 1m.',
            '1m': 'Trend view, check 7d for entry timing.'
        };
        const timeframeTip = timeframeTipByCode[period.code] || 'Compare 7d and 1m together for better entries.';

        if (!allStocks.length) {
            return {
                title: 'WAIT',
                color: '#ff6b6b',
                reason: 'I cannot read stock rows yet.',
                checklist: ['Refresh Torn page and press Refresh analysis again.']
            };
        }

        if (!rankedStocks.length) {
            return {
                title: 'WAIT',
                color: '#f3d26b',
                reason: `No dips in ${period.label.toLowerCase()} (${upCount} up, ${downCount} down).`,
                checklist: [
                    `Do not force a buy when everything is green in ${period.label}.`,
                    timeframeTip
                ]
            };
        }

        const best = rankedStocks[0];
        const dip = Math.abs(best.percent);
        const minDipToBuy = period.isShortTerm ? 1.0 : period.isLongTerm ? 3.0 : 2.0;

        if (dip < minDipToBuy) {
            return {
                title: 'WATCHLIST',
                color: '#8ec5ff',
                reason: `Best dip is ${best.code} at ${best.percent.toFixed(2)}%, still shallow for ${period.label.toLowerCase()}.`,
                checklist: [
                    `Wait for at least -${minDipToBuy.toFixed(1)}% on top candidates.`,
                    'Keep bankroll ready; no rush entry.'
                ]
            };
        }

        const mode = best.risk.level === 'HIGH' ? 'BUY SMALL' : 'BUY NOW';
        const suggestedNow = Math.min(maxDeployNow, allocations.reduce((sum, a) => sum + a.allocation, 0));
        return {
            title: mode,
            color: best.risk.level === 'HIGH' ? '#ff9b6b' : '#8ce38c',
            reason: `${best.code} has a meaningful dip (${best.percent.toFixed(2)}%) with score ${best.score.toFixed(1)}/10.`,
            checklist: [
                `Split ${formatMoney(suggestedNow)} across the Investment Plan below (max 50% bankroll).`,
                `Start with top pick ${best.code}, then follow the suggested split.`,
                'Keep the remaining bankroll as dry powder.'
            ]
        };
    }

    function renderContent(contentEl, allStocks, rankedStocks, allocations, period, bankroll) {
        if (!allStocks.length) {
            contentEl.innerHTML = `<div class="tsh-card" style="color:#ff8b8b;">Could not detect stock rows on this page.</div>`;
            return;
        }

        const decision = getBeginnerDecision(allStocks, rankedStocks, allocations, period, bankroll);

        // Top section: Show ALL stocks, not just negative movers
        const topList = allStocks.slice(0, 35).map(stock => {
            const rowClass = stock.percent < 0 ? 'tsh-row-down' : stock.percent > 0 ? 'tsh-row-up' : 'tsh-row-flat';
            const percentClass = stock.percent < 0 ? 'tsh-percent-down' : stock.percent > 0 ? 'tsh-percent-up' : 'tsh-percent-flat';
            const riskColor = stock.percent < 0 ? '🔴' : stock.percent > 0 ? '🟢' : '⚪';
            return `
                <tr>
                    <td style="padding:4px 6px;">${stock.code}</td>
                    <td style="padding:4px 6px;">${stock.price.toFixed(2)}</td>
                    <td class="${rowClass}" style="padding:4px 6px;"><span class="tsh-percent-pill ${percentClass}">${stock.percent.toFixed(2)}%</span></td>
                    <td style="padding:4px 6px;text-align:center;">${riskColor}</td>
                </tr>
            `;
        }).join('');

        // Investment recommendations with detailed analysis
        const allocationList = allocations.map(stock => `
            <tr style="border-bottom:1px solid #444;">
                <td style="padding:6px;"><span class="tsh-plan-code">${stock.code}</span></td>
                <td style="padding:6px;">
                    <small>
                        <span class="tsh-plan-price">${stock.price.toFixed(2)}</span>
                        · Score: <span class="tsh-plan-score">${stock.score.toFixed(1)}/10</span>
                    </small>
                </td>
                <td style="padding:6px;text-align:right;"><span class="tsh-plan-amount">${formatMoney(stock.allocation)}</span></td>
                <td style="padding:6px;text-align:right;"><span class="tsh-plan-shares">${stock.shares.toLocaleString('en-US')}</span></td>
                <td style="padding:6px;text-align:right;"><button class="tsh-open-btn" data-open-code="${stock.code}" type="button">Open</button></td>
            </tr>
            <tr style="background:#1a1a1a;border-bottom:1px solid #444;">
                <td colspan="5" style="padding:6px;font-size:11px;color:#aaa;">
                    <strong>Risk:</strong>
                    <span class="${stock.risk.level === 'HIGH' ? 'tsh-risk-high' : stock.risk.level === 'MED' ? 'tsh-risk-med' : 'tsh-risk-low'}">${stock.risk.level}</span>
                    · <strong>Trend:</strong>
                    <span class="${stock.recovery.confidence === '↑' ? 'tsh-trend-up' : stock.recovery.confidence === '↓' ? 'tsh-trend-down' : 'tsh-trend-mid'}">${stock.recovery.outlook} ${stock.recovery.confidence}</span>
                </td>
            </tr>
        `).join('');

        const upCount = allStocks.filter(s => s.percent > 0).length;
        const flatCount = allStocks.filter(s => s.percent === 0).length;
        const noOpportunitiesRow = `
            <tr>
                <td colspan="5" style="padding:12px 6px;text-align:center;color:#888;">
                    No buying opportunities right now (${upCount} up, ${flatCount} flat).
                </td>
            </tr>
        `;

        // Period indicator badge
        const periodBadge = `<span class="tsh-badge">${period.label}</span>`;
        const decisionChecklist = decision.checklist.map(item => `<li>${item}</li>`).join('');

        const decisionEl = document.getElementById('tsh-decision');
        if (decisionEl) {
            decisionEl.innerHTML = `
                <div class="tsh-card">
                    <div class="tsh-decision-title" style="color:${decision.color};">Simple Decision: ${decision.title}</div>
                    <div class="tsh-decision-reason">${decision.reason}</div>
                    <ul class="tsh-decision-list">${decisionChecklist}</ul>
                </div>
            `;
        }

        contentEl.innerHTML = `
            <div class="tsh-card">
                <div class="tsh-card-title">All ${allStocks.length} Stocks ${periodBadge}</div>
                <div class="tsh-table-wrap">
                <table class="tsh-table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Price</th>
                            <th>${period.code}</th>
                            <th style="text-align:center;"></th>
                        </tr>
                    </thead>
                    <tbody>${topList}</tbody>
                </table>
                </div>
            </div>

            <div class="tsh-card">
                <div class="tsh-card-title">Investment Plan (50% of ${formatMoney(bankroll)} max)</div>
                <table class="tsh-table tsh-plan-table" style="font-size:12px;">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Price / Score</th>
                            <th style="text-align:right;">Suggested Amount</th>
                            <th style="text-align:right;">Est. Shares</th>
                            <th style="text-align:right;">Open</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allocationList || noOpportunitiesRow}
                    </tbody>
                </table>
            </div>

            <div class="tsh-help">
                <strong style="color:#d9f2ff;">How it works:</strong><br/>
                ✓ Green-only market = WAIT (no dip entries)<br/>
                ✓ Small dip = WATCHLIST, deeper dip = BUY NOW/BUY SMALL<br/>
                ✓ Never deploy more than 50% in one refresh cycle<br/>
                ✓ No auto-buy · No extra Torn requests
            </div>
        `;

        contentEl.querySelectorAll('[data-open-code]').forEach(button => {
            let ignoreNextClick = false;

            const openTarget = () => {
                const code = button.getAttribute('data-open-code');
                const target = allocations.find(stock => stock.code === code);
                if (!target) return;

                const resolveRowByCode = () => {
                    const rows = getVisibleStockRows();
                    return rows.find(row => (row.innerText || '').includes(`(${code})`)) || null;
                };

                const clickStockRegion = (row) => {
                    if (!row) return;
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Prefer the exact Torn click area (change price region) when available.
                    const clickRegion =
                        row.querySelector('[class*="changePrice___"]') ||
                        row.querySelector('[class*="down___"], [class*="up___"]') ||
                        row;

                    clickRegion.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    clickRegion.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    clickRegion.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                };

                const dispatchMouseClick = (element) => {
                    if (!element) return;
                    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                };

                const getRowOwnedTab = (row) => {
                    if (!row) return null;
                    return row.querySelector(
                        'li#ownedTab[class*="stockOwned___"], li[data-name="ownedTab"], li[aria-controls="panel-ownedTab"]'
                    );
                };

                const rowOwnedTabIsActive = (ownedTab) => {
                    if (!ownedTab) return false;
                    return (
                        ownedTab.getAttribute('aria-selected') === 'true' ||
                        ownedTab.classList.contains('active') ||
                        ownedTab.className.includes('active___') ||
                        ownedTab.className.includes('selected')
                    );
                };

                const openRowOwnedTab = (row) => {
                    const ownedTab = getRowOwnedTab(row);
                    if (!ownedTab) return false;

                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    dispatchMouseClick(ownedTab);
                    return true;
                };

                // Use currently available row first to avoid unnecessary tab switching flicker.
                const liveRow = (target.row && target.row.isConnected) ? target.row : resolveRowByCode();
                if (liveRow) {
                    if (openRowOwnedTab(liveRow)) return;
                    clickStockRegion(liveRow);
                    return;
                }

                // Try again from a freshly resolved row and activate its own owned tab first.
                const resolvedRow = resolveRowByCode();
                if (resolvedRow) {
                    if (openRowOwnedTab(resolvedRow)) return;
                    clickStockRegion(resolvedRow);
                    return;
                }

                // Ensure the Owned tab is active before opening the stock panel.
                // Prefer exact selector form seen in Torn DOM: li#ownedTab.stockOwned___*
                const ownedTab = document.querySelector(
                    'li#ownedTab[class*="stockOwned___"], li#ownedTab, [data-name="ownedTab"]'
                );
                const ownedTabIsActive = !!ownedTab && (
                    ownedTab.getAttribute('aria-selected') === 'true' ||
                    ownedTab.classList.contains('active') ||
                    ownedTab.className.includes('active___') ||
                    ownedTab.className.includes('selected')
                );

                if (ownedTab && !ownedTabIsActive) {
                    dispatchMouseClick(ownedTab);
                    window.setTimeout(() => {
                        clickStockRegion(resolveRowByCode());
                    }, 120);
                    return;
                }

                clickStockRegion(resolveRowByCode());
            };

            // Guard against duplicate open events (mousedown + click) on certain Torn UI states.
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                openTarget();
                ignoreNextClick = true;
            });

            button.addEventListener('click', (e) => {
                if (ignoreNextClick) {
                    ignoreNextClick = false;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                openTarget();
            });
        });
    }

    function highlightRows(allocations) {
        document.querySelectorAll('.tsh-highlight, .tsh-sell-highlight').forEach(el => {
            el.classList.remove('tsh-highlight', 'tsh-sell-highlight');
            el.style.outline = '';
            el.style.outlineOffset = '';
        });

        allocations.forEach(stock => {
            stock.row.classList.add('tsh-highlight');
            stock.row.style.outline = '2px solid #3c7be0';
            stock.row.style.outlineOffset = '-2px';
        });

        // Highlight stocks with at least one good sell lot
        const cache = loadLotCache();
        const cacheEntries = Object.values(cache);
        const rows = getVisibleStockRows();
        rows.forEach(row => {
            const code = row.getAttribute('data-code') || (row.innerText.match(/\(([A-Z]{2,4})\)/) || [])[1];
            if (!code) return;

            // Find lots for this stock from cache (sessionStorage)
            const stockCache = cacheEntries.find(entry => {
                if (!entry || !Array.isArray(entry.lots) || !entry.lots.length) return false;
                if (entry.code === code) return true;
                return entry.lots.some(lot => lot && lot.code === code);
            });
            const lots = stockCache ? stockCache.lots : [];
            if (lots.some(shouldSellLot)) {
                row.classList.add('tsh-sell-highlight');
                row.style.outline = '2px solid #4caf50';
                row.style.outlineOffset = '-2px';
            }
        });
    }

    function refresh() {
        console.log(`[TSH v${SCRIPT_VERSION}] Refresh analysis triggered`);
        const bankrollInput = document.getElementById('tsh-bankroll');
        const contentEl = document.getElementById('tsh-content');
        const parsedBankroll = parseBankrollInput(bankrollInput.value);
        const bankroll = parsedBankroll || getSavedBankroll();
        bankrollInput.value = formatNumber(bankroll);
        saveBankroll(bankroll);
        
        // Detect which time period the user is currently viewing
        const period = detectChartPeriod();

        const rows = getVisibleStockRows();
        console.log(`[TSH] Found ${rows.length} stock rows`);
        
        const stocks = rows.map(extractStockData).filter(stock => stock.code !== 'N/A');
        console.log(`[TSH] Extracted ${stocks.length} stocks with valid codes`);
        console.log('[TSH] All stocks:', stocks.map(s => `${s.code}: $${s.price.toFixed(2)} (${s.percent.toFixed(2)}%)`).join(' | '));
        
        const validStocks = stocks.filter(stock => Number.isFinite(stock.price) && stock.price > 0);
        console.log(`[TSH] Valid stocks with price > 0: ${validStocks.length}`);
        
        const negativeMovers = stocks.filter(s => s.percent < 0);
        console.log(`[TSH] Negative movers found: ${negativeMovers.length}`);
        if (negativeMovers.length > 0) {
            console.log('[TSH] Negative movers:', negativeMovers.map(s => `${s.code}: ${s.percent.toFixed(2)}%`).join(' | '));
        }
        
        const ranked = rankStocks(stocks, period);
        console.log(`[TSH] Ranked/scored stocks: ${ranked.length}`);
        
        const allocations = buildAllocations(ranked, bankroll);

        renderContent(contentEl, stocks, ranked, allocations, period, bankroll);
        highlightRows(allocations);
    }

    // ─── Per-lot inline breakdown ──────────────────────────────────────────────

    let lastClickedStockId = null;

    function trackStockClicks() {
        document.addEventListener('click', e => {
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;
            let el = target;
            for (let depth = 0; depth < 12 && el; depth++) {
                if (el.tagName === 'UL' && /^\d+$/.test(el.id)) {
                    lastClickedStockId = el.id;
                    return;
                }
                el = el.parentElement;
            }
        }, true);
    }

    /**
     * Parse individual purchase lots from Torn's ownedTab panel.
     * Returns: [{ date, shares, bought, current, profit }]
     *
     * Strategy 1: real <table> — detect header columns by keyword, then read tbody rows.
     * Strategy 2: div/li header row — find header by keyword presence, match sibling rows.
     * Strategy 3: raw text scan — date-anchored line blocks (DD/MM/YY pattern).
     */
    function parseLotRows(panelEl) {
        const lots = [];

        // ── Strategy 1: <table> ──────────────────────────────────────────────
        for (const table of Array.from(panelEl.querySelectorAll('table'))) {
            let headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
            if (!headerCells.length) {
                const firstTr = table.querySelector('tr');
                if (firstTr) headerCells = Array.from(firstTr.querySelectorAll('th, td'));
            }

            const headers = headerCells.map(th => (th.innerText || '').trim().toLowerCase());
            const idxDate    = headers.findIndex(h => /date|buy/.test(h));
            const idxShares  = headers.findIndex(h => /\bshares?\b/.test(h));
            const idxBought  = headers.findIndex(h => /\bbought\b/.test(h));
            const idxCurrent = headers.findIndex(h => /\bcurrent\b/.test(h));
            const idxProfit  = headers.findIndex(h => /\bprofit\b/.test(h));

            if (idxShares === -1 || idxBought === -1) continue;

            for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 4) continue;

                const cell = (idx, fallback = '') =>
                    idx >= 0 && idx < cells.length ? (cells[idx].innerText || '').trim() : fallback;

                const shares = parseInt(cell(idxShares, cell(1)).replace(/[,\s]/g, ''), 10);
                const bought = parseFloat(cell(idxBought, cell(3)).replace(/[$,\s]/g, ''));
                if (!Number.isFinite(shares) || shares <= 0) continue;
                if (!Number.isFinite(bought) || bought <= 0) continue;

                const current = parseFloat(cell(idxCurrent, cell(4)).replace(/[$,\s]/g, ''));
                const profitText = cell(idxProfit, cell(6));
                const profitNeg  = /[−\-]/.test(profitText);
                const profitM    = profitText.replace(/,/g, '').match(/[\d.]+/);
                const profit     = profitM ? (profitNeg ? -1 : 1) * parseFloat(profitM[0]) : 0;

                lots.push({ date: cell(idxDate, cell(0)), shares, bought, current: Number.isFinite(current) ? current : 0, profit });
            }

            if (lots.length) {
                console.log(`[TSH] Lots: ${lots.length} parsed (table)`);
                return lots;
            }
        }

        // ── Strategy 2: div/li column header row ────────────────────────────
        const headerEl = Array.from(panelEl.querySelectorAll('*')).find(el => {
            if (el.children.length < 4) return false;
            const t = (el.innerText || '').toLowerCase();
            return t.includes('shares') && t.includes('bought') && t.includes('profit');
        });

        if (headerEl) {
            const hCells = Array.from(headerEl.children);
            const colIdx = kw => hCells.findIndex(c => (c.innerText || '').toLowerCase().includes(kw));
            const iDate = colIdx('date') !== -1 ? colIdx('date') : colIdx('buy');
            const iShares = colIdx('shares'), iBought = colIdx('bought');
            const iCurrent = colIdx('current'), iProfit = colIdx('profit');

            for (const row of Array.from(headerEl.parentElement?.children ?? []).filter(c => c !== headerEl)) {
                const cells = Array.from(row.children);
                if (cells.length < 4) continue;
                const cell = (idx) => idx >= 0 && idx < cells.length ? (cells[idx].innerText || '').trim() : '';

                const shares = parseInt(cell(iShares !== -1 ? iShares : 1).replace(/[,\s]/g, ''), 10);
                const bought = parseFloat(cell(iBought !== -1 ? iBought : 3).replace(/[$,\s]/g, ''));
                if (!Number.isFinite(shares) || shares <= 0) continue;
                if (!Number.isFinite(bought) || bought <= 0) continue;

                const current = parseFloat(cell(iCurrent !== -1 ? iCurrent : 4).replace(/[$,\s]/g, ''));
                const profitText = cell(iProfit !== -1 ? iProfit : 6);
                const profitNeg  = /[−\-]/.test(profitText);
                const profitM    = profitText.replace(/,/g, '').match(/[\d.]+/);
                const profit     = profitM ? (profitNeg ? -1 : 1) * parseFloat(profitM[0]) : 0;

                lots.push({ date: cell(iDate !== -1 ? iDate : 0), shares, bought, current: Number.isFinite(current) ? current : 0, profit });
            }

            if (lots.length) {
                console.log(`[TSH] Lots: ${lots.length} parsed (div rows)`);
                return lots;
            }
        }

        // ── Strategy 3: raw text line scan (date-anchored blocks) ───────────
        // Expected shape per lot: DD/MM/YY · shares · $value · $bought · $current · … · ±$profit
        const lines = (panelEl.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
        const dateRx = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

        let i = 0;
        while (i < lines.length) {
            if (!dateRx.test(lines[i])) { i++; continue; }
            const date = lines[i];

            const shares = parseInt((lines[i + 1] || '').replace(/,/g, ''), 10);
            if (!Number.isFinite(shares) || shares <= 0) { i++; continue; }

            // lines[i+2] = total value (skip)
            const boughtM  = (lines[i + 3] || '').match(/\$?([\d,]+(?:\.\d+)?)/);
            const currentM = (lines[i + 4] || '').match(/\$?([\d,]+(?:\.\d+)?)/);
            const bought   = boughtM  ? parseFloat(boughtM[1].replace(/,/g, ''))  : 0;
            const current  = currentM ? parseFloat(currentM[1].replace(/,/g, '')) : 0;
            if (!Number.isFinite(bought) || bought <= 0) { i++; continue; }

            let profit = 0;
            for (let j = i + 5; j <= Math.min(i + 9, lines.length - 1); j++) {
                const pm = lines[j].replace(/,/g, '').match(/([+\-−])\s*\$?([\d.]+)/);
                if (pm) {
                    profit = (pm[1] === '-' || pm[1] === '−' ? -1 : 1) * parseFloat(pm[2]);
                    break;
                }
            }

            lots.push({ date, shares, bought, current: Number.isFinite(current) ? current : 0, profit });
            i += 8;
        }

        console.log(`[TSH] Lots: ${lots.length} parsed (text scan). Preview: ${lines.slice(0, 12).join('|')}`);
        return lots;
    }

    function shouldSellLot(lot) {
        const invested = lot.shares * lot.bought;
        if (!Number.isFinite(invested) || invested <= 0) return false;

        const computedProfit = Number.isFinite(lot.current) && lot.current > 0
            ? (lot.current - lot.bought) * lot.shares
            : 0;
        const profitAbs = Number.isFinite(lot.profit) && lot.profit !== 0
            ? lot.profit
            : computedProfit;
        const profitPct = (profitAbs / invested) * 100;

        // Sell only when both absolute and percentage gains are meaningful.
        return profitAbs >= SELL_MIN_PROFIT_USD && profitPct >= SELL_MIN_PROFIT_PCT;
    }

    function colorTransactionRows(panelEl, lots) {
        const txEls = Array.from(panelEl.querySelectorAll('[class*="transaction___"]'));
        txEls.forEach((el, i) => {
            el.classList.remove('tsh-tx-sell-now', 'tsh-tx-sell-wait', 'tsh-tx-break-even');
            const lot = lots[i];
            if (!lot) return;
            const invested = lot.shares * lot.bought;
            const computedProfit = Number.isFinite(lot.current) && lot.current > 0
                ? (lot.current - lot.bought) * lot.shares
                : 0;
            const profitAbs = Number.isFinite(lot.profit) && lot.profit !== 0
                ? lot.profit
                : computedProfit;
            const profitPct = invested > 0 ? (profitAbs / invested) * 100 : 0;
            // Break-even: within ±$5,000 or ±0.5%
            if (Math.abs(profitAbs) < 5000 || Math.abs(profitPct) < 0.5) {
                el.classList.add('tsh-tx-break-even');
            } else if (shouldSellLot(lot)) {
                el.classList.add('tsh-tx-sell-now');
            } else {
                el.classList.add('tsh-tx-sell-wait');
            }
        });
    }

    function processOwnedPanel(panelEl) {
        const stockId = lastClickedStockId;
        if (!stockId) return;

        const stockUl = document.getElementById(stockId);
        if (!stockUl) return;

        const lots = parseLotRows(panelEl);
        if (!lots.length) return;

        const stockText = stockUl.innerText || '';
        const stockCodeMatch = stockText.match(/\(([A-Z]{2,4})\)/);
        const stockCode = stockCodeMatch ? stockCodeMatch[1] : null;
        const normalizedLots = stockCode
            ? lots.map(lot => ({ ...lot, code: stockCode }))
            : lots;

        const cache = loadLotCache();
        cache[stockId] = {
            code: stockCode,
            lots: normalizedLots,
            totalProfit: normalizedLots.reduce((sum, lot) => {
                const computedProfit = Number.isFinite(lot.current) && lot.current > 0
                    ? (lot.current - lot.bought) * lot.shares
                    : 0;
                const profit = Number.isFinite(lot.profit) && lot.profit !== 0 ? lot.profit : computedProfit;
                return sum + profit;
            }, 0)
        };
        saveLotCache(cache);

        colorTransactionRows(panelEl, normalizedLots);
        console.log(`[TSH] Colored stock #${stockId} from ${normalizedLots.length} lots`);
    }

    function observeLotPanels() {
        ensureLotStyles();
        trackStockClicks();

        let debounceTimer = null;

        const handlePanel = (panel) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (panel.isConnected) processOwnedPanel(panel);
            }, 150);
        };

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.id === 'panel-ownedTab') { handlePanel(node); continue; }
                    const inner = node.querySelector?.('#panel-ownedTab');
                    if (inner) handlePanel(inner);
                }

                if (mutation.target instanceof Element) {
                    const panel = mutation.target.id === 'panel-ownedTab'
                        ? mutation.target
                        : mutation.target.closest?.('#panel-ownedTab');
                    if (panel) handlePanel(panel);
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const existing = document.getElementById('panel-ownedTab');
        if (existing && existing.children.length > 0) handlePanel(existing);
    }

    function init() {
        if (document.getElementById('torn-stocks-helper-panel')) return;

        console.log(`[TSH v${SCRIPT_VERSION}] Script initialized`);

        const panel = createPanel();
        wirePanelControls(panel);

        document.getElementById('tsh-refresh').addEventListener('click', refresh);
        observeLotPanels();

        // Wait a moment in case Torn renders lazily
        setTimeout(refresh, 1200);
        setTimeout(refresh, 2500);
    }

    // Start after page settles
    window.addEventListener('load', () => {
        setTimeout(init, 1000);
    });
})();