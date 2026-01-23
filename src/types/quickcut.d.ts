export type SegmentRange = {
  start: number;
  end: number;
};

export type SubtitleStylePayload = {
  fontColor: string;
  backgroundColor: string;
  fontSize: number;
  fontFamily: string;
};

export type SubtitlePositionPayload = {
  xPercent: number;
  yPercent: number;
};

export type SubtitleExportPayload = {
  id: string;
  text: string;
  start: number;
  end: number;
  styles: SubtitleStylePayload;
  position: SubtitlePositionPayload;
};

export type ExportSegmentsPayload = {
  sourcePath: string;
  segments: SegmentRange[];
  subtitles?: SubtitleExportPayload[];
  videoWidth?: number;
  videoHeight?: number;
};

export type ExportSegmentsResult = {
  success: boolean;
  outputPath?: string;
  error?: string;
  canceled?: boolean;
};

export type QuickCutAPI = {
  chooseVideo: () => Promise<string | null>;
  pathToFileUrl: (filePath: string) => string | null;
  onExternalFile: (callback: (filePath: string) => void) => void;
  exportCuts: (payload: ExportSegmentsPayload) => Promise<ExportSegmentsResult>;
  openPath: (filePath: string) => Promise<void>;
};

declare global {
  interface Window {
    quickCutAPI?: QuickCutAPI;
  }
}

export {};
