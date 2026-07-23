/// <reference lib="webworker" />

/**
 * Simulation worker. Rollouts are CPU-bound — a few hundred per action, each
 * playing a whole run — so they run off the main thread to keep the tracker
 * responsive mid-run.
 */

import { forecastOffer, type SimConfig } from '../engine/simulator';
import { setStrategy, type Strategy } from '../engine/evaluator';
import type { OfferedBeacon, RunState } from '../engine/types';

export interface SimRequest {
  id: number;
  state: RunState;
  offer: OfferedBeacon[];
  config?: Partial<SimConfig>;
  /** The worker is a fresh module, so it must be told the active strategy or
   *  rollouts would score against the default rather than the user's edits. */
  strategy?: Strategy;
}

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, state, offer, config, strategy } = e.data;
  try {
    if (strategy) setStrategy(strategy);
    // forecastOffer merges partials against defaults — no cast needed.
    const forecast = forecastOffer(state, offer, config ?? {});
    (self as unknown as Worker).postMessage({ id, forecast });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
