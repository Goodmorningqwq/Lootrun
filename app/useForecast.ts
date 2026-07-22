'use client';

/**
 * Drives the simulation worker. Requests are keyed by id so a stale reply from
 * an earlier state can never overwrite a newer forecast — easy to hit here,
 * since state changes every challenge while a rollout is still running.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Forecast, SimConfig } from '../engine/simulator';
import { DEFAULT_SIM } from '../engine/simulator';
import type { OfferedBeacon, RunState } from '../engine/types';

export function useForecast() {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const latest = useRef(0);

  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url));
    w.onmessage = (e: MessageEvent<{ id: number; forecast?: Forecast; error?: string }>) => {
      if (e.data.id !== latest.current) return; // stale — a newer request won
      setRunning(false);
      if (e.data.error) setError(e.data.error);
      else if (e.data.forecast) {
        setForecast(e.data.forecast);
        setError(null);
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const run = useCallback(
    (state: RunState, offer: OfferedBeacon[], config?: Partial<SimConfig>) => {
      if (!workerRef.current || offer.length === 0) return;
      const id = ++nextId.current;
      latest.current = id;
      setRunning(true);
      setError(null);
      workerRef.current.postMessage({ id, state, offer, config });
    },
    [],
  );

  const clear = useCallback(() => {
    latest.current = ++nextId.current; // invalidate anything in flight
    setForecast(null);
    setRunning(false);
    setError(null);
  }, []);

  return { forecast, running, error, run, clear, defaults: DEFAULT_SIM };
}
