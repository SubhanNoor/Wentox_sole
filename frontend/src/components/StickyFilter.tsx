import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Keeps a list page's filter/master panel pinned at the top of the page's scroll area while only
 * the records underneath scroll (per the user, 2026-11-17). Wrap the filter panel — and anything
 * that belongs with it, e.g. the stat cards on Find & Update Bill — in this.
 *
 * It also publishes the panel's live height as --sticky-filter-h on the scrolling <main>, and flags
 * <main> with .has-sticky-filter; index.css uses those two to pin each table's column header row
 * directly under the panel, so the headings stay visible too.
 */
export default function StickyFilter({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const main = el?.closest('.app-main') as HTMLElement | null;
    if (!el || !main) return;
    main.classList.add('has-sticky-filter');
    // <main> has top padding, and a sticky element pins at the padding's inner edge — leaving a
    // strip above the panel where rows scroll through. The panel reaches up over that padding
    // (see .sticky-filter in index.css), so its visible bottom edge is height minus the padding.
    const pad = parseFloat(getComputedStyle(main).paddingTop) || 0;
    main.style.setProperty('--sticky-pad', `${pad}px`);
    const publish = () => main.style.setProperty('--sticky-filter-h', `${el.offsetHeight - pad}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      main.classList.remove('has-sticky-filter');
      main.style.removeProperty('--sticky-filter-h');
      main.style.removeProperty('--sticky-pad');
    };
  }, []);

  return <div ref={ref} className="sticky-filter">{children}</div>;
}
