# Pulze Mazz Editor

*[Italiano](README.md) · English*

An editor for the **Hotone Pulze Mini**, from your PC, over Bluetooth, inside the browser. Nothing to install, no
account.

**→ [mazzrelaz.github.io/PulzeMazzEditor](https://mazzrelaz.github.io/PulzeMazzEditor/)**
(the guide is inside the editor: ☰ menu → Guide)

> **Independent project**, not affiliated with Hotone Audio in any way. Tested on a single Pulze Mini, firmware 1.1.2:
> the protocol was reconstructed by observing the device, it does not come from official documentation. Use it at
> your own risk: before big jobs, make a full backup (it's in the editor).

## What it does

- **Edits the current tone**: the chain of seven blocks with pictures of the models, knobs, on/off, model changes,
  draggable blocks. Undo / Redo and an **A/B** comparison with the saved tone.
- **Saves** to any slot; copies, swaps, renames and deletes tones.
- **Songlists** on a screen of boxes you rearrange with the mouse.
- **.prst files**: import and export, compatible with the Pulze Editor phone app.
- **Create AI preset**: describe the sound in words and OpenAI or Claude builds it with the Mini's real models (with
  your own API key, which goes only to the provider you choose and stays in your browser).
- **Jam** (the Mini's drum machine), general **Settings** and **Global EQ** with a draggable curve.
- **Full backup** to your PC or to your **Dropbox**, restoring tones after comparing them with the Mini, and automatic
  safety copies before any job that overwrites something.
- In **English** and **Italian**.

## What you need

- A PC with **Bluetooth** and **Chrome** or **Edge** (other browsers don't support Bluetooth for web pages).
- The Pulze Mini, with the phone app **closed**: the Mini accepts one connection at a time.

Without a Mini you can see what it looks like: [`#esempio`](https://mazzrelaz.github.io/PulzeMazzEditor/#esempio)
shows a recorded tone, [`#finto`](https://mazzrelaz.github.io/PulzeMazzEditor/#finto) a fake Mini that answers.

## Privacy

The editor collects nothing and has no server of its own. The only things that leave your PC are: the commands to the
Mini, over Bluetooth; the Dropbox backups, if you connect it (to your own Dropbox app); with Create AI preset, the
description you write, to the provider you choose. Keys and connections stay in the browser.

## Running it on your PC without internet

Download the repository and open `avvia-editor.cmd` (requires [Node.js](https://nodejs.org/)): it starts a small server
on `http://localhost:8100` and opens the page in Edge. Tests: `node test/protocollo.test.js` (and the others in `test/`).

## Credits

Written by **Massimo Togni**. Selector labels, units and the catalog for the AI from
[Reniori/pulze-tone-generator](https://github.com/Reniori/pulze-tone-generator) (MIT). Model names, positions and knob
ranges from the catalog of the official Pulze Editor 2.1.3 app. The model images are drawings generated for this
program, not photos of the products; the names of the products they are inspired by belong to their owners.
“Hotone”, “Pulze” and “Pulze Mini” are trademarks of their respective owners.

[MIT](LICENSE) license. If you find it useful: [buy me a coffee](https://buymeacoffee.com/mazzgear).
