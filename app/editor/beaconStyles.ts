/**
 * Beacon chip styling, shared by every editor surface.
 *
 * Lived in three places (phase priority, tree, combos) and had already started
 * to drift. Colour is how a lootrunner identifies a beacon at a glance, so it
 * has to mean the same thing on every panel.
 */

import { BEACON_COLORS, type BeaconColor } from '../../engine/types';

/** Canonical beacon list — from the engine, never duplicated here. */
export const BEACON_LIST: readonly BeaconColor[] = BEACON_COLORS;

export const CHIP: Record<string, string> = {
  blue: 'bg-blue-600 text-white', purple: 'bg-purple-600 text-white',
  yellow: 'bg-yellow-500 text-black', aqua: 'bg-cyan-500 text-black',
  orange: 'bg-orange-500 text-black', green: 'bg-green-600 text-white',
  darkGrey: 'bg-zinc-600 text-white', white: 'bg-zinc-100 text-black',
  grey: 'bg-zinc-400 text-black', red: 'bg-red-600 text-white',
  pink: 'bg-pink-500 text-black', crimson: 'bg-rose-900 text-white',
  rainbow: 'bg-gradient-to-r from-red-500 via-yellow-400 to-blue-500 text-black',
};

export const chipClass = (color: string) => CHIP[color] ?? 'bg-zinc-700 text-white';
