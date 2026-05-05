import GLib from "gi://GLib";
import Gvc from "gi://Gvc";
import * as Volume from "resource:///org/gnome/shell/ui/status/volume.js";

export const AVAILABLE_OUTPUTS_KEY = "volume-mixer-available-outputs";
export const AVAILABLE_INPUTS_KEY  = "volume-mixer-available-inputs";

function range(amount) {
    return [...Array(amount).keys()];
}

function getDisplayName(description, origin) {
    if (!description) description = "unknown device";
    return origin ? `${description} \u2013 ${origin}` : description;
}

export function updateAvailableDevices(settings) {
    try {
        const mixer = Volume.getMixerControl();
        if (!mixer || mixer.get_state() !== Gvc.MixerControlState.READY) return;

        const dummy  = new Gvc.MixerUIDevice();
        const allIds = range(dummy.get_id());

        const outputs = allIds
            .map(id => mixer.lookup_output_id(id))
            .filter(dev => dev !== null)
            .map(dev => getDisplayName(dev.get_description(), dev.get_origin()));

        const inputs = allIds
            .map(id => mixer.lookup_input_id(id))
            .filter(dev => dev !== null)
            .map(dev => getDisplayName(dev.get_description(), dev.get_origin()));

        settings.set_strv(AVAILABLE_OUTPUTS_KEY, outputs);
        settings.set_strv(AVAILABLE_INPUTS_KEY,  inputs);
    } catch (e) {
        console.warn("audioDeviceRegistry: failed to update devices:", e);
    }
}

export function watchDevices(settings) {
    const mixer = Volume.getMixerControl();
    if (!mixer) return () => {};

    const ids = [
        mixer.connect("output-added",   () => updateAvailableDevices(settings)),
        mixer.connect("output-removed", () => updateAvailableDevices(settings)),
        mixer.connect("input-added",    () => updateAvailableDevices(settings)),
        mixer.connect("input-removed",  () => updateAvailableDevices(settings)),
    ];

    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        updateAvailableDevices(settings);
        return GLib.SOURCE_REMOVE;
    });

    return () => {
        ids.forEach(id => mixer.disconnect(id));
        if (timerId) GLib.source_remove(timerId);
    };
}