import { useCallback, useEffect, useRef, useState } from 'react';
import { endpoints } from '../api/endpoints';
import { KillSync, type KillSyncState } from './killSync';

const EMPTY: KillSyncState = { killed: new Set(), status: 'loading', error: null };

/**
 * Bestiary state of the selected character. Switching characters flushes unsaved
 * changes of the previous one and loads the new one from scratch.
 */
export function useKilledMonsters(characterId: string | null) {
  const [state, setState] = useState<KillSyncState>(EMPTY);
  const syncRef = useRef<KillSync | null>(null);

  useEffect(() => {
    if (!characterId) {
      setState({ ...EMPTY, status: 'idle' });
      return;
    }
    setState(EMPTY);
    const sync = new KillSync(
      {
        load: () => endpoints.killedMonsters(characterId),
        save: (add, remove) => endpoints.updateKilledMonsters(characterId, add, remove),
      },
      setState,
    );
    syncRef.current = sync;
    void sync.load();

    return () => {
      sync.dispose();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [characterId]);

  useEffect(() => {
    const flush = () => void syncRef.current?.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const set = useCallback((ids: number[], killed: boolean) => syncRef.current?.set(ids, killed), []);
  const retry = useCallback(() => syncRef.current?.retry(), []);

  return { ...state, set, retry };
}
