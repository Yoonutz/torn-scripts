# Torn Colored Chats: short design (2026-11-22)

## Why
Ionut wants to see at a glance which chat window is which. Private (1:1) chats stay as they are. All other chats get a color.

## Decisions (Ionut, 2026-11-22)
- Look: colored header bar + light tint of the same color on the message area (card).
- Standalone public script for Greasy Fork. No key, 0 API calls (card).
- A small palette icon button in each group chat header, left of the minimize line. One color (Torn grey), to blend in (messages).
- Click the icon: a row of 8 colors + reset opens. Each user selects the color for each chat.

## My calls (Ionut can change)
- Default colors per type: faction green, company blue, global grey-blue, trade amber, other groups purple. Reset goes back to the default.
- Colors saved per chat with GM_setValue.
- The color row wraps to a second row if the window is narrow. No horizontal scrollbar (P24).
- MutationObserver (throttled) finds new chat windows. Pause when document.hidden (P11).

## Approaches
1. Hand-written single file, like Torn Chat Image Upload (picked: public scripts have no kit code, rule from 2026-11-16).
2. occ-kit standalone build (dropped: adds kit code to a public script).
3. CSS only with fixed class names (dropped: Torn class names are hashed and change).

## Facts
| Fact | Source |
|---|---|
| Chat bar buttons: id `chat_panel_button:<playerId>` for private, `chat_panel_button:faction` / `:company` for groups | Ionut's saved Torn pages (item.php, companies.php) [VERIFIED] |
| Open private chat window root id = other player id | Ionut's chat HTML 2026-11-16 [VERIFIED then] |
| Open group chat window: id, header, minimize button | [UNVERIFIED] HTML not seen |
