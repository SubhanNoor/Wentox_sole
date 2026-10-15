import { useSyncExternalStore } from 'react';
import { subscribeDataChanged, getDataVersion } from '@/lib/dataChanged';

/**
 * A number that goes up whenever ANOTHER Wentox window saves something (lib/dataChanged.ts). Add it
 * to a screen's load dependencies and the screen re-runs that load — lists, reports and dropdown
 * options refresh live, while form fields the user is typing in are left alone (per the user,
 * 2026-10-15).
 */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribeDataChanged, getDataVersion);
}
