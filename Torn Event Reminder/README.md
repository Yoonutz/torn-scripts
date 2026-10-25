# Torn Event reminder

Colors Torn's header clock as calendar events get close, so you never miss the start of
Trick or Treat, Christmas Town, Easter Egg Hunt and the rest.

| Clock | When |
| --- | --- |
| Red | 24 h or less before an event you watch starts |
| Orange | 3 h or less before the start ("soon") |
| Green | the event is live |
| Normal | nothing due |

Hover the clock to see which event and how long is left. All three windows are editable.

## Your own start time

Most Torn events start at the time you picked, not at 00:00 TCT. The script reads yours:

- **API key**: `torn/calendar` for the events and `user/calendar` for your start time, refreshed
  every 6 h. Torn PDA's key is used automatically.
- **No key**: open [the calendar](https://www.torn.com/calendar.php) once. The times shown there
  (`11:00:00 - 25/10/26 until 11:00:00 - 01/11/26`) are read straight from the page and win
  over the API.

### Set API key

⚙ → **Set API key**. If another script already saved a Torn key in this browser, it is offered
for reuse. Otherwise the button links to Torn's key page, pre-filled with a custom key that can
only read the calendar. Paste it back, it is checked against the API, then saved AES-encrypted
(the encryption key is a non-extractable browser key in IndexedDB, never plain text in
localStorage).

## Settings

Open Torn's clock. A new row under the time lists **This month's events** (or **All**), one line
each with short dates. Ended events are struck through. Events that started last month and are
still running stay in the list, marked *from Oct* etc. Hover a line for full times.

- Check or uncheck each event to be reminded or not. Event times are Torn's own.
- ⚙ API key, your start time (auto), the red / orange / green windows (0 = green for the whole
  event) and the dot on the clock.

Settings are stored in this browser only.
