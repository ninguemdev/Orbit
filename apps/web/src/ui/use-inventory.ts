import { useCallback, useEffect, useRef, useState } from 'react';
import type { InventoryResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';

export interface InventoryControls {
  readonly inventory: InventoryResponse | null;
  readonly error: string | null;
  readonly loading: boolean;
  reload(): Promise<void>;
}

/**
 * The account's inventory, read from the server and shared by every panel that shows
 * it. Refreshed on demand and when the window regains focus; only the latest answer
 * is applied, and nothing is applied after unmounting.
 */
export function useInventory(): InventoryControls {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    const result = await accountClient.inventory();
    if (!mounted.current || request !== latest.current) return;
    setLoading(false);
    if (result.ok) {
      setInventory(result.data);
      setError(null);
    } else {
      setError(describeAccountError(result.code));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  return { inventory, error, loading, reload };
}
