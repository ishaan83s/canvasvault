import { useEffect, useRef, useCallback, useState } from 'react';

interface UseDebouncedSaveOptions {
  delayMs?: number;
  onSave: () => Promise<void> | void;
}

export function useDebouncedSave({ delayMs = 1500, onSave }: UseDebouncedSaveOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const [isDebouncing, setIsDebouncing] = useState<boolean>(false);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setIsDebouncing(false);
    }
  }, []);

  const trigger = useCallback(() => {
    cancel();
    setIsDebouncing(true);
    timeoutRef.current = setTimeout(async () => {
      timeoutRef.current = null;
      setIsDebouncing(false);
      await onSaveRef.current();
    }, delayMs);
  }, [cancel, delayMs]);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return { trigger, cancel, isDebouncing };
}
