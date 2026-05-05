import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GdkPixbuf from "gi://GdkPixbuf";
import Shell from "gi://Shell";
// @ts-expect-error
import Soup from "gi://Soup";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageList from "resource:///org/gnome/shell/ui/messageList.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { loadInterfaceXML } from "resource:///org/gnome/shell/misc/fileUtils.js";
import { Slider } from "resource:///org/gnome/shell/ui/slider.js";
import { PageIndicators } from "resource:///org/gnome/shell/ui/pageIndicators.js";
import { FeatureBase } from "../../libs/shell/feature.js";
import { getImageMeanColor } from "../../libs/shared/imageUtils.js";
import { lerp } from "../../libs/shared/jsUtils.js";
import { Drag, Scroll } from "../../libs/shell/gesture.js";
import { StyledSlider } from "../../libs/shell/styler.js";
import { Cava } from "../../libs/shell/cava.js";
import Global from "../../global.js";
import Logger from "../../libs/shared/logger.js";

// Promisify Soup only for gradient background (remote cover color extraction)
try {
    Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish");
} catch (_e) { /* already promisified */ }

// Temporary cover storage directory
const COVER_DIR = GLib.get_user_cache_dir() + "/beqs/covers";

// ─── Network helpers using curl via Gio.Subprocess ───────────────────────────
//
//  Soup.Session async/await is unreliable inside GNOME Shell extensions because
//  the GJS promise micro-task loop does not always run between main-loop ticks.
//  Using Gio.Subprocess + curl avoids this entirely: the OS handles the network
//  call in a child process and the callback fires on the main loop normally.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return its body as a string.
 * @param {string} url
 * @param {number} [timeout=10]  seconds
 * @returns {Promise<string>}
 */
function curlText(url, timeout = 10) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ["curl", "-s", "-L", "--max-time", String(timeout), url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            reject(new Error(`curl spawn failed: ${e}`));
            return;
        }
        proc.communicate_utf8_async(null, null, (_proc, result) => {
            try {
                const [, stdout] = _proc.communicate_utf8_finish(result);
                resolve(stdout ?? "");
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Download a URL to a local file path.
 * @param {string} url
 * @param {string} destPath  absolute path
 * @param {number} [timeout=30]  seconds
 * @returns {Promise<void>}
 */
function curlDownload(url, destPath, timeout = 30) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ["curl", "-s", "-L", "--max-time", String(timeout), "-o", destPath, url],
                Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            reject(new Error(`curl spawn failed: ${e}`));
            return;
        }
        proc.wait_async(null, (_proc, result) => {
            try {
                _proc.wait_finish(result);
                const st = _proc.get_exit_status();
                if (st === 0) resolve();
                else          reject(new Error(`curl exit ${st}`));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Create directory (and parents) if it does not exist. */
function ensureDir(path) {
    const dir = Gio.File.new_for_path(path);
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
}

// #region MarqueeLabel
class MarqueeLabel extends St.ScrollView {
    _init(params = {}) {
        super._init({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: false,
            clip_to_allocation: true,
            ...params,
        });

        this.label = new St.Label({ style_class: params.style_class || "", x_expand: true });
        this.set_child(this.label);

        this._scrolling = false;
        this._scrollId  = 0;
        this._enabled   = true;

        this.connect("destroy", () => this._stop());
        this.label.connect("notify::text", () => this._onTextChanged());
        this.connect("notify::mapped", () => { if (!this.mapped) this._stop(); else this._restartDeferred(); });
        this.connect("notify::width",  () => { if (this.mapped && this._enabled) this._restartDeferred(); });
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) this._stop();
        else if (this.mapped) this._restartDeferred();
    }

    _onTextChanged() {
        this._stop();
        if (this.mapped && this._enabled) this._restartDeferred();
    }

    _restartDeferred() {
        this._stop();
        if (this._idleId) { GLib.source_remove(this._idleId); this._idleId = 0; }
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this.mapped && this._enabled) this._start();
            this._idleId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _start() {
        if (this._scrolling) return;
        const adj = this.get_hscroll_bar()?.get_adjustment();
        if (!adj) return;
        const max = adj.get_upper() - adj.get_page_size();
        if (max <= 0) return;

        this._scrolling = true;
        let pos = 0, dir = 1;
        this._scrollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            pos += 0.5 * dir;
            if (pos >= max + 20) { dir = -1; return GLib.SOURCE_CONTINUE; }
            if (pos <= -20)      { dir =  1; return GLib.SOURCE_CONTINUE; }
            adj.set_value(Math.max(0, Math.min(max, pos)));
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stop() {
        this._scrolling = false;
        if (this._scrollId) { GLib.source_remove(this._scrollId); this._scrollId = 0; }
        if (this._idleId) { GLib.source_remove(this._idleId); this._idleId = 0; }
        const adj = this.get_hscroll_bar()?.get_adjustment?.();
        if (adj) adj.set_value(0);
    }

    set text(v) { this.label.text = v ?? ""; }
    get text()  { return this.label.text; }
}
GObject.registerClass(MarqueeLabel);
// #endregion MarqueeLabel

// #region Player
class Player extends GObject.Object {
    _init(busName, options) {
        super._init();
        this._busName = busName;
        this._options = options;
        this.source   = new MessageList.Source();

        const propertiesIface = Global.GetDbusInterface("media/dbus.xml", "org.freedesktop.DBus.Properties");
        const propertiesPromise = Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, propertiesIface,
            busName, "/org/mpris/MediaPlayer2", propertiesIface.name, null
        ).then(p => this._propertiesProxy = p).catch(Logger.error);

        const playerIface = Global.GetDbusInterface("media/dbus.xml", "org.mpris.MediaPlayer2.Player");
        const playerPromise = Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, playerIface,
            busName, "/org/mpris/MediaPlayer2", playerIface.name, null
        ).then(p => this._playerProxy = p).catch(Logger.error);

        const mprisIface = Global.GetDbusInterface("media/dbus.xml", "org.mpris.MediaPlayer2");
        const mprisPromise = Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, mprisIface,
            busName, "/org/mpris/MediaPlayer2", mprisIface.name, null
        ).then(p => this._mprisProxy = p).catch(Logger.error);

        Promise.all([playerPromise, propertiesPromise, mprisPromise])
            .then(this._ready.bind(this))
            .catch(Logger.error);
    }

    get position() {
        if (!this._propertiesProxy) return Promise.resolve(null);
        return this._propertiesProxy.GetAsync("org.mpris.MediaPlayer2.Player", "Position")
            .then(r => r[0].get_int64()).catch(() => null);
    }

    set position(value) {
        if (!this._playerProxy || !this._trackId || !this._length) return;
        this._playerProxy.SetPositionAsync(
            this._trackId, Math.min(this._length, Math.max(1, value))
        ).catch(Logger.error);
    }

    get busName()       { return this._busName; }
    get trackId()       { return this._trackId; }
    get length()        { return this._length; }
    get trackArtists()  { return this._trackArtists; }
    get trackTitle()    { return this._trackTitle; }
    get trackCoverUrl() { return this._trackCoverUrl; }
    get app()           { return this._app; }
    get canGoNext()     { return this._playerProxy?.CanGoNext     ?? false; }
    get canGoPrevious() { return this._playerProxy?.CanGoPrevious ?? false; }
    get status()        { return this._playerProxy?.PlaybackStatus ?? "Stopped"; }

    _parseMetadata(metadata) {
        if (!metadata) {
            this._trackId = null;
            this._length = null;
            this._trackArtists = null;
            this._trackTitle = _("Unknown title");
            this._trackCoverUrl = null;
            return;
        }

        // Logger.debug(`[beQS] Media: Metadata keys: ${Object.keys(metadata).join(", ")}`);
        
        const oldTrackId = this._trackId;
        this._trackId       = metadata["mpris:trackid"]?.get_string?.()[0] ?? null;
        this._length        = metadata["mpris:length"]?.deepUnpack?.()     ?? null;

        this._trackArtists  = metadata["xesam:artist"]?.deepUnpack?.();
        if (typeof this._trackArtists === "string") {
            this._trackArtists = [this._trackArtists];
        } else if (!Array.isArray(this._trackArtists)
            || !this._trackArtists.every(a => typeof a === "string")) {
            this._trackArtists = [_("Unknown artist")];
        }

        this._trackTitle = metadata["xesam:title"]?.deepUnpack?.();
        if (typeof this._trackTitle !== "string") this._trackTitle = _("Unknown title");

        const mprisArtUrl = metadata["mpris:artUrl"]?.deepUnpack?.();
        // Exclusive cover selection
        if (this._options?.useItunesCover) {
            // iTunes is active: clear system cover to avoid flicker. 
            // The cover will be set by _fetchItunesCover once downloaded.
            if (this._trackId !== oldTrackId) {
                this._trackCoverUrl = null;
            }
        } else {
            // iTunes is disabled, use system/MPRIS cover
            if (typeof mprisArtUrl === "string") {
                this._trackCoverUrl = mprisArtUrl;
            } else {
                this._trackCoverUrl = null;
            }
        }

        if (this._mprisProxy?.DesktopEntry) {
            this._app = Shell.AppSystem.get_default()
                .lookup_app(`${this._mprisProxy.DesktopEntry}.desktop`);
        } else {
            this._app = null;
        }

        let title = this._app?.get_name() ?? this._mprisProxy?.Identity ?? _("Media Player");
        let icon = this._app?.get_icon() ?? null;

        this.source.set({
            title,
            icon,
        });

                const canPlay = !!this._playerProxy?.CanPlay;
        if (this.canPlay !== canPlay) { this.canPlay = canPlay; this.notify("can-play"); }
        this.canSeek = !!this._playerProxy?.CanSeek;
    }

    _update(proxy, changed) {
        // If only Position changed, skip the full update to avoid loops/spam
        if (changed && Object.keys(changed).length === 1 && changed.Position !== undefined)
            return;

        try {
            this._parseMetadata(this._playerProxy?.Metadata);
        } catch (e) {
            Logger.error(`[beQS] Media: Error parsing metadata: ${e}`);
        }
        this.emit("changed");

        if (this._options?.useItunesCover) {
            this._fetchItunesCover().catch(e => Logger.error(`[beQS] iTunes: Uncaught error: ${e}`));
        } else if (this._trackCoverUrl && this._trackCoverUrl.startsWith("http") && this._options?.gradientEnabled) {
             // If using system cover and it's remote, we might need to emit changed 
             // once it's available, but MPRIS usually handles this.
        }
    }

// ─── REPLACEMENT for _fetchItunesCover() in features/widget/media.js ──────────
//
//  Bugs fixed:
//   1. `searchTerm` was used but never defined
//   2. `trackKey`   was used but never defined
//   3. `imgUri`     was used but never defined (Soup Message)
//   4. Used Soup async which is unreliable inside GNOME Shell → replaced with
//      the curlText / curlDownload helpers already defined at the top of the file
//   5. `this._sync()` does not exist → replaced with this.emit("changed")
//   6. Missing early-return guard when the same track was already fetched
// ─────────────────────────────────────────────────────────────────────────────

    async _fetchItunesCover() {
        if (this._fetchingItunes) return;

        let artist = this._trackArtists ? this._trackArtists[0] : "";
        let title  = this._trackTitle ?? "";

        if (artist === _("Unknown artist")) artist = "";
        if (title  === _("Unknown title"))  title  = "";

        // Clean common browser/player suffixes
        title = title.replace(/ \| YouTube Music$/i, "").trim();
        title = title.replace(/ - YouTube$/i,        "").trim();

        if (title.toLowerCase() === "youtube music" ||
            title.toLowerCase() === "spotify")
            return;

        // If artist is empty, try to extract from "Artist – Title" format
        if (!artist && title.includes(" - ")) {
            const parts = title.split(" - ");
            artist = parts[0].trim();
            title  = parts.slice(1).join(" - ").trim();
        }

        if (!title) {
            Logger.debug("[beQS] iTunes: Skipping – no valid title found.");
            return;
        }

        // ── Deduplication guard ──────────────────────────────────────────────
        const trackKey = `${artist}||${title}`;
        if (this._lastFetchedItunesTrack === trackKey) return;

        // ── Build search term ────────────────────────────────────────────────
        const rawSearch  = artist ? `${artist} ${title}` : title;
        let   cleanSearch = rawSearch.replace(/\(.*?\)|\[.*?\]/g, "").trim();
        if (cleanSearch.length < 3) cleanSearch = rawSearch;

        const term = encodeURIComponent(cleanSearch).replace(/%20/g, "+");
        const apiUrl = `https://itunes.apple.com/search?term=${term}&entity=album&limit=1`;

        this._fetchingItunes          = true;
        this._lastFetchedItunesTrack  = trackKey;

        try {
            Logger.debug(`[beQS] iTunes: Querying ${apiUrl}`);

            // ── Step 1: fetch JSON from iTunes Search API via curl ───────────
            const responseText = await curlText(apiUrl);
            if (!responseText) {
                Logger.debug("[beQS] iTunes: Empty response from API");
                return;
            }

            let json;
            try {
                json = JSON.parse(responseText);
            } catch (e) {
                Logger.error(`[beQS] iTunes: JSON parse error: ${e}. Preview: ${responseText.substring(0, 120)}`);
                return;
            }

            if (!json || !json.resultCount || !json.results[0]?.artworkUrl100) {
                Logger.debug("[beQS] iTunes: No results found");
                return;
            }

            // ── Step 2: build the high-res artwork URL ───────────────────────
            const artworkUrl100  = json.results[0].artworkUrl100;
            const artworkUrl1000 = artworkUrl100.replace(/\/\d+x\d+[a-z]*\.jpg$/i, "/1000x1000bb.jpg");
            Logger.debug(`[beQS] iTunes: Found artwork: ${artworkUrl1000}`);

            // ── Step 3: check local cache ────────────────────────────────────
            ensureDir(COVER_DIR);

            const md5       = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, artworkUrl1000, -1);
            const coverPath = GLib.build_filenamev([COVER_DIR, `${md5}.jpg`]);
            const coverFile = Gio.File.new_for_path(coverPath);

            if (coverFile.query_exists(null)) {
                Logger.debug(`[beQS] iTunes: Cache hit – ${coverPath}`);
                this._trackCoverUrl = `file://${coverPath}`;
                this.emit("changed");
                return;
            }

            // ── Step 4: download cover via curl ──────────────────────────────
            Logger.debug(`[beQS] iTunes: Downloading cover to ${coverPath}`);
            await curlDownload(artworkUrl1000, coverPath);

            if (!Gio.File.new_for_path(coverPath).query_exists(null)) {
                Logger.debug("[beQS] iTunes: Download finished but file not found");
                return;
            }

            this._trackCoverUrl = `file://${coverPath}`;
            Logger.debug("[beQS] iTunes: Success! Applying cover.");
            this.emit("changed");

        } catch (e) {
            Logger.error(`[beQS] iTunes: Error – ${e}`);
        } finally {
            this._fetchingItunes = false;
        }
    }

    previous()  { this._playerProxy?.PreviousAsync().catch(Logger.error); }
    next()      { this._playerProxy?.NextAsync().catch(Logger.error); }
    playPause() { this._playerProxy?.PlayPauseAsync().catch(Logger.error); }

    raise() {
        try {
            if (this._app) {
                const windows = this._app.get_windows?.() ?? [];
                if (windows.length > 0) { windows[0].activate(global.get_current_time?.() ?? 0); return; }
                this._app.activate(); return;
            }
        } catch (_e) {}

        if (this._mprisProxy?.CanRaise) { this._mprisProxy.RaiseAsync().catch(Logger.error); return; }

        try {
            const sys = Shell.AppSystem.get_default();
            const candidates = [];
            if (this._mprisProxy?.DesktopEntry)
                candidates.push(`${this._mprisProxy.DesktopEntry}.desktop`);
            if (this._mprisProxy?.Identity) {
                const id = String(this._mprisProxy.Identity).toLowerCase();
                if (id.includes("chrome"))  candidates.push("google-chrome.desktop", "chromium.desktop");
                if (id.includes("firefox")) candidates.push("firefox.desktop");
                if (id.includes("spotify")) candidates.push("spotify.desktop");
                if (id.includes("vlc"))     candidates.push("vlc.desktop");
            }
            for (const id of candidates) {
                const app = sys.lookup_app(id);
                if (!app) continue;
                const wins = app.get_windows?.() ?? [];
                if (wins.length > 0) { wins[0].activate(global.get_current_time?.() ?? 0); return; }
                try { app.activate(); return; } catch (_e) {}
                try { app.launch(0, null); return; } catch (_e) {}
            }
        } catch (_e) {}
    }

    isPlaying() { return this.status === "Playing"; }

    _ready() {
        if (!this._mprisProxy || !this._playerProxy) return;

        this._mprisProxy.connectObject("notify::g-name-owner", () => {
            if (!this._mprisProxy?.g_name_owner) this._close();
        }, this);

        if (!this._mprisProxy.g_name_owner) { this._close(); return; }
        this._playerProxy.connectObject("g-properties-changed", this._update.bind(this), this);
        this._update();
    }

    _close() {
        this._mprisProxy?.disconnectObject(this);
        this._playerProxy?.disconnectObject(this);
        this._mprisProxy = null; this._playerProxy = null; this._propertiesProxy = null;
    }
}
GObject.registerClass({
    Properties: {
        "can-play": GObject.ParamSpec.boolean("can-play", null, null, GObject.ParamFlags.READWRITE, false),
        "can-seek": GObject.ParamSpec.boolean("can-seek", null, null, GObject.ParamFlags.READWRITE, false),
    },
    Signals: { "changed": {} },
}, Player);
// #endregion Player

// #region Source
const DBusIface = loadInterfaceXML("org.freedesktop.DBus");
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);
const MPRIS_PLAYER_PREFIX = "org.mpris.MediaPlayer2.";

class Source extends GObject.Object {
    _init(options) {
        super._init();
        this._options = options;
        this._players = new Map();
    }

    start() {
        // @ts-expect-error
        this._proxy = new DBusProxy(
            Gio.DBus.session, "org.freedesktop.DBus", "/org/freedesktop/DBus",
            this._onProxyReady.bind(this)
        );
    }

    get players() { return [...this._players.values()]; }

    _addPlayer(busName) {
        if (this._players.has(busName)) return;
        const player = new Player(busName, this._options);
        this._players.set(busName, player);
        player.connectObject("notify::can-play", () => {
            if (player.canPlay) {
                if (player._removeTimeoutId) { GLib.source_remove(player._removeTimeoutId); player._removeTimeoutId = 0; }
                this.emit("player-added", player);
            } else if (!player._removeTimeoutId) {
                player._removeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    this.emit("player-removed", player);
                    player._removeTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
                GLib.Source.set_name_by_id(player._removeTimeoutId, "[beQS] Source._removeTimeoutId");
            }
        }, this);
        if (player.canPlay) this.emit("player-added", player);
    }

    async _onProxyReady() {
        const [names] = await this._proxy.ListNamesAsync();
        for (const name of names) {
            if (name.startsWith(MPRIS_PLAYER_PREFIX)) this._addPlayer(name);
        }
        // @ts-expect-error
        this._proxy.connectSignal("NameOwnerChanged", this._onNameOwnerChanged.bind(this));
    }

    _onNameOwnerChanged(_proxy, _sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX)) return;
        if (oldOwner) {
            const player = this._players.get(name);
            if (player) { this._players.delete(name); player.disconnectObject(this); this.emit("player-removed", player); }
        }
        if (newOwner) this._addPlayer(name);
    }

    destroy() {
        if (this._proxy) {
            this._proxy.disconnectSignal("NameOwnerChanged");
            this._proxy = null;
        }
        for (const player of this._players.values()) {
            if (player._removeTimeoutId) {
                GLib.source_remove(player._removeTimeoutId);
                player._removeTimeoutId = 0;
            }
            player._close();
        }
        this._players.clear();
    }
}
GObject.registerClass({
    Signals: {
        "player-added":   { param_types: [Player] },
        "player-removed": { param_types: [Player] },
    },
}, Source);
// #endregion Source

// #region ProgressControl
class ProgressControl extends St.BoxLayout {
    _init(player, options) {
        super._init({ x_expand: true, style_class: "beQS-progress-control" });
        this._player = player; this._positionTracker = null;
        this._dragging = false; this._shown = false; this._options = options;
        this._createLabels(); this._createSlider();
        this.add_child(this._positionLabel);
        this.add_child(this._slider);
        this.add_child(this._lengthLabel);
        this.connect("notify::mapped", this._updateTracker.bind(this));
        this.connect("destroy", this._dropTracker.bind(this));
        this._player.connectObject("changed", () => this._updateStatus(), this);
    }

    _createLabels() {
        this._positionLabel = new St.Label({ y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: "beQS-position-label" });
        this._lengthLabel   = new St.Label({ y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: "beQS-length-label" });
    }

    _createSlider() {
        const oldSlider = this._slider;
        const slider = this._slider ??= new Slider(0);
        slider.style = StyledSlider.getStyle(this._options.sliderStyle);
        if (oldSlider) return;
        slider.connectObject("drag-begin",      () => { this._dragging = true;  return Clutter.EVENT_PROPAGATE; }, this);
        slider.connectObject("drag-end",        () => { this._player.position = Math.floor(slider.value) * 1000000; this._dragging = false; return Clutter.EVENT_PROPAGATE; }, this);
        slider.connectObject("scroll-event",    () => Clutter.EVENT_STOP, this);
        slider.connectObject("notify::value",   () => { if (this._dragging) this._updatePosition(Math.floor(slider.value) * 1000000); }, this);
    }

    _updateStatus(noAnimate) {
        if (!this.mapped) return;
        this._shown = this._player.isPlaying();
        if (this._shown) this._trackPosition();
        const ph = this.height;
        this.height = -1;
        const height  = this._shown ? this.get_preferred_height(-1)[0] : 0;
        this.height   = ph;
        const opacity = this._shown ? 255 : 0;
        if (noAnimate) { this.remove_all_transitions(); this.height = height; this.opacity = opacity; return; }
        if (this._shown)
            this.ease({ height, duration: 150, onComplete: () => this.ease({ opacity, duration: 150 }) });
        else
            this.ease({ opacity, duration: 200, onComplete: () => this.ease({ height, duration: 150 }) });
    }

    _updatePosition(current) {
        const cs = Math.floor(current / 1000000);
        const ls = Math.floor((this._player.length ?? 0) / 1000000);
        this._positionLabel.text = this._formatSeconds(cs);
        this._lengthLabel.text   = this._formatSeconds(ls);
        this._slider.overdriveStart = this._slider.maximumValue = ls;
        this._slider.value = cs;
    }

    _trackPosition() {
        this._slider.reactive = this._player.canSeek;
        if (this._shown && !this._dragging)
            this._player.position.then(v => v !== null && this._updatePosition(v)).catch(Logger.error);
        return GLib.SOURCE_CONTINUE;
    }

    _dropTracker() {
        if (this._positionTracker === null) return;
        GLib.source_remove(this._positionTracker); this._positionTracker = null;
    }

    _createTracker() {
        this._positionTracker = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, this._trackPosition.bind(this));
        GLib.source_set_name_by_id(this._positionTracker, "[beQS] ProgressControl");
    }

    _updateTracker() {
        if (this.mapped) this._createTracker(); else this._dropTracker();
        this._updateStatus(true);
    }

    _formatSeconds(seconds) {
        const minutes = Math.floor(seconds / 60) % 60;
        const hours   = Math.floor(seconds / 3600) % 60;
        seconds %= 60;
        const sp = seconds.toString().padStart(2, "0");
        const mp = minutes.toString().padStart(2, "0");
        return hours > 0 ? `${hours}:${mp}:${sp}` : `${minutes}:${sp}`;
    }
}
GObject.registerClass(ProgressControl);
// #endregion ProgressControl

// #region MediaItem
class MediaItem extends MessageList.Message {
    constructor(player, options) {
        super(player.source);
        this.add_style_class_name("media-message");
        this._options = options;
        this._player  = player;

        if (options.progressEnabled) {
            try {
                const ctrl = new ProgressControl(player, options);
                this._progressControl = ctrl;
                if (this.child && typeof this.child.add_child === "function") this.child.add_child(ctrl);
                else this.add_child(ctrl);
            } catch (e) { Logger.debug(`MediaItem: progress control error: ${e}`); }
        }

        this._createControlButtons();
        this._player.connectObject("changed", this._update.bind(this), this);
        this._marqueeTitle       = null;
        this._titleActorResolved = false;
        this.connect("destroy", () => {
            if (this._marqueeIdleId) { GLib.source_remove(this._marqueeIdleId); this._marqueeIdleId = 0; }
            this._marqueeTitle = null;
            this._progressControl = null;
        });
        this._update();
        this._setupMarqueeDeferred();
    }

    _setupMarqueeDeferred() {
        if (this._marqueeIdleId) { GLib.source_remove(this._marqueeIdleId); this._marqueeIdleId = 0; }
        this._marqueeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._setupMarquee();
            this._marqueeIdleId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupMarquee() {
        try {
            if (!this._options.scrollTitle) { this._marqueeTitle?.setEnabled(false); return; }
            if (!this._titleActorResolved) {
                this._titleActorResolved = true;
                let titleLabel = null;
                const visit = a => {
                    if (!a || titleLabel) return;
                    if (a instanceof St.Label && a.style_class?.includes?.("message-title")) { titleLabel = a; return; }
                    if (a.get_children) for (const c of a.get_children()) visit(c);
                };
                visit(this);
                if (titleLabel?.get_parent && typeof titleLabel.get_parent().replace_child === "function") {
                    this._marqueeTitle = new MarqueeLabel({ style_class: titleLabel.style_class || "message-title", x_expand: true });
                    titleLabel.get_parent().replace_child(titleLabel, this._marqueeTitle);
                }
            }
            if (this._marqueeTitle) {
                this._marqueeTitle.text = this._player.trackTitle ?? "";
                this._marqueeTitle.setEnabled(true);
            }
        } catch (e) { Logger.debug(`MediaItem: marquee error: ${e}`); }
    }

    _applyCoverAspect() {
        try {
            const ratio = this._options.coverAspectRatio || "zoom";
            const icon  = this._iconBin?.child ?? this._iconBin ?? this._icon;
            if (!icon) return;
            if (icon._beqsAspectStyle === undefined) icon._beqsAspectStyle = icon.style || "";
            switch (ratio) {
            case "fill":
                icon.style = (icon._beqsAspectStyle || "") + "background-size: 100% 100%;";
                if (icon.set_content_gravity) icon.set_content_gravity(Clutter.ContentGravity.RESIZE_FILL);
                break;
            case "fit":
                icon.style = icon._beqsAspectStyle || "";
                if (icon.set_content_gravity) icon.set_content_gravity(Clutter.ContentGravity.RESIZE_ASPECT);
                break;
            default: // zoom
                icon.style = (icon._beqsAspectStyle || "") + "background-size: cover;";
                if (icon.set_content_gravity) icon.set_content_gravity(Clutter.ContentGravity.CENTER);
                break;
            }
        } catch (e) { Logger.debug(`MediaItem: cover aspect error: ${e}`); }
    }

    _createControlButtons() {
        const o = this._options;
        if (o.showPrevButton)  this._prevButton  ??= this.addMediaControl("media-skip-backward-symbolic", () => this._player.previous());
        if (o.showPauseButton) this._pauseButton ??= this.addMediaControl("", () => this._player.playPause());
        if (o.showNextButton)  this._nextButton  ??= this.addMediaControl("media-skip-forward-symbolic",  () => this._player.next());
        const op = o.contorlOpacity;
        if (this._nextButton)  this._nextButton.opacity  = op;
        if (this._prevButton)  this._prevButton.opacity  = op;
        if (this._pauseButton) this._pauseButton.opacity = op;
    }

    _update() {
        const icon = this._player.trackCoverUrl
            ? new Gio.FileIcon({ file: Gio.File.new_for_uri(this._player.trackCoverUrl) })
            : new Gio.ThemedIcon({ name: "audio-x-generic-symbolic" });

        this.set({ title: this._player.trackTitle, body: this._player.trackArtists?.join(", ") ?? "", icon });

        if (this._marqueeTitle) {
            this._marqueeTitle.text = this._player.trackTitle ?? "";
            this._marqueeTitle.setEnabled(!!this._options.scrollTitle);
        }

        this._applyCoverAspect();

        if (this._pauseButton) {
            const iconName = this._player.status === "Playing"
                ? "media-playback-pause-symbolic" : "media-playback-start-symbolic";
            if (this._pauseButton.child) this._pauseButton.child.icon_name = iconName;
        }

        if (this._prevButton) this._prevButton.reactive = this._player.canGoPrevious;
        if (this._nextButton) this._nextButton.reactive = this._player.canGoNext;

        this._updateGradient();
    }

    _updateGradient() {
        if (!this._options?.gradientEnabled) { this.style = ""; return; }
        this._cachedColors ??= new Map();
        const coverUrl = this._player.trackCoverUrl;
        if (!coverUrl || coverUrl.endsWith(".svg")) return;

        let colorTask;

        if (coverUrl.startsWith("file://")) {
            const coverPath = decodeURIComponent(coverUrl.replace(/^file:\/\//, ""));
            colorTask = this._cachedColors.get(coverPath);
            if (!colorTask) {
                let pixbuf;
                try { pixbuf = GdkPixbuf.Pixbuf.new_from_file(coverPath); } catch (_e) { return; }
                if (!pixbuf) return;
                colorTask = getImageMeanColor(pixbuf);
                this._cachedColors.set(coverPath, colorTask);
            }
        } else if (coverUrl.startsWith("https://") || coverUrl.startsWith("http://")) {
            const key = decodeURIComponent(coverUrl.replace(/^https?:\/\//, ""));
            colorTask = this._cachedColors.get(key);
            if (!colorTask) {
                const session = new Soup.Session();
                const uri     = GLib.Uri.parse(coverUrl, GLib.UriFlags.NONE);
                const message = new Soup.Message({ method: "GET", uri });
                colorTask = session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null)
                    .then(bytes => {
                        if (!bytes) throw new Error("no data");
                        const raw    = bytes.toArray ? bytes.toArray() : new Uint8Array(bytes.get_data ? bytes.get_data() : bytes);
                        const stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(raw));
                        return getImageMeanColor(GdkPixbuf.Pixbuf.new_from_stream(stream, null));
                    }).catch(() => null);
                this._cachedColors.set(key, colorTask);
            }
        }

        colorTask?.then(color => {
            if (!color || !this._cachedColors) return;
            const ms = this._options.gradientStartMix / 1000;
            const me = this._options.gradientEndMix   / 1000;
            const [bgr, bgg, bgb] = this._options.gradientBackground;
            const [r, g, b]       = color;
            this.style =
                `background-gradient-direction:horizontal;` +
                `background-gradient-start:rgba(${lerp(bgr,r,ms)},${lerp(bgg,g,ms)},${lerp(bgb,b,ms)},${this._options.gradientStartOpaque/1000});` +
                `background-gradient-end:rgba(${lerp(bgr,r,me)},${lerp(bgg,g,me)},${lerp(bgb,b,me)},${this._options.gradientEndOpaque/1000});`;
            this._lastCavaColor = color;
            this.emit("cava-color-changed");
        });
    }

    vfunc_button_press_event(_e)   { return Clutter.EVENT_PROPAGATE; }
    vfunc_button_release_event(_e) { return Clutter.EVENT_PROPAGATE; }
    vfunc_motion_event(_e)         { return Clutter.EVENT_PROPAGATE; }
    vfunc_touch_event(_e)          { return Clutter.EVENT_PROPAGATE; }
}
GObject.registerClass({ Signals: { "cava-color-changed": {} } }, MediaItem);
// #endregion MediaItem

// #region MediaList
class MediaList extends St.BoxLayout {
    get _messages() { return this.get_children(); }

    _init(options) {
        super._init({ can_focus: true, reactive: true, track_hover: true, hover: false, clip_to_allocation: true });
        this.connect("destroy", () => {
            if (this._source) { this._source.destroy(); this._source = null; }
            this._items.clear();
        });

        this._current        = null;
        this._options        = options;
        this._currentMaxPage = 0;
        this._currentPage    = 0;
        this._drag           = false;
        this._scroll         = false;
        this._items          = new Map();

        // FIX: removed stray `V` that broke the scroll-event handler
        this.connect("scroll-event", (_, event) => {
            if (this._drag) return;
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP   && this._currentPage > 0)
                this._seekPage(-1);
            if (dir === Clutter.ScrollDirection.DOWN && this._currentPage < this._currentMaxPage - 1)
                this._seekPage(1);
        });

        this._source = new Source(options);

        this._source.connectObject("player-removed", (_src, player) => {
            const item = this._items.get(player);
            if (!item) return;
            item.destroy(); this._items.delete(player); this._sync();
        }, this);

        this._source.connectObject("player-added", (_src, player) => {
            if (this._items.has(player)) return;
            const item = new MediaItem(player, this._options);
            this._items.set(player, item);
            this.add_child(item); this._sync();
        }, this);

        this._source.start();
    }

    _updateDragOffset(current, offset) {
        const sign  = Math.sign(offset);
        const width = current.allocation.get_width();
        const ratio = Math.max(Math.min(offset / width, 1), -1);
        const half  = Math.max(Math.min(offset * 0.5 / width, 1), -1);
        const expo  = (1 - Math.pow(1 - Math.abs(half), 4)) * sign;
        current.remove_all_transitions();
        this._dragTranslation = current.translationX = expo * (width * 0.6);
        current.opacity = Math.floor(lerp(255, 80, Math.abs(ratio)));
    }

    _finalizeDragOffset(current, offset) {
        const width = current.allocation.get_width();
        const dir   = -Math.sign(offset);
        if ((this._currentPage === this._currentMaxPage - 1 && dir === 1)
            || (this._currentPage === 0 && dir === -1)
            || width / 4 > Math.abs(offset)) {
            current.ease({ mode: Clutter.AnimationMode.EASE_OUT_EXPO, translationX: 0, duration: 360, opacity: 255 });
            this._dragTranslation = null; return;
        }
        this._seekPage(dir); this._dragTranslation = null;
    }

    dfunc_drag_end(event) {
        this._drag = false;
        const current = this._current;
        if (!current || this._scroll) { this._dragTranslation = null; return; }
        const sc = event.moveStartCoords ?? event.startCoords;
        if (!sc || !event.coords) { this._dragTranslation = null; return; }
        this._finalizeDragOffset(current, event.coords[0] - sc[0]);
    }

    dfunc_drag_start(_e)   { if (this._scroll) return; this._drag = true; this._dragTranslation = 0; }
    dfunc_drag_motion(event) {
        if (this._scroll) return;
        const current = this._current;
        if (event.isClick || !current || !event.moveStartCoords || !event.coords) return;
        this._updateDragOffset(current, event.coords[0] - event.moveStartCoords[0]);
    }

    dfunc_scroll_start(_e) { if (this._drag) return; this._scroll = true; this._dragTranslation = 0; }
    dfunc_scroll_motion(event) {
        if (this._drag || !this._current) return;
        this._updateDragOffset(this._current, -event.scrollSumX * 16);
    }
    dfunc_scroll_end(event) {
        this._scroll = false;
        if (!this._current || this._drag) { this._dragTranslation = null; return; }
        this._finalizeDragOffset(this._current, -event.scrollSumX * 16);
    }

    get page()    { return this._currentPage; }
    set page(p)   { this._setPage(this._messages[p]); }
    get maxPage() { return this._currentMaxPage; }

    _showFirstPlaying() {
        const msgs = this._messages;
        this._setPage(msgs.find(m => m?._player?.isPlaying()) ?? msgs[0]);
    }

    _setPage(to) {
        const current  = this._current;
        const messages = this._messages;
        this._current  = to;
        if (!to || to === current) return;
        for (const m of messages) { m.remove_all_transitions(); if (m !== current) m.hide(); }
        const toIdx = messages.findIndex(m => m === to);
        this._currentPage = toIdx;
        this.emit("page-updated", toIdx);
        if (!current) { to.opacity = 255; to.translationX = 0; to.show(); return; }
        const curIdx = messages.findIndex(m => m === current);
        current.ease({
            opacity: 0, translationX: (toIdx > curIdx ? -120 : 120) + (this._dragTranslation ?? 0),
            duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                current.hide();
                to.opacity = 0; to.translationX = toIdx > curIdx ? 120 : -120; to.show();
                to.ease({ mode: Clutter.AnimationMode.EASE_OUT_EXPO, duration: 280, translationX: 0, opacity: 255 });
            },
        });
    }

    _seekPage(offset) {
        const messages = this._messages;
        if (this._current === null) return;
        let cur = messages.findIndex(m => m === this._current);
        if (cur === -1) cur = 0;
        const next = Math.max(0, Math.min(messages.length - 1, cur + offset));
        if (next !== cur) this._setPage(messages[next]);
    }

    _sync() {
        const messages = this._messages;
        const empty    = messages.length === 0;
        if (this._currentMaxPage !== messages.length)
            this.emit("max-page-updated", this._currentMaxPage = messages.length);
        if (this._current && (empty || !messages.includes(this._current))) this._current = null;
        for (const m of messages) { if (m !== this._current) m.hide(); }
        if (!this._current) this._showFirstPlaying();
        this.empty = empty;
    }
}
Drag.applyTo(MediaList);
Scroll.applyTo(MediaList);
GObject.registerClass({
    Signals: {
        "page-updated":     { param_types: [GObject.TYPE_INT] },
        "max-page-updated": { param_types: [GObject.TYPE_INT] },
    },
    Properties: { "empty": GObject.ParamSpec.boolean("empty", null, null, GObject.ParamFlags.READWRITE, true) }
}, MediaList);
// #endregion MediaList

// #region Header
class Header extends St.BoxLayout {
    _init(_options) {
        super._init({ style_class: "beQS-header" });
        this._headerLabel = new St.Label({
            text: _("Media"), style_class: "beQS-header-label",
            y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.START, x_expand: true,
        });
        this.add_child(this._headerLabel);
        this._pageIndicator = new PageIndicators(Clutter.Orientation.HORIZONTAL);
        this._pageIndicator.x_align = Clutter.ActorAlign.END;
        this._pageIndicator.y_align = Clutter.ActorAlign.CENTER;
        this._pageIndicator.connectObject("page-activated", (_, p) => this.emit("page-activated", p), this);
        this.add_child(this._pageIndicator);
    }
    set maxPage(v) { this._pageIndicator.setNPages(v); }
    get maxPage()  { return this._pageIndicator.nPages; }
    set page(v)    { this._pageIndicator.setCurrentPosition(v); }
    get page()     { return this._pageIndicator._currentPosition; }
}
GObject.registerClass({ Signals: { "page-activated": { param_types: [GObject.TYPE_INT] } } }, Header);
// #endregion Header

// #region MediaWidget
class MediaWidget extends St.Widget {
    _init(options) {
        super._init({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true, reactive: true, visible: true, clip_to_allocation: true });
        this.connect("destroy", () => { if (this._emptyTimeoutId) { GLib.source_remove(this._emptyTimeoutId); this._emptyTimeoutId = 0; } });

        this._options = options; this._cavaInBackground = false;

        if (options.cavaEnabled && (options.cavaPosition === "background" || !options.cavaPosition)) {
            try {
                this._cavaWidget = new Cava({ bars: 40, shape: options.cavaShape, color: options.cavaColor, colorEnd: options.cavaColorEnd, gradientEnabled: options.cavaGradientEnabled, transparency: options.cavaTransparency, backgroundAlign: options.cavaBackgroundAlign, sensitivity: options.cavaSensitivity });
                this._cavaWidget.set({ x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.FILL, margin_left: 12, margin_right: 12 });
                this._cavaInBackground = true; this.add_child(this._cavaWidget);
            } catch (e) { Logger.error(`MediaWidget: cava bg: ${e}`); }
        }

        this._contentBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true });
        this.add_child(this._contentBox);
        this._updateStyleClass();

        this._header = new Header({});
        this._header.visible = options.header;
        this._contentBox.add_child(this._header);

        this._list = new MediaList(options);
        this._contentBox.add_child(this._list);

        if (options.cavaEnabled && !this._cavaInBackground) {
            try {
                this._cavaWidget = new Cava({ bars: 40, shape: options.cavaShape, color: options.cavaColor, colorEnd: options.cavaColorEnd, gradientEnabled: options.cavaGradientEnabled, transparency: options.cavaTransparency, backgroundAlign: options.cavaBackgroundAlign, sensitivity: options.cavaSensitivity });
                this._cavaWidget.set({ x_expand: true, y_expand: false, height: 60 });
                if (options.cavaPosition === "top")         this._contentBox.insert_child_at_index(this._cavaWidget, 0);
                else if (options.cavaPosition === "bottom") this._contentBox.add_child(this._cavaWidget);
            } catch (e) { Logger.error(`MediaWidget: cava pos: ${e}`); }
        }

        this._list.connectObject("notify::empty", this._syncEmpty.bind(this), this);
        this._syncEmpty();
        this._header.page = this._list.page; this._header.maxPage = this._list.maxPage;
        this._list.connectObject("page-updated",     (_, p) => { if (this._header.page    !== p) this._header.page    = p; }, this);
        this._list.connectObject("max-page-updated", (_, p) => { if (this._header.maxPage !== p) this._header.maxPage = p; }, this);
        this._header.connectObject("page-activated", (_, p) => { this._list.page = p; }, this);
        this._list.connectObject("page-updated",     () => this._hookCavaColorFromCurrentItem(), this);
        this._list.connectObject("max-page-updated", () => this._hookCavaColorFromCurrentItem(), this);
    }

    _hookCavaColorFromCurrentItem() {
        if (!this._cavaWidget) return;
        if (this._options.cavaColor?.length >= 3) return;
        const current = this._list._current;
        if (!current) return;
        if (current._lastCavaColor) this._cavaWidget.setColor(current._lastCavaColor);
        if (this._cavaColorItem && this._cavaColorItem !== current) {
            try { this._cavaColorItem.disconnectObject(this._cavaWidget); } catch (_e) {}
        }
        this._cavaColorItem = current;
        current.connectObject("cava-color-changed", () => {
            if (current._lastCavaColor) this._cavaWidget.setColor(current._lastCavaColor);
        }, this._cavaWidget);
    }

    _syncEmpty() {
        const empty = this._list.empty;
        if (!empty) {
            if (this._emptyTimeoutId) { GLib.source_remove(this._emptyTimeoutId); this._emptyTimeoutId = 0; }
            this.visible = true;
        } else if (!this._emptyTimeoutId) {
            this._emptyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                this.visible = false; this._emptyTimeoutId = 0; return GLib.SOURCE_REMOVE;
            });
            GLib.Source.set_name_by_id(this._emptyTimeoutId, "[beQS] MediaWidget._emptyTimeoutId");
        }
    }

    _updateStyleClass() {
        const o = this._options;
        let s = "beQS-media";
        if (o.compact)      s += " beQS-message-compact";
        if (o.removeShadow) s += " beQS-message-remove-shadow";
        this._contentBox.style_class = s;
    }
}
GObject.registerClass(MediaWidget);
// #endregion MediaWidget

// #region MediaWidgetFeature
export class MediaWidgetFeature extends FeatureBase {
    loadSettings(loader) {
        this.enabled        = loader.loadBoolean("media-enabled");
        this.header         = loader.loadBoolean("media-show-header");
        this.useItunesCover = loader.loadBoolean("media-use-itunes-cover");
        this.compact        = loader.loadBoolean("media-compact");
        this.removeShadow   = loader.loadBoolean("media-remove-shadow");

        this.contorlOpacity  = loader.loadInt("media-contorl-opacity");
        this.showNextButton  = loader.loadBoolean("media-contorl-show-next-button");
        this.showPrevButton  = loader.loadBoolean("media-contorl-show-prev-button");
        this.showPauseButton = loader.loadBoolean("media-contorl-show-pause-button");

        this.gradientBackground  = loader.loadRgb("media-gradient-background-color");
        this.gradientEnabled     = loader.loadBoolean("media-gradient-enabled");
        this.gradientStartOpaque = loader.loadInt("media-gradient-start-opaque");
        this.gradientStartMix    = loader.loadInt("media-gradient-start-mix");
        this.gradientEndOpaque   = loader.loadInt("media-gradient-end-opaque");
        this.gradientEndMix      = loader.loadInt("media-gradient-end-mix");

        this.progressEnabled  = loader.loadBoolean("media-progress-enabled");
        this.sliderStyle      = StyledSlider.Options.fromLoader(loader, "media-progress");

        this.scrollTitle      = loader.loadBoolean("media-scroll-title");
        this.coverAspectRatio = loader.loadString("media-cover-aspect-ratio");
        this.cavaEnabled      = loader.loadBoolean("media-cava-enabled");
        this.cavaShape        = loader.loadString("media-cava-shape");
        this.cavaColor        = loader.loadRgb("media-cava-color");
        this.cavaTransparency = loader.loadInt("media-cava-transparency");
        this.cavaPosition     = loader.loadString("media-cava-position");
        this.cavaBackgroundAlign = loader.loadString("media-cava-background-align");
        this.cavaGradientEnabled = loader.loadBoolean("media-cava-gradient-enabled");
        this.cavaColorEnd     = loader.loadRgb("media-cava-color-end");
        this.cavaSensitivity  = loader.loadInt("media-cava-sensitivity");
    }

    reload(key) {
        if (StyledSlider.Options.isStyleKey("media-progress", key)) {
            if (!this.enabled || !this.progressEnabled) return;
            for (const m of this.mediaWidget._list._messages) m._progressControl?._createSlider();
            return;
        }
        switch (key) {
        case "media-show-header":
            if (!this.enabled || !this.mediaWidget) return;
            this.mediaWidget._header.visible = this.header; break;
        case "media-compact": case "media-remove-shadow":
            if (!this.enabled) return; this.mediaWidget._updateStyleClass(); break;
        case "media-contorl-opacity":
            if (!this.enabled) return;
            for (const m of this.mediaWidget._list._messages) m._createControlButtons(); break;
        case "media-gradient-background-color": case "media-gradient-enabled":
        case "media-gradient-start-opaque": case "media-gradient-start-mix":
        case "media-gradient-end-opaque":   case "media-gradient-end-mix":
            if (!this.enabled) return;
            for (const m of this.mediaWidget._list._messages) m._updateGradient(); break;
        case "media-scroll-title":
            if (!this.enabled) return;
            for (const m of this.mediaWidget._list._messages) m._setupMarquee(); break;
        case "media-cover-aspect-ratio":
            if (!this.enabled) return;
            for (const m of this.mediaWidget._list._messages) m._applyCoverAspect(); break;
        case "media-cava-enabled": case "media-cava-position": case "media-cava-background-align":
            if (!this.enabled) return; super.reload(); break;
        case "media-cava-shape":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setShape(this.cavaShape); break;
        case "media-cava-color":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setColor(this.cavaColor); break;
        case "media-cava-transparency":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setTransparency(this.cavaTransparency); break;
        case "media-cava-gradient-enabled":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setGradientEnabled(this.cavaGradientEnabled); break;
        case "media-cava-color-end":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setColorEnd(this.cavaColorEnd); break;
        case "media-cava-sensitivity":
            if (!this.enabled || !this.mediaWidget?._cavaWidget) return;
            this.mediaWidget._cavaWidget.setSensitivity(this.cavaSensitivity); break;
        default: super.reload(); break;
        }
    }

    onLoad() {
        if (!this.enabled) return;
        this.maid.destroyJob(this.mediaWidget = new MediaWidget(this));
        const grid = Global.QuickSettingsGrid;
        if (!grid) { Logger.error("MediaWidgetFeature: QuickSettingsGrid not available"); return; }
        grid.add_child(this.mediaWidget);
        const lm = grid.layout_manager;
        try {
            if (lm && typeof lm.set_child_double_column === "function")
                lm.set_child_double_column(this.mediaWidget, true);
            else if (lm && typeof lm.child_set_property === "function")
                lm.child_set_property(grid, this.mediaWidget, "column-span", 2);
        } catch (e) { Logger.error(`MediaWidgetFeature: column-span failed: ${e}`); }
    }

    onUnload() { this.mediaWidget = null; }
}
// #endregion MediaWidgetFeature