import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Logger from "./libs/shared/logger.js";

let Main = null;
try {
    // @ts-ignore
    Main = await import("resource:///org/gnome/shell/ui/main.js");
} catch (e) {
    // Preferences process, Main is not available
}
export default class Global {
    static get QuickSettingsSystemIndicator() {
        return new Promise(resolve => {
            let system = this.QuickSettings._system;
            if (system) {
                resolve(system);
                return;
            }
            this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                system = this.QuickSettings._system;
                if (!system)
                    return GLib.SOURCE_CONTINUE;
                resolve(system);
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    static get QuickSettingsSystemItem() {
        return this.QuickSettingsSystemIndicator
            .then(system => system._systemItem)
            .catch(Logger.error);
    }
    static get MessageList() {
        return this.DateMenu._messageList;
    }
    static get DateMenuIndicator() {
        return this.DateMenu._indicator;
    }
    static GetShutdownMenuBox() {
        // To prevent freeze, priority should be PRIORITY_DEFAULT_IDLE instead of PRIORITY_DEFAULT
        return new Promise(resolve => {
            this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this.QuickSettings._system)
                    return GLib.SOURCE_CONTINUE;
                resolve(this.QuickSettings._system._systemItem.menu.box);
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    static StreamSliderGetter() {
        if (!this.QuickSettings._volumeInput)
            return null;
        return {
            VolumeInput: this.QuickSettings._volumeInput,
            InputStreamSlider: this.QuickSettings._volumeInput._input,
            OutputStreamSlider: this.QuickSettings._volumeOutput._output,
        };
    }
    static GetStreamSlider() {
        return new Promise(resolve => {
            let streamSlider = this.StreamSliderGetter();
            if (streamSlider) {
                resolve(streamSlider);
                return;
            }
            this._addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                streamSlider = this.StreamSliderGetter();
                if (!streamSlider)
                    return GLib.SOURCE_CONTINUE;
                resolve(streamSlider);
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    static _addIdle(priority, func) {
        const id = GLib.idle_add(priority, () => {
            const res = func();
            if (res === GLib.SOURCE_REMOVE || res === undefined) {
                this._idleIds = this._idleIds.filter(i => i !== id);
                return GLib.SOURCE_REMOVE;
            }
            return res;
        });
        this._idleIds ??= [];
        this._idleIds.push(id);
        return id;
    }
    static GetDbusInterface(path, interfaceName) {
        let cachedInfo = this.DBusFiles.get(path);
        if (!cachedInfo) {
            // This should ideally not happen if we pre-load everything
            // But if it does, we at least log it or handle it.
            // For Shexli compliance, we MUST not use sync IO here.
            throw new Error(`DBus interface ${path} not pre-loaded`);
        }
        return cachedInfo.lookup_interface(interfaceName);
    }

    static unload() {
        if (this._idleIds) {
            for (const id of this._idleIds)
                GLib.source_remove(id);
            this._idleIds = [];
        }
        this.QuickSettings = null;
        this.QuickSettingsMenu = null;
        this.QuickSettingsGrid = null;
        this.QuickSettingsBox = null;
        this.QuickSettingsActor = null;
        this.Indicators = null;
        this.DateMenu = null;
        this.DateMenuMenu = null;
        this.DateMenuBox = null;
        this.DateMenuHolder = null;
        this.MessageTray = null;
        this.Extension = null;
        this.Settings = null;
        this.DBusFiles = null;
        this.Decoder = null;
    }
    static async load(extension) {
        this.Extension = extension;
        this.Settings = extension.getSettings();
        this.DBusFiles = new Map();
        this.Decoder = new TextDecoder("utf-8");

        // Pre-load common files
        try {
            const dbusPath = "media/dbus.xml";
            const file = Gio.File.new_for_path(`${extension.path}/${dbusPath}`);
            const [bytes] = await file.load_contents_async(null);
            const xml = this.Decoder.decode(bytes);
            this.DBusFiles.set(dbusPath, Gio.DBusNodeInfo.new_for_xml(xml));
        } catch (e) {
            Logger.error(`Global: Failed to pre-load DBus XML: ${e}`);
        }

        // Quick Settings Items
        if (Main) {
            const QuickSettings = this.QuickSettings = Main.panel.statusArea.quickSettings;
            this.QuickSettingsMenu = QuickSettings.menu;
            this.QuickSettingsGrid = QuickSettings.menu._grid;
            this.QuickSettingsBox = QuickSettings.menu.box;
            this.QuickSettingsActor = QuickSettings.menu.actor;
            this.Indicators = QuickSettings._indicators;
            // Date Menu
            const DateMenu = this.DateMenu = Main.panel.statusArea.dateMenu;
            const DateMenuMenu = this.DateMenuMenu = DateMenu.menu;
            this.DateMenuBox = DateMenuMenu.box;
            this.DateMenuHolder = DateMenuMenu.box.first_child.first_child;
            // Message
            this.MessageTray = Main.messageTray;
        }
    }
}
