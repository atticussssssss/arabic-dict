// 生词本:localStorage 持久化 + 简单间隔复习
import { useSyncExternalStore } from 'react';

export interface WordbookItem {
  id: number;
  word: string;
  voc: string;
  roman: string;
  pos: string;
  zh: string;
  en: string;
  addedAt: number;
  // 复习状态:box 0-5,越高间隔越长
  box: number;
  dueAt: number;
}

const KEY = 'arabic-dict-wordbook-v1';
const BOX_INTERVALS_DAYS = [0, 1, 2, 4, 7, 15, 30];

let cache: WordbookItem[] | null = null;
const listeners = new Set<() => void>();

function load(): WordbookItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    cache = [];
  }
  return cache!;
}

function save(items: WordbookItem[]) {
  cache = items;
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

export function getWordbook(): WordbookItem[] {
  return load();
}

export function isSaved(id: number): boolean {
  return load().some((i) => i.id === id);
}

export function toggleSave(item: Omit<WordbookItem, 'addedAt' | 'box' | 'dueAt'>) {
  const items = load();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    save([...items.slice(0, idx), ...items.slice(idx + 1)]);
  } else {
    save([{ ...item, addedAt: Date.now(), box: 0, dueAt: Date.now() }, ...items]);
  }
}

export function removeSaved(id: number) {
  save(load().filter((i) => i.id !== id));
}

/** 复习打分:known=认识 → 升箱,否则回到箱1 */
export function review(id: number, known: boolean) {
  const items = load().map((i) => {
    if (i.id !== id) return i;
    const box = known ? Math.min(i.box + 1, 6) : 1;
    const days = BOX_INTERVALS_DAYS[Math.min(box, BOX_INTERVALS_DAYS.length - 1)];
    return { ...i, box, dueAt: Date.now() + days * 86400_000 };
  });
  save(items);
}

export function dueItems(): WordbookItem[] {
  const now = Date.now();
  return load().filter((i) => i.dueAt <= now);
}

export function useWordbook(): WordbookItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => load(),
  );
}
