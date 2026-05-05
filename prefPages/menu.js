import Adw from "gi://Adw";
import GObject from "gi://GObject";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import Config from "../config.js";
import {
    SwitchRow,
    AdjustmentRow,
    DropdownRow,
    Group,
    fixPageScrollIssue,
} from "../libs/prefs/components.js";

export const MenuPage = GObject.registerClass({
    GTypeName: Config.baseGTypeName + "MenuPage",
}, class MenuPage extends Adw.PreferencesPage {
    constructor(settings, _prefs, _window) {
        super({
            name: "Menu",
            title: _("Menu"),
            iconName: "user-available-symbolic",
        });
        fixPageScrollIssue(this);

        // Menu Opening Animation
        Group({
            parent: this,
            title: _("Menu Opening Animation"),
            description: _("Add a custom animation when the Quick Settings menu opens"),
            headerSuffix: SwitchRow({
                settings,
                bind: "overlay-menu-enabled",
            }),
            experimental: true,
        }, [
            AdjustmentRow({
                settings,
                title: _("Animation Duration"),
                subtitle: _("Custom menu open animation duration in milliseconds\nSet this to 0 to disable custom animation"),
                sensitiveBind: "overlay-menu-enabled",
                bind: "overlay-menu-animate-duration",
                max: 4000,
            }),
            DropdownRow({
                settings,
                title: _("Animation Style"),
                subtitle: _("Custom menu open animation style"),
                items: [
                    { name: _("Flyout"),     value: "flyout" },
                    { name: _("Dialog"),     value: "dialog" },
                    { name: _("Slide down"), value: "slide-down" },
                    { name: _("Slide up"),   value: "slide-up" },
                    { name: _("Fade"),       value: "fade" },
                    { name: _("Zoom"),       value: "zoom" },
                    { name: _("Spin"),       value: "spin" },
                    { name: _("Flip"),       value: "flip" },
                    { name: _("Bounce"),     value: "bounce" },
                    { name: _("Swing"),      value: "swing" },
                    { name: _("Elastic"),    value: "elastic" },
                    { name: _("Unfold"),     value: "unfold" },
                ],
                bind: "overlay-menu-animate-style",
                sensitiveBind: "overlay-menu-enabled"
            }),
        ]);
    }
});