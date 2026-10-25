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

- **API key** (Public is enough): `torn/calendar` for the events and `user/calendar` for your
  start time, refreshed every 6 h. Torn PDA's key is used automatically.
- **No key**: open [the calendar](https://www.torn.com/calendar.php) once. The times shown there
  (`11:00:00 - 25/10/26 until 11:00:00 - 01/11/26`) are read straight from the page.

## Settings

Open Torn's clock. A new row under the time lists **This month's events** (or **All**). Events
that started last month and are still running stay in the list, marked *from Oct* etc.

- Check or uncheck each event to be reminded or not. Event times are Torn's own and are not edited.
- ⚙ API key, your start time (auto), the red / orange / green windows (0 = green for the whole
  event), the dot, and a clock selector in case Torn moves the clock.
- If the clock is not found, a small floating dot shows the color and opens the same list.

Everything is stored in this browser only.
