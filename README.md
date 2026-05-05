# 🚀 Better Quick Settings (beQS)

**Better Quick Settings** is a GNOME Shell extension designed to turn the Quick Settings menu into a powerful, beautiful, and highly functional control center, while staying **native** to GNOME 48, 49, 50 and newer.

---

<p align="center">
  <img width="388" height="365" alt="Better Quick Settings main panel" src="https://github.com/user-attachments/assets/f69f00f8-0b8f-440e-bc47-9f122c7bfd4d" />
</p>

<p align="center">
  <img width="614" height="645" alt="Better Quick Settings overlay layout" src="https://github.com/user-attachments/assets/b7701edd-95a9-49c1-a99f-d5cf88f1126a" />
</p>

<p align="center">
  <img width="614" height="324" alt="Better Quick Settings notifications and widgets" src="https://github.com/user-attachments/assets/eca1dbbe-9890-46b2-8734-e4c982699ef7" />
</p>

---

## 🙏 Credits

This project is based on the original [Quick Settings Tweaks](https://github.com/qwreey/quick-settings-tweaks) extension by **qwreey**, which introduced advanced customization for the GNOME Quick Settings panel (media controls, volume mixer, notifications, layout tweaks, overlay, etc.).  
Huge **thanks** to qwreey for the original work and the inspiration to push this idea further.[web:5][web:15]

---

## 💎 Premium Features

### 🔊 Advanced Audio Control

* **Per-App Volume Mixer**: Control the volume of each application directly from the panel.
* **Smart Device Management**: Detect, rename, and hide audio devices (outputs and inputs) to keep the menu clean.
* **Precise Filtering**: Only show the applications and devices you actually care about.

---

## 🎵 Media & Entertainment

* **Enhanced Media Widget**: Beautiful cover art fetched from **iTunes**, smooth-scrolling titles, and dynamic layouts.
* **Experimental Cover Support (non‑MPRIS)**: Experimental support for cover art even for players without MPRIS, downloading artwork from iTunes using available metadata.[web:20]
* **CAVA Integration**: Real‑time audio visualizer integrated into the Quick Settings menu.
* **Metadata Mastery**: Smart track info parsing to display cleaner, more consistent titles.

---

## 📊 System Intelligence

* **Side-Pane Notifications**: Dedicated, swipeable side panel for notifications on the left side of the menu.
* **Weather & Environment**: Integrated weather information and a real‑time **Hygrometer** to monitor humidity.
* **System Toggles**: Choose exactly which system buttons (VPN, WWAN, Night Light, etc.) are visible.

---

## 🎨 Aesthetics & UX

* **Menu Opening Animations**: Smooth opening animations for the menu to make interactions feel more fluid and polished.[web:45]
* **Modern Design**: Clean, minimal design that fits the latest GNOME aesthetics.[web:41]

---

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/unaibenidorm/beQS.git \
  ~/.local/share/gnome-shell/extensions/beQS@unaibenidorm
```

### 2. Compile Schemas

```bash
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/beQS@unaibenidorm/schemas/
```

### 3. Apply Changes

* **X11**: Press `Alt` + `F2`, type `r`, and press `Enter`.
* **Wayland**: Log out and log back in.

### 4. Enable

Enable **Better Quick Settings** via the GNOME Extensions app or Extension Manager.[web:12]

---

## 🔗 Links

* **GitHub**: [Better Quick Settings](https://github.com/unaibenidorm/beQS)
* **Issues**: Found a bug? [Open an issue here](https://github.com/unaibenidorm/beQS/issues)

---

Made with ❤️ for the GNOME Community by **unaibenidorm**.