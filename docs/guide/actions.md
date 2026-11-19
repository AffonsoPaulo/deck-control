# Actions

Everything a key (or an [automation](automations.md)) can do, in the same groups as the library on the
[Keys](keys.md) screen. Plugins add their own groups; see [Integrations](integrations.md) for the OBS and Discord
actions.

## Keyboard and text

| Action | What it does |
|---|---|
| **Keyboard shortcut** | Presses a key combination, as if you had typed it (`ctrl+shift+m`). Put one per line to press several in a row. |
| **Shortcut for another program** | Gives the key a shortcut of its own, for a program to react to. See [below](#shortcuts-for-other-programs). |
| **Type text** | Types the text wherever the cursor is. **Press Enter at the end** sends it, in a chat for example. |

Key names for combinations: `ctrl`, `shift`, `alt`, `win`, letters, digits, `f1` to `f24`, `enter`, `esc`, `space`,
`tab`, `backspace`, `delete`, `home`, `end`, `pageup`, `pagedown`, `left`, `up`, `right`, `down`, `printscreen`,
and the media keys `play_pause`, `next`, `prev`, `vol_up`, `vol_down`, `mute`. Join them with `+`. The capture button
next to the field records a combination for you.

## Programs and system

| Action | What it does |
|---|---|
| **Media and volume** | Play/pause, next, previous, stop, and the Windows volume (raise, lower, mute). **How many times** makes one press count as 2 or 3 volume steps. |
| **Open program, file or website** | Opens it the same way as a double-click: `notepad.exe`, `C:\Games\game.exe`, `https://twitch.tv`, `%USERPROFILE%\Downloads`. |
| **Run command** | Runs a command in Command Prompt or PowerShell, with or without showing the window. |
| **Call URL (webhook)** | Makes an HTTP request: webhooks, bots, Home Assistant and the like. |

## Temporary responses

These take over the Deck for a few seconds, then put everything back. They're made for
[automations](automations.md), but work on keys too.

| Action | What it does |
|---|---|
| **Color on the light** | Lights the whole ring in one color for a few seconds (optionally blinking), then goes back to the effect. Needs the app to [control the light](light.md#first-hand-the-light-over-to-the-app). |
| **Paint the keys** | Paints all the key screens in one color, with an icon and text if you want, for a few seconds. Pressing a key ends it early. |
| **Show a temporary page** | Shows a page for a few seconds and goes back on its own. An empty key shows the time left and closes it. |
| **Start or pause a countdown** | Starts, pauses or resumes a named countdown. A key can show it with the value `timer.<name>`, or use the Countdown [widget](keys.md#widgets). |
| **Reset a countdown** | Puts the countdown back to the start, stopped. |

## Pages and logic

| Action | What it does |
|---|---|
| **Wait** | Pauses before the next step (1000 ms = 1 second). |
| **On/off** | Each press switches between on and off, each with its own steps, and the key's look follows. |
| **If… then… else** | Does one thing or another depending on a situation, like "if OBS is recording". |
| **Change an icon state** | Turns a key's "active" state on or off without doing anything else. Useful to fix an icon that got out of sync. |
| **Change page** | Goes to a page, to the previous page, or to the home page. |
| **Deck brightness** | Sets the screen brightness, or raises it a bit on each press (and wraps around after the maximum). |
| **None** | Does nothing. Good for titles and separators. |

When an action fails (a program that doesn't exist, OBS closed…), the key shows a red ✕ for a second and the reason
goes to the [log](logs.md).

## Shortcuts for other programs

Discord, OBS, games and many other programs can react to a global shortcut that you "record" in their settings. A
**Shortcut for another program** step (and the Discord actions) gives the key a combination of its own, made with the
keys F13 to F24, which no keyboard has, so it never clashes with your typing.

To link it:

1. Make sure the change is saved (the top bar says **Saved**).
2. In the other program, click the field to record a shortcut.
3. Press the Deck key. Or use one of the helpers on the step:
   - **Send in 5 s**: press it, then click the other program's field before the time runs out.
   - **Send with the Deck**: for 30 seconds, the next Deck key you press only sends this shortcut, without running
     anything.

**Made for** tells the app which program the shortcut is for, when a program doesn't accept every combination. **Hold
together with the Deck key** (on by default) keeps the shortcut pressed while you hold the Deck key, which is what
makes push to talk work.

If two different things end up with the same combination, the editor warns you (saving still works); press **↻**
on the step to make a new one. A pasted key gets a new combination, so you'll need to record it again in the other
program.
