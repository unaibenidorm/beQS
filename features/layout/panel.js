import GLib from "gi://GLib";
import { FeatureBase } from "../../libs/shell/feature.js";
import Global from "../../global.js";

const WIDGET_MATCHERS = {
    weather:       c => (c.constructor?.name || "").includes("Weather"),
    notifications: c => (c.constructor?.name || "").includes("Notification")
                     && !(c.constructor?.name || "").includes("Media"),
    media:         c => (c.constructor?.name || "").includes("Media"),
    mixer:         c => (c.constructor?.name || "").includes("Mixer"),
};

export class PanelLayoutFeature extends FeatureBase {
    _scheduleUpdate(delay = 150) {
        if (this._updateId)
            return;
        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateId = 0;
            this.onUpdate();
            return GLib.SOURCE_REMOVE;
        });
    }

    loadSettings(loader) {
        this.order = loader.loadStrv("panel-order") ?? ["weather", "notifications", "media", "mixer"];
        this.widgetsPosition = loader.loadString("panel-widgets-position") ?? "bottom";
    }

    reload(key) {
        if (key === "panel-order" || key === "panel-widgets-position") {
            this.loadSettings(this.loader);
            this._scheduleUpdate();
            return;
        }
        super.reload(key);
    }

    onUpdate() {
        if (this._updating)
            return;

        this._updating = true;
        try {
            this._doUpdate();
        } catch (e) {
            logError(e, "[PanelLayoutFeature]");
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._updating = false;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _doUpdate() {
        const grid = Global.QuickSettingsGrid;
        if (!grid)
            return;

        const children = grid.get_children();

        const widgetActors = {};
        for (const [key, matcher] of Object.entries(WIDGET_MATCHERS))
            widgetActors[key] = children.find(c => matcher(c)) ?? null;

        const allWidgets = Object.values(widgetActors).filter(Boolean);
        const nonWidgets = children.filter(c => !allWidgets.includes(c));

        const orderedWidgets = [];
        for (const key of this.order) {
            const actor = widgetActors[key];
            if (actor)
                orderedWidgets.push(actor);
        }

        for (const actor of allWidgets) {
            if (!orderedWidgets.includes(actor))
                orderedWidgets.push(actor);
        }

        const finalOrder = this.widgetsPosition === "top"
            ? [...orderedWidgets, ...nonWidgets]
            : [...nonWidgets, ...orderedWidgets];

        let last = null;
        for (const actor of finalOrder) {
            if (last)
                grid.set_child_above_sibling(actor, last);
            else
                grid.set_child_at_index(actor, 0);
            last = actor;
        }
    }

    onLoad() {
        this._scheduleUpdate(900);

        this.maid.connectJob(Global.QuickSettingsGrid, "child-added", () => {
            if (!this._updating)
                this._scheduleUpdate();
        });

        this.maid.connectJob(Global.QuickSettingsGrid, "child-removed", () => {
            if (!this._updating)
                this._scheduleUpdate();
        });

        if (Global.QuickSettingsMenu) {
            this.maid.connectJob(Global.QuickSettingsMenu, "open-state-changed", (_m, isOpen) => {
                if (isOpen)
                    this._scheduleUpdate(100);
            });
        }
    }

    onUnload() {
        if (this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }
    }
}