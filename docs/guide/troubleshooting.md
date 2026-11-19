# Troubleshooting

## The Deck isn't detected

- Close Fifine's own app, **fifine Control Deck**, including its icon in the tray. Only one program can talk to the
  D6 at a time.
- Check the USB cable, and try another USB port.
- The app keeps trying every couple of seconds and reconnects by itself (also after the PC wakes up), so there's no
  need to restart it. While the Deck is missing, the tray icon shows a badge and the top bar of the editor says
  **Deck disconnected**.

## The editor says "Deck app closed"

The editor works without the app, but the Deck doesn't. Open the Deck from the Start menu (it goes to the tray), or
quit and open it again from the tray if it's stuck.

If the editor says the tab is out of date ("The app restarted…"), reload the page. Anything that wasn't saved is
offered back.

## The ring doesn't follow the app

- Click the button on the back of the Deck **twice, quickly**. A single click gives the light back to the device's own
  effects.
- Check that **Control the Deck light** is on in [Light](light.md#general).
- With **Turn off with the PC screen** on, the ring stays dark while Windows is locked or the monitor sleeps.

## A key shows an ✕

The action failed: for example, a program that doesn't exist anymore, or OBS that isn't connected. The reason is in
the [log](logs.md). You can turn the ✕ off in [Settings › Advanced](settings.md#advanced) (**Show error on the
key**).

## The top bar says "Not saved"

Something in your setup needs fixing before it can be saved, like a step with an empty field or a key that goes to a
page that doesn't exist. Click **Not saved** to see the list under the Deck. Until you fix it, the Deck keeps the last
saved version.

## OBS doesn't connect

- Check that the WebSocket server is on in OBS: **Tools › WebSocket Server Settings › Enable WebSocket server**.
- Copy the password again from **Show Connect Info** into the Deck (Settings › Integrations › OBS Studio).
- If OBS runs on another PC, use that PC's IP address, and make sure the Windows firewall there allows port 4455.

While OBS is closed on this PC, the app just waits for it; that isn't a problem. See
[Integrations › OBS Studio](integrations.md#obs-studio).

## A Discord key shows the wrong state

In **Keyboard shortcuts** mode the Deck can't see Discord, so the key only guesses. If you mute from Discord itself,
the key gets out of sync: press it twice, or give it an **On hold** step with **Change an icon state** to fix it. For
the real state, use the [Client ID mode](integrations.md#client-id-direct).

## A shortcut doesn't work in another program

- The change must be saved before the shortcut exists: wait for **Saved** in the top bar.
- Record it again in the other program (a copied key gets a new shortcut).
- Some programs don't accept every combination: set **Made for** on the step, and press **↻** for a new one. See
  [Shortcuts for other programs](actions.md#shortcuts-for-other-programs).

## Keys stop updating, or show the wrong image

Unplug the Deck and plug it back in: the app reconnects by itself and redraws every key. If it keeps happening, turn on
**Detailed** logs for the **Device** area in [Settings › Advanced](settings.md#advanced), wait for it to happen
again, and [ask for help](#asking-for-help) with a diagnostics package.

## Colors on the Deck look bluer than in the editor

That's the D6 screens. Keep **Correct the screen colors** on in [Settings › Advanced](settings.md#advanced).

## Images

- The editor accepts images up to 5 MB. Every image is shrunk to the key screen (112×112), so very detailed pictures
  lose detail.
- Animated GIFs play on the Deck. Very long GIFs (more than 120 frames) are simplified, keeping the same total time.

## Start with Windows can't be turned on

In the installed app, run the installer again and check **Start the Deck with Windows**. Windows Defender blocks an
app that isn't digitally signed from turning this on by itself. See [Settings › General](settings.md#general).

## The app doesn't start after editing config.yaml by hand

The app checks the file when it starts and shows a message with what's wrong ("Error in config.yaml"). Fix it, or put
back an earlier version: the previous save is next to it as `config.yaml.bak`, and the editor's
[version history](settings.md#version-history) has more.

## Asking for help

In [Settings › Advanced](settings.md#advanced), press **Create diagnostics package**. It makes a .zip with the logs,
your settings without passwords, and the app and Windows versions. Send it with a short description of what happened.

## Where things are

| What | Where (installed app) |
|---|---|
| Your settings (`config.yaml`), its backup and the key images | `%APPDATA%\Deck` |
| Version history | `%APPDATA%\Deck\history` |
| Logs | `%LOCALAPPDATA%\D6Deck\logs` |
| Installed plugins | `%LOCALAPPDATA%\D6Deck\plugins` |

Uninstalling asks whether to delete these too. Choose **No** to keep them for a later install.
