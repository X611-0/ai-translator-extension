import { create } from 'zustand';
import { AppState, SubtitleEntry } from '@/types';

interface AppStore extends AppState {
  startTranslation: () => void;
  stopTranslation: () => void;
  setStatus: (status: AppState['status']) => void;
  setOutputMode: (mode: 'subtitle' | 'speech' | 'both') => void;
  addSubtitle: (entry: SubtitleEntry) => void;
  updateSubtitle: (id: string, entry: Partial<SubtitleEntry>) => void;
  clearHistory: () => void;
  setError: (message: string | null) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  isRunning: false,
  status: 'idle',
  errorMessage: null,
  outputMode: 'both',
  currentSubtitle: null,
  subtitleHistory: [],
  stats: {
    totalSegments: 0,
    totalCharacters: 0,
    averageLatency: 0,
  },

  startTranslation: () =>
    set({
      isRunning: true,
      status: 'capturing',
      errorMessage: null,
    }),

  stopTranslation: () =>
    set({
      isRunning: false,
      status: 'idle',
      currentSubtitle: null,
    }),

  setStatus: (status) => set({ status }),

  setOutputMode: (mode) => set({ outputMode: mode }),

  addSubtitle: (entry) => {
    const state = get();
    const newHistory = [...state.subtitleHistory, entry].slice(-50); // 最多保留50条
    const newStats = {
      totalSegments: state.stats.totalSegments + 1,
      totalCharacters: state.stats.totalCharacters + entry.translated.length,
      averageLatency:
        state.stats.totalSegments > 0
          ? (state.stats.averageLatency * state.stats.totalSegments +
              (Date.now() - entry.timestamp)) /
            (state.stats.totalSegments + 1)
          : Date.now() - entry.timestamp,
    };

    set({
      currentSubtitle: entry,
      subtitleHistory: newHistory,
      stats: newStats,
    });
  },

  updateSubtitle: (id, updates) => {
    const state = get();
    const newHistory = state.subtitleHistory.map((e) =>
      e.id === id ? { ...e, ...updates } : e
    );

    if (state.currentSubtitle?.id === id) {
      set({
        currentSubtitle: { ...state.currentSubtitle, ...updates },
        subtitleHistory: newHistory,
      });
    } else {
      set({ subtitleHistory: newHistory });
    }
  },

  clearHistory: () =>
    set({
      subtitleHistory: [],
      currentSubtitle: null,
      stats: {
        totalSegments: 0,
        totalCharacters: 0,
        averageLatency: 0,
      },
    }),

  setError: (message) =>
    set({
      errorMessage: message,
      status: message ? 'error' : get().status,
    }),
}));