// ==UserScript==
// @name         Arson 2.0 items description
// @namespace    http://tampermonkey.net/
// @version      3.5.2
// @author       KamiRen [2805199]
// @description  Item descriptor popup
// @match        https://www.torn.com/page.php?sid=crimes#/arson
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';
    
    // Images reference: [Crimes 2.0] Arson: An In-Depth Guide https://www.torn.com/forums.php#/p=threads&f=61&t=16510947&b=0&a=0
    const IMAGE_URL        = "https://lh3.googleusercontent.com/d/1saWcP7A_YEYRSHYcDKTYQuEqUUdXU1jm=w2000";
    const IMAGE_BASE_WIDTH = 1200;

    const ITEM_MAP = {
        "Gasoline":  { x: 0, y: 0,    w: 1200, h: 238 },
        "Diesel":    { x: 0, y: 242,  w: 1200, h: 235 },
        "Kerosene":  { x: 0, y: 484,  w: 1200, h: 235 },
        "Potassium": { x: 0, y: 724,  w: 1200, h: 235 },
        "Magnesium": { x: 0, y: 963,  w: 1200, h: 235 },
        "Thermite":  { x: 0, y: 1203, w: 1200, h: 235 },
        "Oxygen":    { x: 0, y: 1443, w: 1200, h: 235 },
        "Methane":   { x: 0, y: 1683, w: 1200, h: 235 },
        "Hydrogen":  { x: 0, y: 1923, w: 1200, h: 235 },
    };

    const IS_MOBILE = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    function extractItemName(ariaLabel) {
        if (!ariaLabel) return null;
        const lower = ariaLabel.toLowerCase();
        return Object.keys(ITEM_MAP).find(name => lower.includes(name.toLowerCase())) || null;
    }

    // =====================================================
    // DESKTOP — hover popup
    // =====================================================

    if (!IS_MOBILE) {
        const DESKTOP_SCALE = 0.7;

        let popup     = null;
        let activeBtn = null;

        function showPopup(itemName, button) {
            const map     = ITEM_MAP[itemName];
            const rect    = button.getBoundingClientRect();
            const scaledW = map.w * DESKTOP_SCALE;
            const scaledH = map.h * DESKTOP_SCALE;

            let left = rect.right + 10;
            let top  = rect.top;

            if (left + scaledW > window.innerWidth)  left = rect.left - scaledW - 10;
            if (top  + scaledH > window.innerHeight) top  = window.innerHeight - scaledH - 10;

            if (popup) popup.remove();

            popup = document.createElement("div");
            Object.assign(popup.style, {
                position:           "fixed",
                zIndex:             "99999",
                left:               `${left}px`,
                top:                `${top}px`,
                width:              `${scaledW}px`,
                height:             `${scaledH}px`,
                backgroundImage:    `url(${IMAGE_URL})`,
                backgroundRepeat:   "no-repeat",
                backgroundPosition: `-${map.x * DESKTOP_SCALE}px -${map.y * DESKTOP_SCALE}px`,
                backgroundSize:     `${IMAGE_BASE_WIDTH * DESKTOP_SCALE}px auto`,
                border:             "1px solid #444",
                boxShadow:          "0 0 12px rgba(0,0,0,0.6)",
                pointerEvents:      "none",
            });

            document.body.appendChild(popup);
            activeBtn = button;
        }

        function hidePopup() {
            if (popup) { popup.remove(); popup = null; }
            activeBtn = null;
        }

        // mousemove fires continuously — no SPA readiness wait needed
        document.addEventListener("mousemove", (e) => {
            const button   = e.target.closest("button");
            const itemName = button ? extractItemName(button.getAttribute("aria-label") || "") : null;

            if (itemName) {
                if (button !== activeBtn) showPopup(itemName, button);
            } else {
                if (activeBtn) hidePopup();
            }
        });

        document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopup(); });
    }

    // =====================================================
    // MOBILE — tap popup with pinch-zoom and pan
    // =====================================================

    if (IS_MOBILE) {
        let popup     = null;
        let image     = null;
        let scale     = 1;
        let offsetX   = 0;
        let offsetY   = 10;
        let isPinch   = false;
        let initDist  = null;
        let initScale = null;
        let lastTouch = null;

        function applyTransform() {
            image.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        }

        // Renders the cropped image for itemName and resets position/zoom
        function renderContent(itemName) {
            const map      = ITEM_MAP[itemName];
            const imgScale = (window.innerWidth - 12) / IMAGE_BASE_WIDTH;

            Object.assign(image.style, {
                width:              `${map.w * imgScale}px`,
                height:             `${map.h * imgScale}px`,
                backgroundImage:    `url(${IMAGE_URL})`,
                backgroundRepeat:   "no-repeat",
                backgroundPosition: `-${map.x * imgScale}px -${map.y * imgScale}px`,
                backgroundSize:     `${IMAGE_BASE_WIDTH * imgScale}px auto`,
            });

            scale   = 1;
            offsetX = 0;
            offsetY = 10;
            applyTransform();
        }

        function showPopup(itemName) {
            if (popup) {
                // New item tapped: swap content and reset position/zoom
                renderContent(itemName);
                return;
            }

            popup = document.createElement("div");
            Object.assign(popup.style, {
                position:    "fixed",
                top:         "10px",
                left:        "50%",
                transform:   "translateX(-50%)",
                zIndex:      "99999",
                touchAction: "none",
            });

            image = document.createElement("div");
            image.style.transformOrigin = "0 0";
            popup.appendChild(image);
            document.body.appendChild(popup);

            renderContent(itemName);

            popup.addEventListener("touchstart", (e) => {
                if (e.touches.length === 2) {
                    isPinch  = true;
                    initDist = null;
                } else {
                    isPinch   = false;
                    lastTouch = e.touches[0];
                }
            }, { passive: true });

            popup.addEventListener("touchmove", (e) => {
                e.preventDefault();

                if (e.touches.length === 2) {
                    const dx   = e.touches[0].clientX - e.touches[1].clientX;
                    const dy   = e.touches[0].clientY - e.touches[1].clientY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (!initDist) {
                        initDist  = dist;
                        initScale = scale;
                    } else {
                        scale = Math.min(Math.max(initScale * (dist / initDist), 1), 4);
                    }

                    applyTransform();
                    return;
                }

                if (!lastTouch) return;

                const touch = e.touches[0];
                offsetX    += touch.clientX - lastTouch.clientX;
                offsetY    += touch.clientY - lastTouch.clientY;
                lastTouch   = touch;
                applyTransform();
            }, { passive: false });

            popup.addEventListener("touchend", () => {
                if (isPinch) initDist = null;
            });
        }

        function hidePopup() {
            if (popup) { popup.remove(); popup = null; image = null; }
            scale     = 1; offsetX = 0; offsetY = 10;
            isPinch   = false; initDist = null; lastTouch = null;
        }

        // Single listener handles both show (button tap) and dismiss (tap elsewhere)
        document.addEventListener("click", (e) => {
            const button   = e.target.closest("button");
            const itemName = button ? extractItemName(button.getAttribute("aria-label") || "") : null;

            if (itemName) {
                showPopup(itemName);
            } else if (popup && !popup.contains(e.target)) {
                hidePopup();
            }
        });

        document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopup(); });
    }

})();
