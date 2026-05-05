import Adw from "gi://Adw";
import GObject from "gi://GObject";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import Config from "../config.js";
import { Group, Row, ContributorsRow, LicenseRow, LogoGroup, DialogRow, ChangelogDialog, fixPageScrollIssue, SwitchRow, DropdownRow, } from "../libs/prefs/components.js";
export const AboutPage = GObject.registerClass({
	GTypeName: Config.baseGTypeName + "AboutPage",
}, class AboutPage extends Adw.PreferencesPage {
	constructor(settings, prefs, window) {
		super({
			name: "about",
			title: _("About"),
			iconName: "dialog-information-symbolic"
		});
		fixPageScrollIssue(this);
		// Logo
		LogoGroup({
			parent: this,
			name: _("Better Quick Settings"),
			icon: "beqs-project-icon",
			version: _("v1.1"),
		});

		// Links
		Group({
			parent: this,
			title: _("Links"),
			description: _("Official project links")
		}, [
			Row({
				uri: "https://github.com/unaibenidorm/bQS",
				title: _("GitHub Repository"),
				subtitle: _("Report bugs or check the source code."),
				icon: "github",
			}),
		]);

		Group({
			parent: this,
			title: _("Debug"),
			description: _("Extension debugging options"),
		}, [
			SwitchRow({
				settings,
				title: _("Expose environment"),
				subtitle: _("Expose extension environment to globalThis.beqs"),
				bind: "debug-expose"
			}),
			SwitchRow({
				settings,
				title: _("Show layout border"),
				subtitle: _("Show layout borders on Quick Settings"),
				bind: "debug-show-layout-border"
			}),
			DropdownRow({
				settings,
				title: _("Log level"),
				bind: "debug-log-level",
				items: [
					{ name: _("none"), value: -1 },
					{ name: _("error"), value: 0 },
					{ name: _("info"), value: 1 },
					{ name: _("debug"), value: 2 },
				],
			}),
		]);
	}
});
