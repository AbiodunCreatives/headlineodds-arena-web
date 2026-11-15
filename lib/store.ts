"use client";
import { useEffect, useState } from "react";
import { newEscrow, type Escrow } from "./dare";

// Everything lives in this browser's localStorage. Test balances only.
export interface Saved extends Escrow {
  v: 1;
  name: string;
}

const KEY = "dare15-v1";
const fresh = (now: number): Saved => ({ v: 1, name: "", ...newEscrow(now) });

export function useSaved() {
  const [s, setS] = useState<Saved>(() => fresh(0));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setS(raw ? { ...fresh(Date.now()), ...(JSON.parse(raw) as Saved) } : fresh(Date.now()));
    } catch {
      setS(fresh(Date.now()));
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(s));
  }, [s, loaded]);
  const reset = () => {
    localStorage.removeItem(KEY);
    setS(fresh(Date.now()));
  };
  return { s, setS, loaded, reset };
}
