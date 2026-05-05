import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as MessageList from "resource:///org/gnome/shell/ui/messageList.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { FeatureBase } from "../../libs/shell/feature.js";
import { StyledScroll } from "../../libs/shell/styler.js";
import { Drag, Scroll } from "../../libs/shell/gesture.js";
import Global from "../../global.js";
// #region Placeholder
class Placeholder extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: "beQS-placeholder",
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 60,
            x_expand: true,
        });
        // Symbolic Icon
        this._icon = new St.Icon({
            style_class: "beQS-icon",
            icon_name: "no-notifications-symbolic"
        });
        this.add_child(this._icon);
        // No Notifications Label
        this._label = new St.Label({ text: _("No Notifications") });
        this.add_child(this._label);
    }
}
GObject.registerClass(Placeholder);
// #endregion Placeholder
// #region ClearButton
class ClearButton extends St.Button {
    _init() {
        // Child Container
        this._container = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
        });
        // Button
        super._init({
            style_class: "beQS-clear-button",
            button_mask: St.ButtonMask.ONE,
            child: this._container,
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Icon
        this._icon = new St.Icon({
            style_class: "beQS-icon",
            icon_name: "user-trash-symbolic",
            icon_size: 12
        });
        this._container.add_child(this._icon);
        // Label
        this._label = new St.Label({
            text: _("Clear")
        });
        this._container.add_child(this._label);
    }
}
GObject.registerClass(ClearButton);
// #endregion ClearButton
// #region Header
class Header extends St.BoxLayout {
    constructor(options) {
        super(options);
    }
    _init(options) {
        super._init({
            style_class: "beQS-header"
        });
        // Label
        this._headerLabel = new St.Label({
            text: _("Notifications"),
            style_class: "beQS-header-label",
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: true
        });
        this.add_child(this._headerLabel);
        // Clear button
        if (options.createClearButton) {
            this._clearButton = new ClearButton();
            this.add_child(this._clearButton);
        }
    }
}
GObject.registerClass(Header);
// #endregion Header
// #region NativeControl
class NativeControl extends St.BoxLayout {
    _init() {
        // See : https://github.com/GNOME/gnome-shell/blob/934dbe549567f87d7d6deb6f28beaceda7da1d46/js/ui/calendar.js#L979
        super._init({
            style_class: "beQS-native-controls",
        });
        // DND Switch
        this._dndSwitch = new Global.MessageList._dndSwitch.constructor(); // Calendar.DoNotDisturbSwitch();
        this._dndSwitch.style_class += " beQS-native-dnd-switch";
        // DND Label
        this._dndLabel = new St.Label({
            style_class: "beQS-native-dnd-text",
            text: _("Do Not Disturb"),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._dndLabel);
        this._dndButton = new St.Button({
            style_class: "dnd-button",
            can_focus: true,
            toggle_mode: true,
            child: this._dndSwitch,
            label_actor: this._dndLabel,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dndSwitch.bind_property("state", this._dndButton, "checked", GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
        this.add_child(this._dndButton);
        // Clear Button
        this._clearButton = new St.Button({
            style_class: "message-list-clear-button button beQS-native-clear-button",
            label: _("Clear"),
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            accessible_name: C_("action", "Clear all notifications"),
        });
        this.add_child(this._clearButton);
    }
}
GObject.registerClass(NativeControl);
// #endregion NativeControl
// #region NotificationList
class NotificationList extends MessageList.MessageView {
    constructor() {
        super();
    }
    // Do not setup mpris
    _setupMpris() { }
}
GObject.registerClass(NotificationList);
// #endregion NotificationList
// #region NotificationWidget
class NotificationWidget extends St.BoxLayout {
    constructor(options) {
        super(options);
    }
    _init(options) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._options = options;
        this._createScroll();
        this._createHeaderArea();
        this._createPlaceholder();
        this._createNativeControl();
        this.add_child(this._header);
        this.add_child(this._scroll);
        if (this._placeholder)
            this.add_child(this._placeholder);
        if (this._nativeControl)
            this.add_child(this._nativeControl);
        this._list.connectObject("notify::empty", this._syncEmpty.bind(this), this);
        this._list.connectObject("notify::can-clear", this._syncClear.bind(this), this);
        this._syncEmpty();
        this._syncClear();
        this._updateMaxHeight();
        this._updateStyleClass();
    }
    // Box style
    _updateMaxHeight() {
        const maxHeight = this._options.maxHeight;
        this.style = maxHeight
            ? `max-height:${maxHeight}px;`
            : "";
    }
    _updateStyleClass() {
        const options = this._options;
        let style = "beQS-notifications";
        if (options.useNativeControls)
            style += " beQS-use-native-controls";
        if (options.compact)
            style += " beQS-message-compact";
        if (options.removeShadow)
            style += " beQS-message-remove-shadow";
        this.style_class = style;
    }
    // Scroll view
    _createScroll() {
        this._list = new NotificationList();
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            child: this._list,
        });
        this._updateScrollStyle();
        this._scroll.connectObject("notify::vscrollbar-visible", this._syncScrollbarPadding.bind(this), this);
        this._syncScrollbarPadding();
    }
    _updateScrollStyle() {
        StyledScroll.updateStyle(this._scroll, this._options.scrollStyle);
    }
    _syncScrollbarPadding() {
        this._scroll.style_class =
            this._scroll.vscrollbar_visible
                ? "beQS-has-scrollbar"
                : "";
    }
    _createHeaderArea() {
        const header = this._header = new Header({ createClearButton: !this._options.useNativeControls });
        this._header.visible = this._options.header;
        if (header._clearButton) {
            header._clearButton.connectObject("clicked", this._list.clear.bind(this._list), this);
        }
    }
    _createPlaceholder() {
        if (this._options.autoHide)
            return;
        this._placeholder = new Placeholder();
    }
    _createNativeControl() {
        if (!this._options.useNativeControls)
            return;
        this._nativeControl = new NativeControl();
        this._nativeControl._clearButton.connectObject("clicked", this._list.clear.bind(this._list), this);
    }
    // See : https://github.com/GNOME/gnome-shell/blob/934dbe549567f87d7d6deb6f28beaceda7da1d46/js/ui/calendar.js#L1043
    _syncClear() {
        // Sync clear button reactive state
        const canClear = this._list.canClear;
        // Update native control clear button if it exists
        if (this._nativeControl) {
            this._nativeControl._clearButton.reactive = canClear;
            this._nativeControl._clearButton.can_focus = canClear;
            // Update style to visually indicate if button is enabled/disabled
            if (canClear) {
                this._nativeControl._clearButton.remove_style_class_name('disabled');
            }
            else {
                this._nativeControl._clearButton.add_style_class_name('disabled');
            }
        }
        // Update custom clear button if it exists
        const clearButton = this._header._clearButton;
        if (clearButton) {
            clearButton.visible = canClear;
            clearButton.reactive = canClear;
            clearButton.can_focus = canClear;
            // Update style to visually indicate if button is enabled/disabled
            if (canClear) {
                clearButton.remove_style_class_name('disabled');
            }
            else {
                clearButton.add_style_class_name('disabled');
            }
        }
    }
    _syncEmpty() {
        // placeholder / autohide
        const empty = this._list.empty;
        if (this._options.autoHide) {
            this.visible = !empty;
        }
        else {
            this._scroll.visible = !empty;
            this._placeholder.visible = empty;
        }
    }
}
GObject.registerClass(NotificationWidget);
// #endregion NotificationWidget
// #region NotificationsWidgetFeature
export class NotificationsWidgetFeature extends FeatureBase {
    loadSettings(loader) {
        this.enabled = loader.loadBoolean("notifications-enabled");
        this.useNativeControls = loader.loadBoolean("notifications-use-native-controls");
        this.autoHide = loader.loadBoolean("notifications-autohide");
        this.maxHeight = loader.loadInt("notifications-max-height");
        this.compact = loader.loadBoolean("notifications-compact");
        this.removeShadow = loader.loadBoolean("notifications-remove-shadow");
        this.header = loader.loadBoolean("notifications-show-header");
        this.scrollStyle = StyledScroll.Options.fromLoader(loader, "notifications");
        // New settings
        this.swipeToDiscard = loader.loadBoolean("notifications-swipe-to-discard");
        this.position = loader.loadString("notifications-position");
        this.autoClearEnabled = loader.loadBoolean("notifications-auto-clear-enabled");
        this.autoClearRegex = loader.loadString("notifications-auto-clear-regex");
        this.maxWidth = loader.loadInt("notifications-max-width");
    }
    reload(key) {
        switch (key) {
            case "notifications-max-height":
                if (!this.enabled)
                    return;
                this.notificationWidget._updateMaxHeight();
                break;
            case "notifications-compact":
            case "notifications-remove-shadow":
                if (!this.enabled)
                    return;
                this.notificationWidget._updateStyleClass();
                break;
            case "notifications-fade-offset":
            case "notifications-show-scrollbar":
                if (!this.enabled)
                    return;
                this.notificationWidget._updateScrollStyle();
                break;
            case "notifications-show-header":
                if (!this.enabled || !this.notificationWidget)
                    return;
                this.notificationWidget._header.visible = this.header;
                break;
            default:
                super.reload();
                break;
        }
    }
    _onSourceAdded(source) {
        if (!source)
            return;
        const connectionId = source.connect("notification-added", (_, notification) => {
            if (this.autoClearEnabled && this.autoClearRegex) {
                const regex = new RegExp(this.autoClearRegex, 'i');
                const title = notification.title || "";
                const body = notification.body || "";
                if (regex.test(title) || regex.test(body)) {
                    notification.destroy();
                    return;
                }
            }
            this.notificationWidget._addNotification(notification);
        });
        this.maid.connectJob(source, connectionId);
    }
    onLoad() {
        if (!this.enabled)
            return;
        // Create Notification Box
        this.maid.destroyJob(this.notificationWidget = new NotificationWidget(this));

        if (this.position === "left") {
             this._setupLeftPane();
        } else {
             // Add to grid (Bottom)
             Global.QuickSettingsGrid.add_child(this.notificationWidget);
             Global.QuickSettingsGrid.layout_manager.child_set_property(Global.QuickSettingsGrid, this.notificationWidget, "column-span", 2);
        }

        if (this.swipeToDiscard) {
             Drag.applyTo(NotificationList);
             this._setupSwipeToDiscard();
        }
    }

    _setupLeftPane() {
        const menuBox = Global.QuickSettingsBox;
        const parent = menuBox.get_parent();
        if (!parent) return;

        this.wrapper = new St.BoxLayout({
            style_class: 'beqs-pane-container',
            vertical: false,
            x_expand: true,
        });

        this.leftPane = new St.BoxLayout({
            vertical: true,
            style_class: 'quick-settings-menu popup-menu-content',
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.START,
            style: `max-width: ${this.maxWidth}px;`,
        });
        this.leftPane.add_child(this.notificationWidget);

        // Sync visibility
        this.notificationWidget.bind_property("visible", this.leftPane, "visible", GObject.BindingFlags.SYNC_CREATE);

        parent.remove_child(menuBox);
        this.wrapper.add_child(this.leftPane);
        menuBox.y_align = Clutter.ActorAlign.START;
        this.wrapper.add_child(menuBox);
        parent.add_child(this.wrapper);

        this.maid.destroyJob(() => {
            if (this.wrapper && this.wrapper.get_parent()) {
                const p = this.wrapper.get_parent();
                this.wrapper.remove_child(menuBox);
                p.remove_child(this.wrapper);
                menuBox.y_align = Clutter.ActorAlign.FILL;
                p.add_child(menuBox);
            }
            this.wrapper = null;
            this.leftPane = null;
        });
    }

    _setupSwipeToDiscard() {
        const list = this.notificationWidget._list;
        list.dfunc_drag_start = (event) => {
            const child = list.get_child_at_pos(event.coords[0], event.coords[1]);
            if (child && child instanceof MessageList.Message) {
                list._draggedChild = child;
                list._dragStartCoords = event.coords;
            }
        };
        list.dfunc_drag_motion = (event) => {
            if (!list._draggedChild) return;
            const dx = event.coords[0] - list._dragStartCoords[0];
            list._draggedChild.translation_x = dx;
            list._draggedChild.opacity = Math.max(0, 255 - Math.abs(dx) / 2);
        };
        list.dfunc_drag_end = (event) => {
            if (!list._draggedChild) return;
            const dx = event.coords[0] - list._dragStartCoords[0];
            if (Math.abs(dx) > 100) {
                list._draggedChild.ease({
                    translation_x: dx > 0 ? 500 : -500,
                    opacity: 0,
                    duration: 200,
                    onComplete: () => {
                        list._draggedChild._message.destroy(); // Dismiss
                        list._draggedChild = null;
                    }
                });
            } else {
                list._draggedChild.ease({
                    translation_x: 0,
                    opacity: 255,
                    duration: 200
                });
                list._draggedChild = null;
            }
        };
    }

    onUnload() {
        this.notificationWidget = null;
    }
}
// #endregion NotificationsWidgetFeature
