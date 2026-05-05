import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Logger from "../shared/logger.js";

class CavaWidget extends St.BoxLayout {
    _init(params = {}) {
        const barsCount = params.bars || 40;
        const shape = params.shape || 'bars';
        const color = params.color || null;           // [r,g,b] or null
        const colorEnd = params.colorEnd || null;     // [r,g,b] for gradient end
        const gradientEnabled = params.gradientEnabled ?? false;
        const transparency = params.transparency ?? 200;
        const backgroundAlign = params.backgroundAlign || 'bottom'; // top/center/bottom
        const sensitivity = params.sensitivity ?? 100; // 1-300, cava sensitivity
        const marginBottom = params.marginBottom ?? 0; // bottom offset for background mode
        delete params.bars;
        delete params.shape;
        delete params.color;
        delete params.colorEnd;
        delete params.gradientEnabled;
        delete params.transparency;
        delete params.backgroundAlign;
        delete params.sensitivity;
        delete params.marginBottom;

        // Cava background is now always at the bottom, just pushed up to fit nicely
        let yAlign = Clutter.ActorAlign.END;
        let finalMarginTop = 0;
        let finalMarginBottom = 85;

        super._init({
            x_expand: true,
            y_expand: true,
            y_align: yAlign,
            height: 80, // Must have fixed height when y_align is not FILL, otherwise it collapses
            clip_to_allocation: true,
            margin_top: finalMarginTop,
            margin_bottom: finalMarginBottom,
            ...params,
        });

        this._barsCount = barsCount;
        this._bars = [];
        this._shape = shape;
        this._customColor = color;
        this._colorEnd = colorEnd;
        this._gradientEnabled = gradientEnabled;
        this._transparency = transparency;
        this._sensitivity = sensitivity;

        this.add_style_class_name('beQS-cava-widget');

        this._buildBars();

        this._cavaProc = null;
        this._cancellable = new Gio.Cancellable();
        this._configPath = GLib.build_filenamev([GLib.get_tmp_dir(), `beQS_cava_${GLib.uuid_string_random()}`]);

        this.connect('destroy', this._onDestroy.bind(this));

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this.get_stage()) {
                this._startCava();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _getColorForBar(index) {
        const alpha = Math.max(0, Math.min(1, this._transparency / 1000));
        const startColor = (this._customColor && this._customColor.length >= 3)
            ? this._customColor : [255, 255, 255];

        if (!this._gradientEnabled || !this._colorEnd || this._colorEnd.length < 3) {
            return `rgba(${startColor[0]}, ${startColor[1]}, ${startColor[2]}, ${alpha.toFixed(2)})`;
        }

        const t = this._barsCount > 1 ? index / (this._barsCount - 1) : 0;
        const r = Math.round(startColor[0] + (this._colorEnd[0] - startColor[0]) * t);
        const g = Math.round(startColor[1] + (this._colorEnd[1] - startColor[1]) * t);
        const b = Math.round(startColor[2] + (this._colorEnd[2] - startColor[2]) * t);
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }

    _getBarStyleForIndex(index) {
        const color = this._getColorForBar(index);
        switch (this._shape) {
        case 'wave':
            return `background-color: ${color}; border-radius: 50%; margin: 0 0px;`;
        case 'blocks':
            return `background-color: ${color}; border-radius: 0px; margin: 0 2px;`;
        case 'bars':
        default:
            return `background-color: ${color}; border-radius: 4px; margin: 0 1px;`;
        }
    }

    _buildBars() {
        for (const bar of this._bars) {
            bar.destroy();
        }
        this._bars = [];

        for (let i = 0; i < this._barsCount; i++) {
            let bar = new St.Widget({
                x_expand: true,
                y_expand: false,
                y_align: Clutter.ActorAlign.END,
                style_class: 'beQS-cava-bar',
                style: this._getBarStyleForIndex(i),
                height: 4,
            });
            this._bars.push(bar);
            this.add_child(bar);
        }
    }

    _startCava() {
        if (this._cavaProc) return;

        const configContent = `
[general]
framerate = 30
bars = ${this._barsCount}
sensitivity = ${this._sensitivity}
[input]
method = pulse
[output]
method = raw
raw_target = /dev/stdout
data_format = ascii
ascii_max_range = 100
`;
        try {
            GLib.file_set_contents(this._configPath, new TextEncoder().encode(configContent));

            this._cavaProc = new Gio.Subprocess({
                argv: ['cava', '-p', this._configPath],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            });
            this._cavaProc.init(null);

            const stdoutPipe = this._cavaProc.get_stdout_pipe();
            this._dataStream = new Gio.DataInputStream({
                base_stream: stdoutPipe,
                close_base_stream: true
            });

            this._readNextLine();
        } catch (e) {
            Logger.error(`Failed to start cava: ${e}`);
        }
    }

    _readNextLine() {
        if (!this._dataStream || this._cancellable.is_cancelled()) return;

        this._dataStream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
            if (this._cancellable.is_cancelled()) return;

            try {
                const result = stream.read_line_finish_utf8(res);
                let line = null;
                if (result !== null) {
                    if (Array.isArray(result)) line = result[0];
                    else if (typeof result === 'string') line = result;
                    else line = result?.toString?.() ?? null;
                }

                if (line !== null && line !== '') {
                    this._updateBars(line);
                    this._readNextLine();
                } else if (line === null) {
                    Logger.debug("Cava stream ended.");
                } else {
                    this._readNextLine();
                }
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    Logger.error(`Error reading cava output: ${e}`);
                }
            }
        });
    }

    _updateBars(line) {
        if (!this.mapped) return;

        const values = line.split(';').filter(v => v.trim() !== '');
        if (values.length < 1) return;

        const allocBox = this.get_allocation_box();
        const maxHeight = allocBox ? allocBox.get_height() : 100;

        const count = Math.min(values.length, this._barsCount);
        for (let i = 0; i < count; i++) {
            const val = parseInt(values[i], 10) || 0;
            const targetHeight = Math.max(4, (val / 100) * maxHeight * 0.7);

            this._bars[i].ease({
                height: targetHeight,
                duration: 60,
                mode: Clutter.AnimationMode.LINEAR
            });
        }
    }

    setColor(color) {
        this._customColor = color || null;
        this._rebuildBarStyles();
    }

    setColorEnd(color) {
        this._colorEnd = color || null;
        this._rebuildBarStyles();
    }

    setGradientEnabled(enabled) {
        this._gradientEnabled = enabled;
        this._rebuildBarStyles();
    }

    setSensitivity(sensitivity) {
        this._sensitivity = sensitivity ?? 100;
        // Sensitivity requires restarting cava with new config
        if (this._cavaProc) {
            this._cavaProc.force_exit();
            this._cavaProc = null;
        }
        if (this._dataStream) {
            try { this._dataStream.close_async(0, null, null); } catch (_e) {}
            this._dataStream = null;
        }
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this.get_stage() && !this.is_destroyed?.()) {
                this._startCava();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    setShape(shape) {
        this._shape = shape || 'bars';
        this._rebuildBarStyles();
    }

    setTransparency(transparency) {
        this._transparency = transparency ?? 200;
        this._rebuildBarStyles();
    }

    _rebuildBarStyles() {
        for (let i = 0; i < this._bars.length; i++) {
            this._bars[i].style = this._getBarStyleForIndex(i);
        }
    }

    _onDestroy() {
        this._cancellable.cancel();

        if (this._cavaProc) {
            this._cavaProc.force_exit();
            this._cavaProc = null;
        }

        if (this._dataStream) {
            try {
                this._dataStream.close_async(GLib.PRIORITY_DEFAULT, null, null);
            } catch (e) {}
            this._dataStream = null;
        }

        try {
            let file = Gio.File.new_for_path(this._configPath);
            file.delete(null);
        } catch (e) { }
    }

    vfunc_get_preferred_height(for_width) {
        return super.vfunc_get_preferred_height(for_width).map(Math.floor);
    }
}

export const Cava = GObject.registerClass(CavaWidget);
