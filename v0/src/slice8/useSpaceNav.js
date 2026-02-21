// src/slice8/useSpaceNav.ts
import { useEffect, useMemo, useState } from "react";
import { getCurrentSpaceId, setHashSpace, loadOriginSpaceId, saveOriginSpaceId, buildSpaceUrl, loadAdvancedToggle, saveAdvancedToggle, } from "./spaceNav";
export function useSpaceNav(fallbackSpaceId) {
    const [current, setCurrent] = useState(() => getCurrentSpaceId() ?? fallbackSpaceId);
    const [origin, setOriginState] = useState(() => loadOriginSpaceId() ?? fallbackSpaceId);
    const [advanced, setAdvanced] = useState(() => loadAdvancedToggle());
    // Initialise hash on mount if empty
    useEffect(() => {
        if (!getCurrentSpaceId()) {
            setHashSpace(current, "replace");
        }
    }, []);
    // Sync on hashchange (covers browser back/forward + manual hash edits)
    useEffect(() => {
        const onHash = () => {
            const id = getCurrentSpaceId();
            if (id)
                setCurrent(id);
        };
        window.addEventListener("hashchange", onHash);
        return () => { window.removeEventListener("hashchange", onHash); };
    }, []);
    const api = useMemo(() => {
        async function navigateTo(spaceId, opts = {}) {
            if (opts.beforeNavigate)
                await opts.beforeNavigate(spaceId);
            setHashSpace(spaceId, opts.replace ? "replace" : "push");
            // Also set directly — hashchange won't fire if the hash value is unchanged
            setCurrent(spaceId);
        }
        function setOrigin(spaceId) {
            setOriginState(spaceId);
            saveOriginSpaceId(spaceId);
        }
        async function goOrigin(opts = {}) {
            return navigateTo(origin, opts);
        }
        async function copyLink(spaceId) {
            const url = buildSpaceUrl(spaceId);
            await navigator.clipboard.writeText(url);
            return url;
        }
        function toggleAdvanced(v) {
            setAdvanced(v);
            saveAdvancedToggle(v);
        }
        return { navigateTo, setOrigin, goOrigin, copyLink, toggleAdvanced };
    }, [origin]);
    return { current, origin, advanced, ...api };
}
