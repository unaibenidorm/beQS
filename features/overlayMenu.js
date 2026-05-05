import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { FeatureBase } from "../libs/shell/feature.js";
import { QuickSettingsMenuTracker } from "../libs/shell/quickSettingsUtils.js";
import * as AdvAni from "../libs/shell/advani.js";
import Global from "../global.js";
import Logger from "../libs/shared/logger.js";

export class OverlayMenu extends FeatureBase {
    loadSettings(loader) {
        this.enabled = loader.loadBoolean("overlay-menu-enabled");
        this.duration = loader.loadInt("overlay-menu-animate-duration");
        this.animationStyle = loader.loadString("overlay-menu-animate-style");
    }

    _getMenuBox() {
        return Global.QuickSettingsMenu?.box;
    }

    _easeWithFallback(actor, params) {
        const { scale_x, scale_y, translation_y, advMode, fallbackMode } = params;
        try {
            AdvAni.ease(actor, {
                scale_x,
                scale_y,
                ...(translation_y !== undefined ? { translation_y } : {}),
                mode: advMode,
                duration: this.duration,
            });
        } catch (_e) {
            actor.ease({
                scale_x,
                scale_y,
                ...(translation_y !== undefined ? { translation_y } : {}),
                duration: this.duration,
                mode: fallbackMode,
            });
        }
    }

    _applyMainAnimation() {
        const box = this._getMenuBox();
        if (!box)
            return;

        box.remove_all_transitions();

        if (this.duration <= 0) {
            box.opacity = 255;
            box.scale_x = 1;
            box.scale_y = 1;
            box.translation_x = 0;
            box.translation_y = 0;
            return;
        }

        const fadeInDuration = Math.max(80, Math.floor(this.duration * 0.4));

        switch (this.animationStyle) {
        case "flyout":
            box.set_pivot_point(0.5, 1.0);
            box.opacity = 0;
            box.scale_x = 0.85;
            box.scale_y = 0.85;
            box.translation_y = 40;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            this._easeWithFallback(box, {
                scale_x: 1,
                scale_y: 1,
                translation_y: 0,
                advMode: AdvAni.AdvAnimationMode.LowBackover,
                fallbackMode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            break;

        case "dialog":
            box.set_pivot_point(0.5, 0.5);
            box.opacity = 0;
            box.scale_x = 0.85;
            box.scale_y = 0.85;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            this._easeWithFallback(box, {
                scale_x: 1,
                scale_y: 1,
                advMode: AdvAni.AdvAnimationMode.MiddleBackover,
                fallbackMode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            break;

        case "slide-down":
            box.set_pivot_point(0.5, 0);
            box.opacity = 0;
            box.translation_y = -60;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ translation_y: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_EXPO });
            break;

        case "slide-up":
            box.set_pivot_point(0.5, 1);
            box.opacity = 0;
            box.translation_y = 60;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ translation_y: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_EXPO });
            break;

        case "fade":
            box.opacity = 0;
            box.ease({ opacity: 255, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            break;

        case "zoom":
            box.set_pivot_point(0.5, 0.5);
            box.opacity = 0;
            box.scale_x = 0.4;
            box.scale_y = 0.4;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ scale_x: 1, scale_y: 1, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            break;

        case "spin":
            box.set_pivot_point(0.5, 0.5);
            box.opacity = 0;
            box.scale_x = 0.5;
            box.scale_y = 0.5;
            box.rotation_angle_z = -180;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ scale_x: 1, scale_y: 1, rotation_angle_z: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            break;

        case "flip":
            box.set_pivot_point(0.5, 0.5);
            box.opacity = 0;
            box.rotation_angle_x = 90;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ rotation_angle_x: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            break;

        case "bounce":
            box.set_pivot_point(0.5, 0);
            box.opacity = 0;
            box.translation_y = -120;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ translation_y: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE });
            break;

        case "swing":
            box.set_pivot_point(0.5, 0);
            box.opacity = 0;
            box.rotation_angle_z = 15;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ rotation_angle_z: 0, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC });
            break;

        case "elastic":
            box.set_pivot_point(0.5, 0.5);
            box.opacity = 0;
            box.scale_x = 0.3;
            box.scale_y = 0.3;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ scale_x: 1, scale_y: 1, duration: Math.floor(this.duration * 1.5), mode: Clutter.AnimationMode.EASE_OUT_ELASTIC });
            break;

        case "unfold":
            box.set_pivot_point(0.5, 0);
            box.opacity = 0;
            box.scale_x = 1;
            box.scale_y = 0;
            box.ease({ opacity: 255, duration: fadeInDuration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            box.ease({ scale_y: 1, duration: this.duration, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            break;
        }
    }

    _resetMainMenu() {
        const box = this._getMenuBox();
        if (!box)
            return;

        box.remove_all_transitions();
        box.opacity = 255;
        box.scale_x = 1;
        box.scale_y = 1;
        box.translation_x = 0;
        box.translation_y = 0;
        box.rotation_angle_z = 0;
        box.rotation_angle_x = 0;
        box.rotation_angle_y = 0;
    }

    onMenuOpenStateChanged(_maid, _menu, isOpen) {
        if (!isOpen) {
            this._resetMainMenu();
            return;
        }

        // Apply the opening animation
        const box = this._getMenuBox();
        if (box) box.opacity = 0;

        if (this._revealTimeout) {
            GLib.source_remove(this._revealTimeout);
        }

        this._revealTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            const menuBox = this._getMenuBox();
            if (!menuBox || !menuBox.mapped)
                return GLib.SOURCE_CONTINUE;

            this._applyMainAnimation();
            this._revealTimeout = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    onLoad() {
        if (!this.enabled)
            return;

        this.tracker = new QuickSettingsMenuTracker();
        this.tracker.onMenuOpen = this.onMenuOpenStateChanged.bind(this);
        this.tracker.load();
    }

    onUnload() {
        if (this._revealTimeout) {
            GLib.source_remove(this._revealTimeout);
            this._revealTimeout = 0;
        }

        if (this.tracker) {
            this.tracker.unload();
            this.tracker = null;
        }

        this._resetMainMenu();
    }
}