import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import Config from "../config.js";
import {
  SwitchRow,
  AdjustmentRow,
  Group,
  fixPageScrollIssue,
  RgbColorRow,
  DropdownRow,
  EntryRow,
  Dialog,
  ButtonRow,
  Row,
  Button,
} from "../libs/prefs/components.js";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";


function SliderCustomizes({ settings, baseName, sensitiveBind }) {
  const handleRadius = AdjustmentRow({
    settings,
    max: 1000,
    title: _("Handle radius"),
    subtitle: _("Set this to 0 to use default radius"),
    bind: baseName + "-handle-radius",
    sensitiveBind,
  });
  const handleColor = RgbColorRow({
    settings,
    title: _("Handle color"),
    bind: baseName + "-handle-color",
    sensitiveBind,
    useAlpha: true,
  });
  const updateHandleOptionVisible = () => {
    const value = settings.get_string(baseName + "-style");
    handleRadius.visible = handleColor.visible = value != "slim";
  };
  const updateHandleOptionVisibleConnection = settings.connect(
    `changed::${baseName}-style`,
    updateHandleOptionVisible,
  );
  updateHandleOptionVisible();
  handleColor.child.connect("destroy", () => {
    settings.disconnect(updateHandleOptionVisibleConnection);
  });


  return [
    DropdownRow({
      settings,
      title: _("Slider style"),
      bind: baseName + "-style",
      items: [
        { name: _("Slim"), value: "slim" },
        { name: _("Default"), value: "default" },
      ],
      sensitiveBind,
    }),
    handleRadius,
    handleColor,
    RgbColorRow({
      settings,
      title: _("Background color"),
      bind: baseName + "-background-color",
      sensitiveBind,
      useAlpha: true,
    }),
    RgbColorRow({
      settings,
      title: _("Active Background color"),
      bind: baseName + "-active-background-color",
      sensitiveBind,
      useAlpha: true,
    }),
    AdjustmentRow({
      settings,
      title: _("Thickness"),
      max: 1000,
      bind: baseName + "-height",
      sensitiveBind,
      subtitle: _("Set this to 0 to use default thickness"),
    }),
  ];
}


// ─── Detectar servidor de audio activo ───────────────────────────────────────
function detectAudioServer() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = Gio.Subprocess.new(
        ["pactl", "info"],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
      );
    } catch (e) {
      resolve(_("Audio server: not detected (pactl unavailable)"));
      return;
    }


    proc.communicate_utf8_async(null, null, (_proc, result) => {
      try {
        const [, stdout] = _proc.communicate_utf8_finish(result);
        const lines = (stdout ?? "").split("\n");


        let serverValue = null;
        for (const line of lines) {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;


          const value = line.slice(colonIdx + 1).trim();
          if (
            value.toLowerCase().includes("pipewire") ||
            value.toLowerCase().includes("pulseaudio")
          ) {
            serverValue = value;
            break;
          }
        }


        if (!serverValue) {
          resolve(_("Audio server: unknown"));
          return;
        }


        const pw = serverValue.match(/PipeWire\s+([\d.]+)/i);
        if (pw) {
          resolve(`🎵 PipeWire ${pw[1]}`);
          return;
        }


        const pa = serverValue.match(/PulseAudio\s+([\d.]+)/i);
        if (pa) {
          resolve(`🔊 PulseAudio ${pa[1]}`);
          return;
        }


        resolve(`🔊 ${serverValue}`);
      } catch (e) {
        resolve(_("Audio server: detection failed"));
      }
    });
  });
}


// ─── Manage Audio Devices Dialog ─────────────────────────────────────────────
function openManageDevicesDialog(window, settings) {
  const dialog = new Adw.Window({
    title: _("Manage Audio Devices"),
    modal: true,
    transient_for: window,
    default_width: 520,
    default_height: 560,
    resizable: false,
  });


  const toolbarView = new Adw.ToolbarView();
  dialog.set_content(toolbarView);


  const headerBar = new Adw.HeaderBar();
  toolbarView.add_top_bar(headerBar);


  const viewStack = new Adw.ViewStack();
  toolbarView.set_content(viewStack);


  const switcher = new Adw.ViewSwitcher({
    stack: viewStack,
    policy: Adw.ViewSwitcherPolicy.WIDE,
  });
  headerBar.set_title_widget(switcher);


  // Listas iniciales desde GSettings (displayName originales)
  const allOutputDevices = settings.get_strv("volume-mixer-available-outputs");
  const allInputDevices = settings.get_strv("volume-mixer-available-inputs");


  function buildPage(pageId, pageTitle, pageIcon, groupTitle, groupSubtitle) {
    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });
    const clamp = new Adw.Clamp({ maximum_size: 700 });
    scrolled.set_child(clamp);


    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      margin_top: 24,
      margin_bottom: 24,
      margin_start: 12,
      margin_end: 12,
      spacing: 0,
    });
    clamp.set_child(box);


    const prefsGroup = new Adw.PreferencesGroup({
      title: groupTitle,
      description: groupSubtitle,
    });
    box.append(prefsGroup);


    viewStack.add_titled_with_icon(scrolled, pageId, pageTitle, pageIcon);


    return prefsGroup;
  }


  const outputsGroup = buildPage(
    "outputs",
    _("Outputs"),
    "audio-speakers-symbolic",
    _("Output Audio Devices"),
    _(
      "Choose which output devices should be visible in the Quick Settings panel",
    ),
  );
  const inputsGroup = buildPage(
    "inputs",
    _("Inputs"),
    "audio-input-microphone-symbolic",
    _("Input Audio Devices"),
    _(
      "Choose which input devices should be visible in the Quick Settings panel",
    ),
  );


  function populateGroup(group, devices) {
    if (!devices || devices.length === 0) {
      group.add(new Adw.ActionRow({ title: _("No devices found") }));
      return;
    }


    for (const deviceId of devices) {
      const defaultName = deviceId;


      // Estado actual en GSettings para esta fila
      const hiddenList = settings.get_strv("volume-mixer-hide-devices");
      const namesVariant = settings.get_value("volume-mixer-custom-names");
      const namesMap = namesVariant?.recursiveUnpack?.() ?? {};


      const row = new Adw.ActionRow({
        title: namesMap[deviceId] || defaultName,
        subtitle: deviceId,
      });


      // Rename entry
      const nameEntry = new Gtk.Entry({
        text: namesMap[deviceId] ?? "",
        placeholder_text: defaultName,
        valign: Gtk.Align.CENTER,
        width_chars: 14,
        margin_end: 6,
      });


      const applyName = () => {
        const newNames =
          settings.get_value("volume-mixer-custom-names").recursiveUnpack() ??
          {};
        const v = nameEntry.get_text().trim();


        if (v) newNames[deviceId] = v;
        else delete newNames[deviceId];


        settings.set_value(
          "volume-mixer-custom-names",
          new GLib.Variant("a{ss}", newNames),
        );
        row.title = v || defaultName;
      };


      nameEntry.connect("activate", applyName);
      const focusCtrl = new Gtk.EventControllerFocus();
      focusCtrl.connect("leave", applyName);
      nameEntry.add_controller(focusCtrl);
      row.add_suffix(nameEntry);


      // Visibility toggle
      const toggle = new Gtk.Switch({
        active: !hiddenList.includes(deviceId),
        valign: Gtk.Align.CENTER,
      });


      toggle.connect("notify::active", () => {
        let current = settings.get_strv("volume-mixer-hide-devices");


        if (toggle.active) current = current.filter((x) => x !== deviceId);
        else if (!current.includes(deviceId)) current.push(deviceId);


        settings.set_strv("volume-mixer-hide-devices", current);
      });


      row.add_suffix(toggle);
      row.set_activatable_widget(toggle);


      group.add(row);
    }
  }


  populateGroup(outputsGroup, allOutputDevices);
  populateGroup(inputsGroup, allInputDevices);


  // Footer: servidor de audio
  const footerBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.CENTER,
    margin_top: 6,
    margin_bottom: 6,
    spacing: 6,
  });
  const serverLabel = new Gtk.Label({
    label: _("Detecting audio server…"),
    css_classes: ["dim-label", "caption"],
  });
  footerBox.append(serverLabel);
  toolbarView.add_bottom_bar(footerBox);


  detectAudioServer().then((label) => {
    serverLabel.label = label;
  });


  dialog.present();
}


export const WidgetsPage = GObject.registerClass(
  {
    GTypeName: Config.baseGTypeName + "WidgetsPage",
  },
  class WidgetsPage extends Adw.PreferencesPage {
    constructor(settings, _prefs, window) {
      super({
        name: "Widgets",
        title: _("Widgets"),
        iconName: "window-new-symbolic",
      });


      fixPageScrollIssue(this);


      // Media
      Group(
        {
          parent: this,
          title: _("Media Widget"),
          headerSuffix: SwitchRow({
            settings,
            bind: "media-enabled",
          }),
          description: _(
            "Turn on to make the media widget visible on the Quick Settings panel",
          ),
        },
        [
          SwitchRow({
            settings,
            title: _("Show widget title"),
            subtitle: _("Show the 'Media' title above the widget"),
            bind: "media-show-header",
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Use iTunes covers (Experimental)"),
            subtitle: _(
              "Download high resolution album art from iTunes\n" +
                "Note: This feature is experimental and may not always work correctly",
            ),
            bind: "media-use-itunes-cover",
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Compact mode"),
            subtitle: _(
              "Make Media Controls widget smaller\n" +
                "Make it more similar in size to the notification message",
            ),
            bind: "media-compact",
            sensitiveBind: "media-enabled",
          }),
          AdjustmentRow({
            settings,
            title: _("Control buttons opacity"),
            subtitle: _(
              "Set this to 255 to make opaque, and 0 to make transparent",
            ),
            max: 255,
            bind: "media-contorl-opacity",
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            bind: "media-contorl-show-next-button",
            title: _("Show next button"),
            subtitle: _("Add next control button next to description"),
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            bind: "media-contorl-show-prev-button",
            title: _("Show previous button"),
            subtitle: _("Add previous control button next to description"),
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            bind: "media-contorl-show-pause-button",
            title: _("Show pause button"),
            subtitle: _("Add pause control button next to description"),
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            bind: "media-progress-enabled",
            title: _("Show progress bar"),
            subtitle: _("Add progress bar under description"),
            experimental: true,
            sensitiveBind: "media-enabled",
            onDetailed: () => {
              Dialog({
                window,
                title: _("Media Widget"),
                childrenRequest: () => [
                  Group(
                    {
                      title: _("Show progress bar"),
                      description: _("Add progress bar under description"),
                      header_suffix: SwitchRow({
                        settings,
                        bind: "media-progress-enabled",
                      }),
                    },
                    SliderCustomizes({
                      settings,
                      baseName: "media-progress",
                      sensitiveBind: "media-progress-enabled",
                    }),
                  ),
                ],
              });
            },
          }),
          SwitchRow({
            settings,
            bind: "media-gradient-enabled",
            title: _("Gradient background"),
            subtitle: _(
              "Use gradient background extracted from cover image\n" +
                "May affect performance slightly",
            ),
            sensitiveBind: "media-enabled",
            experimental: true,
            onDetailed: () => {
              Dialog({
                window,
                title: _("Media Widget"),
                childrenRequest: () => [
                  Group(
                    {
                      title: _("Gradient background"),
                      header_suffix: SwitchRow({
                        settings,
                        bind: "media-gradient-enabled",
                      }),
                      description: _(
                        "Use gradient background extracted from cover image\n" +
                          "May affect performance slightly",
                      ),
                    },
                    [
                      RgbColorRow({
                        settings,
                        title: _("Background color"),
                        subtitle: _("Base background color"),
                        bind: "media-gradient-background-color",
                        sensitiveBind: "media-gradient-enabled",
                      }),
                      AdjustmentRow({
                        settings,
                        max: 1000,
                        sensitiveBind: "media-gradient-enabled",
                        title: _("Start opacity"),
                        subtitle: _(
                          "Adjust left side transparency, set 1000 for opaque",
                        ),
                        bind: "media-gradient-start-opaque",
                      }),
                      AdjustmentRow({
                        settings,
                        max: 1000,
                        sensitiveBind: "media-gradient-enabled",
                        title: _("Start color"),
                        subtitle: _(
                          "Adjust left side mixing, set 1000 to show extracted color",
                        ),
                        bind: "media-gradient-start-mix",
                      }),
                      AdjustmentRow({
                        settings,
                        max: 1000,
                        sensitiveBind: "media-gradient-enabled",
                        title: _("End opacity"),
                        subtitle: _(
                          "Adjust right side transparency, set 1000 for opaque",
                        ),
                        bind: "media-gradient-end-opaque",
                      }),
                      AdjustmentRow({
                        settings,
                        max: 1000,
                        sensitiveBind: "media-gradient-enabled",
                        title: _("End color"),
                        subtitle: _(
                          "Adjust right side mixing, set 1000 to show extracted color",
                        ),
                        bind: "media-gradient-end-mix",
                      }),
                    ],
                  ),
                ],
              });
            },
          }),
          SwitchRow({
            settings,
            bind: "media-scroll-title",
            title: _("Scroll long titles"),
            subtitle: _(
              "Marquee-scroll the track title when it is too long to fit",
            ),
            sensitiveBind: "media-enabled",
          }),
          DropdownRow({
            settings,
            bind: "media-cover-aspect-ratio",
            title: _("Cover aspect ratio"),
            subtitle: _(
              "Choose how the cover image is scaled inside its frame",
            ),
            items: [
              { name: _("Fill (stretch)"), value: "fill" },
              { name: _("Fit (preserve ratio)"), value: "fit" },
              { name: _("Zoom (crop to fill)"), value: "zoom" },
            ],
            sensitiveBind: "media-enabled",
          }),
          SwitchRow({
            settings,
            bind: "media-cava-enabled",
            title: _("Audio visualization (CAVA)"),
            subtitle: _("Show audio spectrum background in the media widget"),
            sensitiveBind: "media-enabled",
            experimental: true,
            onDetailed: () => {
              Dialog({
                window,
                title: _("Media Widget"),
                childrenRequest: () => [
                  Group(
                    {
                      title: _("Audio visualization (CAVA)"),
                      description: _(
                        "Show audio spectrum background in the media widget\n" +
                          "Requires cava to be installed",
                      ),
                      header_suffix: SwitchRow({
                        settings,
                        bind: "media-cava-enabled",
                      }),
                    },
                    [
                      DropdownRow({
                        settings,
                        title: _("Shape"),
                        subtitle: _("Choose the shape of the visualizer bars"),
                        items: [
                          { name: _("Bars"), value: "bars" },
                          { name: _("Wave"), value: "wave" },
                          { name: _("Blocks"), value: "blocks" },
                        ],
                        bind: "media-cava-shape",
                        sensitiveBind: "media-cava-enabled",
                      }),
                      RgbColorRow({
                        settings,
                        title: _("Color"),
                        subtitle: _(
                          "Custom color for the visualizer bars (empty for auto)",
                        ),
                        bind: "media-cava-color",
                        sensitiveBind: "media-cava-enabled",
                      }),
                      AdjustmentRow({
                        settings,
                        title: _("Transparency"),
                        subtitle: _(
                          "Adjust bar transparency. 0 = invisible, 1000 = fully opaque",
                        ),
                        max: 1000,
                        bind: "media-cava-transparency",
                        sensitiveBind: "media-cava-enabled",
                      }),
                      DropdownRow({
                        settings,
                        title: _("Position"),
                        subtitle: _("Choose where cava should be displayed"),
                        items: [
                          { name: _("Background"), value: "background" },
                          { name: _("Top"), value: "top" },
                          { name: _("Bottom"), value: "bottom" },
                        ],
                        bind: "media-cava-position",
                        sensitiveBind: "media-cava-enabled",
                      }),
                      SwitchRow({
                        settings,
                        title: _("Gradient"),
                        subtitle: _("Enable gradient color across bars"),
                        bind: "media-cava-gradient-enabled",
                        sensitiveBind: "media-cava-enabled",
                      }),
                      RgbColorRow({
                        settings,
                        title: _("Gradient end color"),
                        subtitle: _(
                          "End color for gradient (start is the main color)",
                        ),
                        bind: "media-cava-color-end",
                        sensitiveBind: "media-cava-gradient-enabled",
                      }),
                      AdjustmentRow({
                        settings,
                        title: _("Sensitivity"),
                        subtitle: _(
                          "Adjust cava audio sensitivity. Default is 100.",
                        ),
                        max: 300,
                        min: 1,
                        bind: "media-cava-sensitivity",
                        sensitiveBind: "media-cava-enabled",
                      }),
                    ],
                  ),
                ],
              });
            },
          }),
        ],
      );


      // Notifications
      Group(
        {
          parent: this,
          title: _("Notifications Widget"),
          headerSuffix: SwitchRow({ settings, bind: "notifications-enabled" }),
          description: _(
            "Turn on to make the notifications widget visible on the Quick Settings panel",
          ),
        },
        [
          SwitchRow({
            settings,
            title: _("Show widget title"),
            subtitle: _("Show the 'Notifications' title above the widget"),
            bind: "notifications-show-header",
            sensitiveBind: "notifications-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Compact mode"),
            subtitle: _("Make notifications smaller"),
            bind: "notifications-compact",
            sensitiveBind: "notifications-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Auto hide"),
            subtitle: _(
              "Hide the Notifications widget when there are no notifications",
            ),
            bind: "notifications-autohide",
            sensitiveBind: "notifications-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Use native controls"),
            subtitle: _("Use native dnd switch and clear button"),
            bind: "notifications-use-native-controls",
            sensitiveBind: "notifications-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Show scrollbar"),
            subtitle: _("Show scrollbar on message list"),
            bind: "notifications-show-scrollbar",
            sensitiveBind: "notifications-enabled",
          }),
        ],
      );


      // Weather
      Group(
        {
          parent: this,
          title: _("Weather Widget"),
          headerSuffix: SwitchRow({ settings, bind: "weather-enabled" }),
          description: _(
            "Turn on to make the weather widget visible on the Quick Settings panel",
          ),
        },
        [
          SwitchRow({
            settings,
            title: _("Show widget title"),
            subtitle: _("Show the 'Weather' title above the widget"),
            bind: "weather-show-header",
            sensitiveBind: "weather-enabled",
          }),
          EntryRow({
            settings,
            title: _("Click command"),
            bind: "weather-click-command",
            sensitiveBind: "weather-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Show location"),
            subtitle: _("Show the location label on header"),
            bind: "weather-show-location",
            sensitiveBind: "weather-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Daily forecast"),
            subtitle: _("Show daily forecast instead of hourly"),
            bind: "weather-daily-forecast",
            sensitiveBind: "weather-enabled",
          }),
          AdjustmentRow({
            settings,
            max: 1024,
            min: 1,
            bind: "weather-interval-hour",
            title: _("Forecast interval"),
            subtitle: _("Adjust forecast interval in hours"),
          }),
          AdjustmentRow({
            settings,
            max: 12,
            min: 0,
            bind: "weather-max-forecasts",
            title: _("Max forecasts"),
            subtitle: _("Adjust max forecasts"),
          }),
        ],
      );


      // Volume mixer
      Group(
        {
          parent: this,
          title: _("Volume mixer Widget"),
          headerSuffix: SwitchRow({ settings, bind: "volume-mixer-enabled" }),
          description: _(
            "Turn on to make the volume mixer widget visible on the Quick Settings panel",
          ),
        },
        [
          SwitchRow({
            settings,
            title: _("Show widget title"),
            subtitle: _("Show the 'Volume mixer' title above the widget"),
            bind: "volume-mixer-show-header",
            sensitiveBind: "volume-mixer-enabled",
          }),
          SwitchRow({
            settings,
            title: _("Attach to output slider"),
            subtitle: _(
              "Show volume mixer in output slider menu instead of a separate widget",
            ),
            bind: "volume-mixer-menu-enabled",
            sensitiveBind: "volume-mixer-enabled",
            onDetailed: () => {
              Dialog({
                window,
                title: _("Volume Mixer Widget"),
                childrenRequest: () => [
                  Group(
                    {
                      title: _("Attach to output slider"),
                      description: _(
                        "Show volume mixer in output slider menu instead of a separate widget",
                      ),
                      header_suffix: SwitchRow({
                        settings,
                        bind: "volume-mixer-menu-enabled",
                      }),
                    },
                    [
                      EntryRow({
                        settings,
                        title: _("Menu Icon"),
                        subtitle: _("Icon to show on output slider button"),
                        bind: "volume-mixer-menu-icon",
                        sensitiveBind: "volume-mixer-menu-enabled",
                      }),
                    ],
                  ),
                ],
              });
            },
          }),

          SwitchRow({
            settings,
            title: _("Show scrollbar"),
            subtitle: _("Show scrollbar on mixer list"),
            bind: "volume-mixer-show-scrollbar",
            sensitiveBind: "volume-mixer-enabled",
          }),
          // Eliminado: opción para ocultar icono, icono siempre visible
          ButtonRow({
            settings,
            title: _("Manage Devices"),
            subtitle: _("Hide, unhide or rename audio devices"),
            text: _("Manage"),
            sensitiveBind: "volume-mixer-enabled",
            action: () => openManageDevicesDialog(window, settings),
          }),
        ],
      );
    }
  },
);