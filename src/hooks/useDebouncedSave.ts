import { useEffect, useRef, useCallback } from 'react';

interface UseDebouncedSaveOptions {
  delayMs?: number;
  onSave: () => Promise<void> | void;
}

export function useDebouncedSave({ delayMs = 1500, onSave }: UseDebouncedSaveOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    cancel();
    timeoutRef.current = setTimeout(async () => {
      timeoutRef.current = null;
      await onSaveRef.current();
    }, delayMs);
  }, [cancel, delayMs]);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return { trigger, cancel };
}
