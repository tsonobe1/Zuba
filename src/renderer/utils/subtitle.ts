export interface SubtitleStyles {
  fontColor: string;
  backgroundColor: string;
  fontSize: number;
  fontFamily: string;
}

export interface SubtitlePosition {
  xPercent: number;
  yPercent: number;
}

export interface SubtitleEntry {
  id: string;
  text: string;
  start: number;
  end: number;
  styles: SubtitleStyles;
  position: SubtitlePosition;
}

export interface SubtitleDraft {
  id?: string;
  text: string;
  start: number;
  end: number;
  styles: SubtitleStyles;
  position?: SubtitlePosition;
}

export const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = {
  xPercent: 50,
  yPercent: 85
};

const clampPercent = (value: number) => Math.min(Math.max(Number.isFinite(value) ? value : 50, 0), 100);

const normalizePosition = (position?: SubtitlePosition): SubtitlePosition => {
  if (!position) {
    return { ...DEFAULT_SUBTITLE_POSITION };
  }
  return {
    xPercent: clampPercent(position.xPercent),
    yPercent: clampPercent(position.yPercent)
  };
};

export const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) {
    return '0.00s';
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes > 0) {
    const paddedSeconds = seconds.toFixed(2).padStart(5, '0');
    return `${minutes}:${paddedSeconds}s`;
  }
  return `${seconds.toFixed(2)}s`;
};

export const normalizeRange = (start: number, end: number): { start: number; end: number } => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: 0 };
  }
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  return {
    start: Math.max(0, min),
    end: Math.max(0, max)
  };
};

export const buildSubtitleEntry = (draft: SubtitleDraft, idFactory: () => string): SubtitleEntry => {
  const { start, end } = normalizeRange(draft.start, draft.end);
  return {
    id: draft.id ?? idFactory(),
    text: draft.text.trim(),
    start,
    end,
    styles: { ...draft.styles },
    position: normalizePosition(draft.position)
  };
};

export const findActiveSubtitle = (subtitles: SubtitleEntry[], currentTime: number): SubtitleEntry | undefined =>
  subtitles.find((item) => currentTime >= item.start && currentTime <= item.end);
