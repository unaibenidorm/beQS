import Adw from "gi://Adw";
import GObject from "gi://GObject";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import Config from "../config.js";
import { SwitchRow, Group, fixPageScrollIssue } from "../libs/prefs/components.js";

export const TogglesPage = GObject.registerClass({
    GTypeName: Config.baseGTypeName + "TogglesPage",
}, class TogglesPage extends Adw.PreferencesPage {
    constructor(settings, _prefs, _window) {
        super({
            name: "Toggles",
            title: _("Toggles"),
            iconName: "view-grid-symbolic",
        });
        fixPageScrollIssue(this);

        // Unsafe Mode
        Group({
            parent: this,
            title: _("Unsafe Mode"),
            description: _("Allow access to restricted shell features"),
            headerSuffix: SwitchRow({
                settings,
                bind: "unsafe-quick-toggle-enabled",
            }),
        }, [
            SwitchRow({
                settings,
                title: _("Save last state"),
                subtitle: _("Restore the last unsafe mode state on shell restart"),
                bind: "unsafe-quick-toggle-save-last-state",
                sensitiveBind: "unsafe-quick-toggle-enabled",
            }),
        ]);
    }
});