# Getting started

## Install

1. Download `Deck-Setup.exe` from the [Releases page](https://github.com/AffonsoPaulo/deck-control/releases).
2. Run it. The app isn't digitally signed yet, so Windows SmartScreen may warn you: choose **More info › Run anyway**.
3. In the installer, check **Start the Deck with Windows** if you want the app to open by itself when you turn on the
   PC. (This is the only way to turn it on in the installed app; see
   [Settings › General](settings.md#general).)
4. At the end, leave **Open the Deck now** checked.

You need a 64-bit Windows. To run it from the source code instead, see the
[README](../../README.md).

> [!IMPORTANT]
> Close Fifine's own app ("fifine Control Deck"), including its icon in the tray. Only one program can talk to the
> D6 at a time.

## The app lives in the tray

The Deck app has no window: it runs as an icon in the Windows tray (next to the clock). The icon is lit while the D6
is connected, and gets an amber badge when something needs attention. Hover over it to see the current page or the
problem.

Right-click the icon for the menu:

| Item | What it does |
|---|---|
| **Open editor** | Opens the editor in your browser. Double-clicking the icon does the same. |
| **Open config.yaml** | Opens your settings file (for advanced users; the editor is easier). |
| **Open the app folder** | Opens the folder with your settings and images. |
| **View the log** | Opens the [log](logs.md). |
| **Start with Windows** | Shows whether the app opens with Windows. |
| **Quit** | Closes the app. The Deck stops working until you open it again. |

Only one copy of the app runs at a time. If you open it again from the Start menu while it's running, it tells you
it's already in the tray: use **Open editor** there.

## The editor

The editor opens in your browser, at an address like `http://deck.localhost:8765/ABCD-EFGH-JKMN/teclas`. It only works on
this PC: the code at the end is a key that the app gives to your browser, so other devices on the network can't open
it. Bookmark it if you like; it stays the same.

The editor has four screens in the menu on the left:

- [**Keys**](keys.md): your pages and keys, what they look like and what they do.
- [**Light**](light.md): the ring of LEDs around the Deck.
- [**Automations**](automations.md): things the Deck does by itself.
- [**Settings**](settings.md): language, brightness, integrations, backup and more.

There's no Save button: every change is saved by itself and the Deck updates right away. You can undo anything with
**Ctrl+Z**, and go back to any earlier version in the [version history](settings.md#version-history).

> [!NOTE]
> The first time, the app starts with a sample setup so you have something to play with: three pages (**main**,
> **obs** and **more**) with keys for Discord, OBS, media and a few examples. It comes in the Windows language
> (English or Portuguese), and so do the editor and the tray; change the language in
> [Settings › General](settings.md#general). Rename or replace the sample keys as you go.

## Tutorial: your first keys

### 1. A key that opens a website

1. On the **Keys** screen, pick an empty key on the Deck (it shows a **+**).
2. In the library on the left, open **Programs and system** and drag **Open program, file or website** onto the
   key.
3. On the right, in **What it does**, type an address in the step: `https://twitch.tv`.
4. Press the Deck key. Your browser opens the page.

The key already has a name, an icon and a color. To change them, open the **Appearance** tab: type a new name, press
**Choose another icon** and search for "tv", pick a background color.

### 2. A mute key with an "active" look

1. Open **Pages and logic** and drag **On/off** onto another key.
2. In **What it does**, the step has a "when on" list and a "when off" list. Press the **+** next to "when on",
   pick **Media and volume** and choose **Mute/unmute the PC**. Leave "when off" empty: it repeats the same step.
3. In **Appearance**, switch **Editing the appearance** to **When active**, choose a red background and type `Muted`
   as the text.
4. Press the key: the PC goes silent and the key turns red. Press again to turn the sound back on.

Use the **Normal | Active** switch above the Deck to preview both looks.

### 3. A second page

1. Press **+ Page** above the Deck and name it `music`.
2. Add a few keys to it: **Media and volume** with **Play/pause**, **Next track**, **Previous track**.
3. Add a key with **Change page** set to **previous (go back)**, so you can return.
4. Go back to your first page (click its tab) and add a key with **Change page** set to `music`.

Now one key takes you to the music page, and another brings you back.

### 4. A clock

1. In the library, switch to the **Widgets** tab.
2. Click **Clock** to see its sizes, and drag the **1×2** size onto the Deck. It takes two keys: hours and minutes.
3. Select it to change its **Options** (24 h or 12 h, the date on a third key…).

### 5. More than one thing on a key

Select a key and look at **What it does**. Each moment (**On press**, **On double tap**, **On hold**, **On release**)
can have several steps that run in order. Try a "be right back" key: **Type text** "Be right back!" with **Press
Enter at the end**, then **Change page** to a "break" page.

## Next steps

- Connect [OBS and Discord](integrations.md).
- Make the ring react to your keys in [Light](light.md).
- Let the Deck do things by itself with [automations](automations.md).
- Something not working? See [Troubleshooting](troubleshooting.md).
