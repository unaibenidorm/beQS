import GObject from "gi://GObject";
import {
    QuickMenuToggle,
    QuickToggle,
    SystemIndicator,
} from "resource:///org/gnome/shell/ui/quickSettings.js";
import { PopupSeparatorMenuItem } from "resource:///org/gnome/shell/ui/popupMenu.js";
import Global from "../../global.js";
import Maid from "../shared/maid.js";

export class ChildrenTrackerBase {
    load() {
        const connectTarget = this.connectTarget = this.getConnectTarget();
        this.appliedChild = new Map();
        this.addConnection = connectTarget.connect("child-added", (_, child) => {
            this.catchChild(child);
            if (this.onUpdate)
                this.onUpdate();
        });
        for (const child of connectTarget.get_children()) {
            this.catchChild(child);
        }
        if (this.onUpdate)
            this.onUpdate();
    }
    unload() {
        for (const maid of this.appliedChild.values()) {
            maid.destroy();
        }
        this.connectTarget.disconnect(this.addConnection);
        this.addConnection = null;
        this.appliedChild = null;
    }
    get items() {
        if (!this.appliedChild)
            return [];
        return [...this.appliedChild.keys()];
    }
}

export class QuickSettingsMenuTracker {
    load() {
        this.openConnection = Global.QuickSettingsMenu.connect("open-state-changed", (_, isOpen) => {
            if (this.onMenuOpen)
                this.onMenuOpen(null, Global.QuickSettingsMenu, isOpen);
        });
    }
    unload() {
        Global.QuickSettingsMenu.disconnect(this.openConnection);
    }
}

// FIXED: Tracker más robusto para GNOME 48/49/50
export class QuickSettingsToggleTracker extends ChildrenTrackerBase {
    catchChild(child) {
        if (!child) return;

        // En GNOME 48+, constructor.name puede venir ofuscado.
        // Usamos GObject.type_name_from_instance como fuente primaria.
        let gtypeName = "";
        try {
            gtypeName = GObject.type_name_from_instance(child) || "";
        } catch (_e) {
            // No es GObject, ignorar
            return;
        }

        const ctorName = child.constructor?.name || "";

        // Detección resistente: es "toggle-like" si...
        const isToggleLike =
            child instanceof QuickToggle ||
            child instanceof QuickMenuToggle ||
            ctorName.includes("Toggle") ||
            gtypeName.includes("Toggle") ||
            // Heurística para toggles de extensiones de terceros:
            // tienen 'title' (string) e 'iconName' (string) como propiedades.
            (typeof child.title === "string" && typeof child.iconName === "string");

        if (!isToggleLike) return;
        if (this.appliedChild.has(child)) return;

        const toggleMaid = new Maid();
        toggleMaid.functionJob(() => {
            if (this.appliedChild)
                this.appliedChild.delete(child);
        });
        toggleMaid.connectJob(child, "destroy", () => {
            toggleMaid.destroy();
        });

        if (this.onToggleCreated)
            this.onToggleCreated(toggleMaid, child);

        this.appliedChild.set(child, toggleMaid);
    }

    getConnectTarget() {
        return Global.QuickSettingsGrid;
    }
}

export class SystemIndicatorTracker extends ChildrenTrackerBase {
    catchChild(child) {
        if (!(child instanceof SystemIndicator))
            return;
        if (this.appliedChild.has(child))
            return;
        const indicatorMaid = new Maid();
        indicatorMaid.functionJob(() => {
            if (this.appliedChild)
                this.appliedChild.delete(child);
        });
        indicatorMaid.connectJob(child, "destroy", () => {
            indicatorMaid.destroy();
        });
        if (this.onIndicatorCreated)
            this.onIndicatorCreated(indicatorMaid, child);
        this.appliedChild.set(child, indicatorMaid);
    }
    getConnectTarget() {
        return Global.Indicators;
    }
}

export function updateMenuSeparators(menu) {
    for (const item of menu._getMenuItems()) {
        if (!(item instanceof PopupSeparatorMenuItem)) {
            continue;
        }
        menu._updateSeparatorVisibility(item);
    }
}