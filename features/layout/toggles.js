import GLib from "gi://GLib";
import GObject from "gi://GObject";
import {
    QuickToggle,
    QuickMenuToggle,
} from "resource:///org/gnome/shell/ui/quickSettings.js";
import { FeatureBase } from "../../libs/shell/feature.js";
import { QuickSettingsToggleTracker } from "../../libs/shell/quickSettingsUtils.js";
import { ToggleOrderItem } from "../../libs/types/toggleOrderItem.js";
import Global from "../../global.js";

const BG_APPS_GTYPE = "Gjs_status_backgroundApps_BackgroundAppsToggle";
const BG_APPS_CTOR = "BackgroundAppsToggle";

export class TogglesLayoutFeature extends FeatureBase {
    _scheduleUpdate(delay = 150) {
        if (this._updateId)
            return;
        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateId = 0;
            this.onUpdate();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleDetectedListUpdate(delay = 300) {
        if (this._detectedListUpdateId)
            return;
        this._detectedListUpdateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._detectedListUpdateId = 0;
            this._updateDetectedList();
            return GLib.SOURCE_REMOVE;
        });
    }

    _getToggleIdentity(toggle) {
        let gtypeName = "";
        try {
            gtypeName = GObject.type_name_from_instance(toggle) || "";
        } catch (_e) {}

        return {
            gtypeName,
            constructorName: toggle.constructor?.name || "",
            title: (typeof toggle.title === "string" ? toggle.title : "") || "",
        };
    }

    _isBackgroundApps(toggle) {
        const id = this._getToggleIdentity(toggle);
        return id.gtypeName === BG_APPS_GTYPE
            || id.constructorName === BG_APPS_CTOR
            || id.gtypeName.includes("BackgroundApps");
    }

    _shouldIgnoreToggle(toggle) {
        return this._isBackgroundApps(toggle);
    }

    _isToggleLike(toggle) {
        if (!toggle)
            return false;
        if (toggle instanceof QuickToggle || toggle instanceof QuickMenuToggle)
            return true;

        const id = this._getToggleIdentity(toggle);
        if (id.gtypeName.includes("Toggle") || id.constructorName.includes("Toggle"))
            return true;
        if (typeof toggle.title === "string" && typeof toggle.iconName === "string")
            return true;

        return false;
    }

    _updateDetectedList() {
        if (!Global.QuickSettingsGrid)
            return;

        try {
            const tokens = new Set();
            for (const child of Global.QuickSettingsGrid.get_children()) {
                if (!this._isToggleLike(child))
                    continue;
                if (this._shouldIgnoreToggle(child))
                    continue;
                const id = this._getToggleIdentity(child);
                if (id.gtypeName)
                    tokens.add(id.gtypeName);
                if (id.constructorName)
                    tokens.add(id.constructorName);
            }

            const list = [...tokens];
            const current = Global.Settings.get_strv("toggles-detected-list");
            const changed = current.length !== list.length
                || current.some((v, i) => list[i] !== v);

            if (changed)
                Global.Settings.set_strv("toggles-detected-list", list);
        } catch (e) {
            logError(e, "[TogglesLayoutFeature._updateDetectedList]");
        }
    }

    loadSettings(loader) {
        this.enabled = loader.loadBoolean("toggles-layout-enabled");
        this.hideBackgroundApps = loader.loadBoolean("toggles-layout-hide-background-apps");
        this.order = loader.loadValue("toggles-layout-order");
        this.unordered = null;

        for (const orderItem of this.order) {
            if (orderItem.titleRegex) {
                try {
                    orderItem.cachedTitleRegex = new RegExp(orderItem.titleRegex);
                } catch (_e) {
                    orderItem.cachedTitleRegex = null;
                }
            }
            if (orderItem.nonOrdered)
                this.unordered = orderItem;
        }
    }

    reload(key) {
        if (key === "toggles-layout-order" || key === "toggles-layout-hide-background-apps") {
            if (this._selfWriting)
                return;
            this.loadSettings(this.loader);
            this._scheduleRescanExistingToggles();
            this._scheduleUpdate();
            return;
        }
        super.reload(key);
    }

    _scheduleRescanExistingToggles() {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            try {
                if (!Global.QuickSettingsGrid)
                    return GLib.SOURCE_REMOVE;

                const children = Global.QuickSettingsGrid.get_children();
                for (const child of children) {
                    if (!this._isToggleLike(child))
                        continue;
                    if (this._shouldIgnoreToggle(child))
                        continue;

                    const hasExplicitRule = this.order.some(
                        item => !item.nonOrdered && ToggleOrderItem.toggleMatch(item, child)
                    );
                    if (!hasExplicitRule)
                        this._autoRegisterToggle(child);
                }
            } catch (e) {
                logError(e, "[TogglesLayoutFeature._scheduleRescanExistingToggles]");
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _autoRegisterToggle(toggle) {
        if (this._shouldIgnoreToggle(toggle))
            return;

        const id = this._getToggleIdentity(toggle);
        if (!id.gtypeName && !id.constructorName)
            return;

        try {
            const raw = Global.Settings.get_value("toggles-layout-order");
            const items = raw.recursiveUnpack();

            const isGenericGtype = id.gtypeName === "Gjs_ui_quickSettings_QuickMenuToggle"
                || id.gtypeName === "Gjs_ui_quickSettings_QuickToggle";

            const alreadyExists = items.some(i => {
                if (i.nonOrdered)
                    return false;
                if (isGenericGtype)
                    return i.gtypeName === id.gtypeName && (i.title || "") === (id.title || "");
                if (id.gtypeName && i.gtypeName === id.gtypeName)
                    return true;
                if (!id.gtypeName && id.constructorName && i.constructorName === id.constructorName)
                    return true;
                return false;
            });

            if (alreadyExists)
                return;

            const nonOrderedIdx = items.findIndex(i => i.nonOrdered === true);

            let displayTitle = "";
            if (typeof toggle.title === "string" && toggle.title.trim()) {
                displayTitle = toggle.title.trim();
            } else if (toggle.accessible_name && String(toggle.accessible_name).trim()) {
                displayTitle = String(toggle.accessible_name).trim();
            } else if (id.gtypeName) {
                displayTitle = id.gtypeName
                    .replace(/Toggle$/, "")
                    .replace(/^Gjs_/, "")
                    .replace(/_/g, " ")
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .trim();
            } else if (id.constructorName) {
                displayTitle = id.constructorName
                    .replace(/Toggle$/, "")
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .trim();
            }
            if (!displayTitle)
                displayTitle = id.gtypeName || id.constructorName || "Unknown toggle";

            const newEntry = {
                gtypeName: id.gtypeName,
                constructorName: id.constructorName,
                title: id.title,
                titleRegex: "",
                friendlyName: displayTitle,
                hide: false,
                isSystem: false,
            };

            if (nonOrderedIdx !== -1)
                items.splice(nonOrderedIdx, 0, newEntry);
            else
                items.push(newEntry);

            const repack = item => {
                const out = {};
                for (const [k, v] of Object.entries(item)) {
                    if (typeof v === "boolean")
                        out[k] = new GLib.Variant("v", new GLib.Variant("b", v));
                    else if (typeof v === "string")
                        out[k] = new GLib.Variant("v", new GLib.Variant("s", v));
                }
                return out;
            };

            this._selfWriting = true;
            try {
                Global.Settings.set_value(
                    "toggles-layout-order",
                    new GLib.Variant("aa{sv}", items.map(repack))
                );
                this.order = items;
                if (!this.unordered)
                    this.unordered = items.find(i => i.nonOrdered) ?? null;
            } finally {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._selfWriting = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            logError(e, "[TogglesLayoutFeature._autoRegisterToggle]");
        }
    }

    _applyBackgroundAppsHide() {
        if (!Global.QuickSettingsGrid)
            return;

        const bgApps = Global.QuickSettings?._backgroundApps
            ?? Global.QuickSettingsGrid.get_children().find(c => this._isBackgroundApps(c));

        if (!bgApps)
            return;

        if (this.hideBackgroundApps) {
            bgApps.visible = false;
            bgApps.opacity = 0;
            bgApps.height = 0;
            bgApps.hide();

            if (!bgApps._beqsBgAppsShowConn) {
                bgApps._beqsBgAppsShowConn = bgApps.connect("show", () => {
                    if (!this.hideBackgroundApps)
                        return;
                    bgApps.hide();
                    bgApps.visible = false;
                    bgApps.opacity = 0;
                    bgApps.height = 0;
                });
            }

            if (!bgApps._beqsBgAppsNotifyConn) {
                bgApps._beqsBgAppsNotifyConn = bgApps.connect("notify::visible", () => {
                    if (!this.hideBackgroundApps)
                        return;
                    if (bgApps.visible) {
                        bgApps.hide();
                        bgApps.visible = false;
                        bgApps.opacity = 0;
                        bgApps.height = 0;
                    }
                });
            }
        } else {
            if (bgApps._beqsBgAppsShowConn) {
                try { bgApps.disconnect(bgApps._beqsBgAppsShowConn); } catch (_e) {}
                bgApps._beqsBgAppsShowConn = 0;
            }
            if (bgApps._beqsBgAppsNotifyConn) {
                try { bgApps.disconnect(bgApps._beqsBgAppsNotifyConn); } catch (_e) {}
                bgApps._beqsBgAppsNotifyConn = 0;
            }

            bgApps.height = -1;
            bgApps.opacity = 255;
            bgApps.visible = true;
            bgApps.show();

            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    bgApps.height = -1;
                    bgApps.opacity = 255;
                    bgApps.visible = true;
                    bgApps.show();
                    Global.QuickSettingsGrid.queue_relayout?.();
                } catch (_e) {}
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    onToggleCreated(maid, toggle) {
        if (this._isBackgroundApps(toggle)) {
            if (this.hideBackgroundApps)
                maid.hideJob(toggle);
            return;
        }

        if (this._shouldIgnoreToggle(toggle))
            return;

        const rule = this.order.find(item => ToggleOrderItem.toggleMatch(item, toggle))
            ?? this.unordered;

        if (rule && rule.hide)
            maid.hideJob(toggle);

        const hasExplicitRule = this.order.some(
            item => !item.nonOrdered && ToggleOrderItem.toggleMatch(item, toggle)
        );

        if (!hasExplicitRule) {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                if (toggle && !toggle.is_destroyed?.())
                    this._autoRegisterToggle(toggle);
                return GLib.SOURCE_REMOVE;
            });
        }

        this._scheduleDetectedListUpdate();
    }

    onUpdate() {
        if (this._updating)
            return;

        this._updating = true;
        try {
            this._doUpdate();
        } catch (e) {
            logError(e, "[TogglesLayoutFeature.onUpdate]");
        } finally {
            this._updating = false;
        }
    }

    _doUpdate() {
        if (!Global.QuickSettingsGrid)
            return;

        const children = Global.QuickSettingsGrid.get_children();

        const toggles = children.filter(c => {
            if (!this._isToggleLike(c))
                return false;
            if (this._isBackgroundApps(c))
                return false;
            return true;
        });

        for (const toggle of toggles) {
            const rule = this.order.find(item => ToggleOrderItem.toggleMatch(item, toggle))
                ?? this.unordered;

            if (rule && rule.hide) {
                if (toggle.visible) {
                    toggle.visible = false;
                    toggle._beqsForcedHidden = true;
                }
            } else if (toggle._beqsForcedHidden) {
                toggle.visible = true;
                toggle._beqsForcedHidden = false;
            }
        }

        const middle = [...toggles];
        const head = [];
        const tail = [];
        let overNonOrdered = false;

        for (const item of this.order) {
            if (item.nonOrdered) {
                overNonOrdered = true;
                continue;
            }
            const idx = middle.findIndex(t => ToggleOrderItem.toggleMatch(item, t));
            if (idx === -1)
                continue;
            const t = middle[idx];
            middle.splice(idx, 1);
            (overNonOrdered ? tail : head).push(t);
        }

        const orderedToggles = [...head, ...middle, ...tail];
        const firstToggleIndex = children.findIndex(c => toggles.includes(c));

        if (firstToggleIndex !== -1) {
            let last = null;
            for (const t of orderedToggles) {
                if (last)
                    Global.QuickSettingsGrid.set_child_above_sibling(t, last);
                else
                    Global.QuickSettingsGrid.set_child_at_index(t, firstToggleIndex);
                last = t;
            }
        }

        this._applyBackgroundAppsHide();
        this._scheduleDetectedListUpdate();
    }

    onLoad() {
        if (!this.enabled)
            return;

        this.tracker = new QuickSettingsToggleTracker();
        this.tracker.onToggleCreated = this.onToggleCreated.bind(this);
        this.tracker.onUpdate = () => this._scheduleUpdate();
        this.tracker.load();

        this._scheduleUpdate(200);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            if (!this._updateId)
                this._scheduleUpdate(0);
            return GLib.SOURCE_REMOVE;
        });

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            if (!this._updateId)
                this._scheduleUpdate(0);
            this._updateDetectedList();
            return GLib.SOURCE_REMOVE;
        });

        if (Global.QuickSettingsMenu) {
            this.maid.connectJob(Global.QuickSettingsMenu, "open-state-changed", (_m, isOpen) => {
                if (isOpen) {
                    this._scheduleUpdate(50);
                    this._scheduleDetectedListUpdate(100);
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                        this._applyBackgroundAppsHide();
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    this._applyBackgroundAppsHide();
                }
            });
        }
    }

    onUnload() {
        if (this.tracker) {
            this.tracker.unload();
            this.tracker = null;
        }

        if (this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }

        if (this._detectedListUpdateId) {
            GLib.source_remove(this._detectedListUpdateId);
            this._detectedListUpdateId = 0;
        }

        if (Global.QuickSettingsGrid) {
            for (const c of Global.QuickSettingsGrid.get_children()) {
                if (c._beqsForcedHidden) {
                    c.visible = true;
                    c._beqsForcedHidden = false;
                }
            }
        }

        const bgApps = Global.QuickSettings?._backgroundApps;
        if (bgApps) {
            if (bgApps._beqsBgAppsShowConn) {
                try { bgApps.disconnect(bgApps._beqsBgAppsShowConn); } catch (_e) {}
                bgApps._beqsBgAppsShowConn = 0;
            }
            if (bgApps._beqsBgAppsNotifyConn) {
                try { bgApps.disconnect(bgApps._beqsBgAppsNotifyConn); } catch (_e) {}
                bgApps._beqsBgAppsNotifyConn = 0;
            }
            bgApps.height = -1;
            bgApps.opacity = 255;
            bgApps.visible = true;
            bgApps.show();
        }
    }
}