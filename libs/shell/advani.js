import Clutter from "gi://Clutter";

export class ModeDefine {
    constructor(params) {
        for (const [key, value] of Object.entries(params))
            this[key] = value;
    }
}

export function createBezier(x1, y1, x2, y2) {
    return [x1, y1, x2, y2];
}

export var AdvAnimationMode;
(function (AdvAnimationMode) {
    AdvAnimationMode[AdvAnimationMode["LowBackover"] = 2000] = "LowBackover";
    AdvAnimationMode[AdvAnimationMode["MiddleBackover"] = 2001] = "MiddleBackover";
})(AdvAnimationMode || (AdvAnimationMode = {}));

export const AdvAnimationModeDefines = [
    new ModeDefine({
        mode: Clutter.AnimationMode.CUBIC_BEZIER,
        getCubicBezierProgress: () => createBezier(.225, 1.2, .45, 1),
    }),
    new ModeDefine({
        mode: Clutter.AnimationMode.CUBIC_BEZIER,
        getCubicBezierProgress: () => createBezier(.4, 1.35, .55, 1),
    }),
];

// FIXED GNOME 50:
// En GNOME 50 GJS/Clutter no acepta set_cubic_bezier_progress(x1,y1,x2,y2)
// como antes. Así que lo intentamos en formato array/objeto si existe y
// si falla, no rompemos la animación.
export function ease(actor, params) {
    let modeDefine;

    if (params.mode && params.mode > Clutter.AnimationMode.ANIMATION_LAST) {
        modeDefine = AdvAnimationModeDefines[params.mode - AdvAnimationMode.LowBackover];
        params.mode = modeDefine?.mode ?? Clutter.AnimationMode.EASE_OUT_QUAD;
    } else if ((typeof params.mode === "object") && (params.mode instanceof ModeDefine)) {
        modeDefine = params.mode;
        params.mode = modeDefine.mode;
    }

    actor.ease(params);

    if (!modeDefine)
        return;

    let {getCubicBezierProgress, cubicBezierProgress} = modeDefine;
    if (getCubicBezierProgress)
        cubicBezierProgress = getCubicBezierProgress();

    if (!cubicBezierProgress)
        return;

    for (const key in params) {
        const transition = actor.get_transition(key.replace(/_/g, "-"));
        if (!transition)
            continue;

        try {
            // Intento 1: API vieja
            transition.set_cubic_bezier_progress(...cubicBezierProgress);
        } catch (_e1) {
            try {
                // Intento 2: pasar array
                transition.set_cubic_bezier_progress(cubicBezierProgress);
            } catch (_e2) {
                try {
                    // Intento 3: fallback sin bezier custom
                    // No hacemos nada: la animación ya corre con Clutter.
                } catch (_e3) {
                }
            }
        }
    }
}