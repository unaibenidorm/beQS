import GObject from "gi://GObject";

export var ToggleOrderItem;
(function (ToggleOrderItem) {
    function match(a, b) {
        if (a.isSystem != b.isSystem || a.nonOrdered != b.nonOrdered)
            return false;
        if (a.nonOrdered)
            return true;
        if (a.isSystem)
            return a.constructorName == b.constructorName;
        return (
            a.constructorName == b.constructorName &&
            a.title == b.title &&
            a.titleRegex == b.titleRegex &&
            a.friendlyName == b.friendlyName &&
            a.gtypeName == b.gtypeName
        );
    }
    ToggleOrderItem.match = match;

    // FIXED: toggleMatch más tolerante. En GNOME 48+ muchos toggles de terceros
    // no tienen constructorName fiable. Usamos gtypeName como prioridad.
    function toggleMatch(item, toggle) {
        if (item.nonOrdered) return false;

        let toggleGtype = "";
        try {
            toggleGtype = GObject.type_name_from_instance(toggle) || "";
        } catch (_e) {
            toggleGtype = "";
        }
        const toggleCtor = toggle.constructor?.name || "";

        // gtypeName tiene prioridad (es estable y registrado)
        if (item.gtypeName) {
            if (toggleGtype !== item.gtypeName) return false;
        } else if (item.constructorName) {
            if (toggleCtor !== item.constructorName) return false;
        } else if (item.cachedTitleRegex) {
            if (!toggle.title || toggle.title.match(item.cachedTitleRegex) == null)
                return false;
        } else {
            // Si no hay ningún criterio definido, no matchea.
            return false;
        }

        return true;
    }
    ToggleOrderItem.toggleMatch = toggleMatch;

    ToggleOrderItem.Default = {
        hide: false,
        title: "",
        titleRegex: "",
        constructorName: "",
        friendlyName: "",
        gtypeName: "",
    };

    function create(friendlyName) {
        return {
            ...ToggleOrderItem.Default,
            friendlyName,
        };
    }
    ToggleOrderItem.create = create;
})(ToggleOrderItem || (ToggleOrderItem = {}));