"use client";
import { useEffect, useState } from "react";
import type { Arena, Player } from "./game";
import { SEED_FRIENDS, type Dare } from "./world";

export interface LedgerItem { at: number; text: string; amount: number }

export interface Saved {
  v: 1;
  name: string;
  mode: "play" | "watch" | null;
  usdc: number; // mock USDC
  joinedPublic: string[];
  publicJoinedAt: Record<string, number>;
  publicCalls: Record<string, Arena["calls"]>;
  arenas: Arena[];
  activeCode: string; // "public" or a private code
  friends: Player[];
  dares: Dare[];
  ledger: LedgerItem[];
  claimed: string[];
  forceSim: boolean;
}

export const DEFAULT_STATE: Saved = {
  v: 1,
  name: "",
  mode: null,
  usdc: 20,
  joinedPublic: [],
  publicJoinedAt: {},
  publicCalls: {},
  arenas: [],
  activeCode: "public",
  friends: SEED_FRIENDS,
  dares: [],
  ledger: [{ at: 0, text: "Demo welcome balance", amount: 20 }],
  claimed: [],
  forceSim: false,
};

const KEY = "hoa-web-v1";

export function useSaved() {
  const [s, setS] = useState<Saved>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setS({ ...DEFAULT_STATE, ...(JSON.parse(raw) as Saved) });
      else setS({ ...DEFAULT_STATE, ledger: [{ at: Date.now(), text: "Demo welcome balance", amount: 20 }] });
    } catch {
      /* ignore broken state */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(s));
  }, [s, loaded]);
  const reset = () => {
    localStorage.removeItem(KEY);
    setS({ ...DEFAULT_STATE, ledger: [{ at: Date.now(), text: "Demo welcome balance", amount: 20 }] });
  };
  return { s, setS, loaded, reset };
}
