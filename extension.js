import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import Logger from "./libs/shared/logger.js";
import Global from "./global.js";
import Config from "./config.js";
import { UnsafeQuickToggleFeature } from "./features/toggle/unsafeQuickToggle.js";
import { MediaWidgetFeature } from "./features/widget/media.js";
import { WeatherWidgetFeature } from "./features/widget/weather.js";
import { NotificationsWidgetFeature } from "./features/widget/notifications.js";
import { TogglesLayoutFeature } from "./features/layout/toggles.js";
import { SystemItemsLayoutFeature } from "./features/layout/systemItems.js";
import { DateMenuLayoutFeature } from "./features/layout/dateMenu.js";
import { OverlayMenu } from "./features/overlayMenu.js";
import { DebugFeature } from "./features/debug.js";
import { VolumeMixerWidgetFeature } from "./features/widget/volumeMixer.js";
import { SystemIndicatorLayoutFeature } from "./features/layout/systemIndicator.js";
import { PanelLayoutFeature } from "./features/layout/panel.js";
import { watchDevices } from "./features/widget/audioDeviceRegistry.js";

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Volume from "resource:///org/gnome/shell/ui/status/volume.js";
import Gvc from "gi://Gvc";

const QuickSettings = Main.panel.statusArea.quickSettings;

const HIDE_KEY  = "volume-mixer-hide-devices";
const NAMES_KEY = "volume-mixer-custom-names";

let _timeoutIds = [];

function _delay(ms) {
    return new Promise(resolve => {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            _timeoutIds = _timeoutIds.filter(x => x !== id);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        _timeoutIds.push(id);
    });
}

function _clearDelays() {
    for (const id of _timeoutIds)
        GLib.Source.remove(id);
    _timeoutIds = [];
}

function _getVolumeObj(type) {
    return type === "output"
        ? QuickSettings?._volumeOutput?._output
        : QuickSettings?._volumeInput?._input;
}

function _getMixer() {
    return Volume.getMixerControl();
}

// Devuelve el displayName original del dispositivo a partir del id del item
function _getDeviceDisplayNameByItem(type, itemId) {
    const mixer = _getMixer();
    if (!mixer)
        return null;

    // El id de _deviceItems es el id interno de Gvc
    const dev = type === "output"
        ? mixer.lookup_output_id(itemId)
        : mixer.lookup_input_id(itemId);

    if (!dev)
        return null;

    const description = dev.get_description() || "unknown device";
    const origin      = dev.get_origin();

    return origin ? `${description} – ${origin}` : description;
}

// Ocultar/mostrar entradas de la lista del popup de sonido
function _applyHide(settings, type) {
    const volume = _getVolumeObj(type);
    if (!volume || !volume._deviceItems)
        return;

    const hiddenIds = settings.get_strv(HIDE_KEY);

    for (const [id, entry] of volume._deviceItems) {
        const displayName = _getDeviceDisplayNameByItem(type, id);
        if (!displayName)
            continue;

        const shouldHide = hiddenIds.includes(displayName);
        if (entry.actor)
            entry.actor.visible = !shouldHide;
    }
}

// Renombrar entradas de la lista del popup de sonido
function _applyNames(settings, type) {
    const volume = _getVolumeObj(type);
    if (!volume || !volume._deviceItems)
        return;

    const variant = settings.get_value(NAMES_KEY);
    const map = variant?.recursiveUnpack?.() ?? {};

    for (const [id, entry] of volume._deviceItems) {
        const displayName = _getDeviceDisplayNameByItem(type, id);
        if (!displayName)
            continue;

        const newName = map[displayName];
        if (newName && entry?.label?.get_text?.() !== newName)
            entry.label.set_text(newName);
        else if (!newName && entry?.label?.get_text?.() !== displayName)
            entry.label.set_text(displayName); // restaurar original
    }
}

function _applyAll(settings) {
    _applyHide(settings, "output");
    _applyHide(settings, "input");
    _applyNames(settings, "output");
    _applyNames(settings, "input");
}

export default class QstExtension extends Extension {
    disable() {
        Logger(`Extension ${this.metadata.name} deactivation started`);
        let start = +Date.now();

        if (this._disposeAudioRegistry) {
            this._disposeAudioRegistry();
            this._disposeAudioRegistry = null;
        }

        if (this._hideSub && this._settings) {
            this._settings.disconnect(this._hideSub);
            this._hideSub = null;
        }
        if (this._namesSub && this._settings) {
            this._settings.disconnect(this._namesSub);
            this._namesSub = null;
        }

        if (this._mixerSub) {
            const mixer = _getMixer();
            if (mixer) {
                mixer.disconnect(this._mixerSub);
                if (this._mixerInputSub)
                    mixer.disconnect(this._mixerInputSub);
            }
            this._mixerSub = null;
            this._mixerInputSub = null;
        }

        this._settings = null;

        _clearDelays();

        this.debug.unload();
        this.debug = null;

        for (const feature of this.features) {
            Logger(`Unload feature '${feature.constructor.name}'`);
            feature.unload();
        }
        this.features = null;

        Global.unload();
        Logger("Disabled. " + (+new Date() - start) + "ms taken");
    }

    async enable() {
        await Global.load(this);

        this.features = [
            new UnsafeQuickToggleFeature(),
            new NotificationsWidgetFeature(),
            new MediaWidgetFeature(),
            new VolumeMixerWidgetFeature(),
            new DateMenuLayoutFeature(),
            new WeatherWidgetFeature(),
            new OverlayMenu(),
            new TogglesLayoutFeature(),
            new SystemItemsLayoutFeature(),
            new SystemIndicatorLayoutFeature(),
            new PanelLayoutFeature(),
        ];

        this.debug = new DebugFeature();
        this.debug.load();

        Logger(`Extension activation started, version: ${Config.version}`);
        Logger.debug("Initializing features ...");
        let start = +Date.now();
        for (const feature of this.features) {
            Logger.debug(() => `Loading feature '${feature.constructor.name}'`);
            feature.load();
        }
        Logger(`Extension Loaded, ${+Date.now() - start}ms taken`);

        this._settings = this.getSettings();

        // Mantener la lista de dispositivos disponibles para el diálogo
        this._disposeAudioRegistry = watchDevices(this._settings);

        // Aplicar ocultar/renombrar sobre el popup de salidas/entradas
        this._setupAudioTweaks();
    }

    _setupAudioTweaks() {
        const settings = this._settings;

        // Aplicación inicial (deja que GNOME cree los items)
        _delay(800).then(() => _applyAll(settings));

        // Reaplicar cuando cambian las listas en GSettings
        this._hideSub = settings.connect(`changed::${HIDE_KEY}`, () => {
            _applyAll(settings);
        });

        this._namesSub = settings.connect(`changed::${NAMES_KEY}`, () => {
            _applyAll(settings);
        });

        // Reaplicar cuando aparecen nuevos dispositivos
        const mixer = _getMixer();
        if (mixer) {
            this._mixerSub = mixer.connect("output-added", () => _applyAll(settings));
            this._mixerInputSub = mixer.connect("input-added", () => _applyAll(settings));
        } else {
            this._mixerSub = null;
            this._mixerInputSub = null;
        }
    }
}