import type { ZubaAPI, SegmentRange } from '../types/zuba';
import {
  buildSubtitleEntry,
  findActiveSubtitle,
  formatTime,
  SubtitleEntry,
  SubtitleStyles,
  DEFAULT_SUBTITLE_POSITION,
  SubtitlePosition
} from './utils/subtitle.js';
import { extractVideoPathFromText } from './utils/filePath.js';

const ensureElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`${selector} が見つかりません`);
  }
  return element as T;
};

const video = ensureElement<HTMLVideoElement>('#previewVideo');
const dropZone = ensureElement<HTMLDivElement>('#dropZone');
const dropHint = ensureElement<HTMLDivElement>('#dropHint');
const chooseFileBtn = ensureElement<HTMLButtonElement>('#chooseFileBtn');
const hiddenFileInput = ensureElement<HTMLInputElement>('#hiddenFileInput');
const currentTimeLabel = ensureElement<HTMLSpanElement>('#currentTime');
const durationLabel = ensureElement<HTMLSpanElement>('#duration');
const videoNameLabel = ensureElement<HTMLSpanElement>('#videoName');
const cutList = ensureElement<HTMLUListElement>('#cutList');
const subtitleList = ensureElement<HTMLUListElement>('#subtitleList');
const subtitleOverlay = ensureElement<HTMLDivElement>('#subtitleOverlay');
const subtitleForm = ensureElement<HTMLFormElement>('#subtitleForm');
const subtitleText = ensureElement<HTMLTextAreaElement>('#subtitleText');
const subtitleStart = ensureElement<HTMLInputElement>('#subtitleStart');
const subtitleEnd = ensureElement<HTMLInputElement>('#subtitleEnd');
const fontColor = ensureElement<HTMLInputElement>('#fontColor');
const bgColor = ensureElement<HTMLInputElement>('#bgColor');
const fontFamily = ensureElement<HTMLSelectElement>('#fontFamily');
const fontSize = ensureElement<HTMLInputElement>('#fontSize');
const clearSubtitleFormBtn = ensureElement<HTMLButtonElement>('#clearSubtitleForm');
const addCutBtn = ensureElement<HTMLButtonElement>('#addCutBtn');
const deleteCutBtn = ensureElement<HTMLButtonElement>('#deleteCutBtn');
const addSubtitleBtn = ensureElement<HTMLButtonElement>('#addSubtitleBtn');
const exportCutsBtn = ensureElement<HTMLButtonElement>('#exportCutsBtn');
const exportStatusLabel = ensureElement<HTMLSpanElement>('#exportStatus');
const openExportBtn = ensureElement<HTMLButtonElement>('#openExportBtn');
const undoBtn = ensureElement<HTMLButtonElement>('#undoBtn');
const redoBtn = ensureElement<HTMLButtonElement>('#redoBtn');
const videoTrack = ensureElement<HTMLDivElement>('#videoTrack');
const videoTrackEmpty = ensureElement<HTMLDivElement>('#videoTrackEmpty');
const videoTrackStartLabel = ensureElement<HTMLSpanElement>('#videoTrackStart');
const videoTrackEndLabel = ensureElement<HTMLSpanElement>('#videoTrackEnd');
const videoPlayhead = ensureElement<HTMLDivElement>('#videoPlayhead');
const subtitleTrack = ensureElement<HTMLDivElement>('#subtitleTrack');
const subtitleTrackEmpty = ensureElement<HTMLDivElement>('#subtitleTrackEmpty');
const subtitleTrackStartLabel = ensureElement<HTMLSpanElement>('#subtitleTrackStart');
const subtitleTrackEndLabel = ensureElement<HTMLSpanElement>('#subtitleTrackEnd');

const setChooseFileButtonVisibility = (visible: boolean) => {
  if (visible) {
    chooseFileBtn.hidden = false;
    chooseFileBtn.textContent = '別の動画を開く';
  } else {
    chooseFileBtn.hidden = true;
  }
};

subtitleOverlay.tabIndex = 0;
subtitleOverlay.setAttribute('role', 'textbox');
subtitleOverlay.setAttribute('aria-label', '再生中の字幕');

interface VideoSegment {
  id: string;
  start: number;
  end: number;
}

interface AppState {
  segments: VideoSegment[];
  selectedSegmentId: string | null;
  subtitles: SubtitleEntry[];
  selectedSubtitleId: string | null;
  videoName: string;
  videoPath: string | null;
}

const state: AppState = {
  segments: [],
  selectedSegmentId: null,
  subtitles: [],
  selectedSubtitleId: null,
  videoName: '',
  videoPath: null
};

let objectUrl: string | null = null;
const zubaAPI: ZubaAPI | undefined = window.zubaAPI;
let overlayEditingId: string | null = null;
let dropZoneDragDepth = 0;

const defaultStyles: SubtitleStyles = {
  fontColor: '#ffffff',
  backgroundColor: '#222222',
  fontSize: 28,
  fontFamily: "'Noto Sans JP', sans-serif"
};

const MIN_SUBTITLE_DURATION = 0.25;
const MIN_TRACK_PERCENT = 1;
const MIN_SEGMENT_DURATION = 0.1;
const CUT_EPSILON = 0.01;
const SUBTITLE_LANE_HEIGHT = 28;
const SUBTITLE_LANE_GAP = 6;
const SUBTITLE_POSITION_PADDING = 4;
const MIN_EXPORT_SUBTITLE_DURATION = 0.05;

type SubtitleExportPayload = {
  id: string;
  text: string;
  start: number;
  end: number;
  styles: SubtitleStyles;
  position: SubtitlePosition;
};

let cutSeekInProgress = false;
let exportInProgress = false;
let lastExportPath: string | null = null;

type HistorySnapshot = {
  segments: VideoSegment[];
  subtitles: SubtitleEntry[];
  selectedSegmentId: string | null;
  selectedSubtitleId: string | null;
  videoTime: number;
};

const undoStack: HistorySnapshot[] = [];
const redoStack: HistorySnapshot[] = [];
const MAX_HISTORY = 50;
const historyDisabled = () => !video.src;

const cloneSubtitleForHistory = (entry: SubtitleEntry): SubtitleEntry => ({
  ...entry,
  styles: { ...entry.styles },
  position: { ...(entry.position ?? DEFAULT_SUBTITLE_POSITION) }
});

const getVideoDisplayScale = () => {
  const rect = video.getBoundingClientRect();
  if (!rect.height || !video.videoHeight) {
    return 1;
  }
  return video.videoHeight / rect.height;
};

const convertFontSizeForExport = (fontSizeValue: number) => {
  const base = Number.isFinite(fontSizeValue) && fontSizeValue > 0 ? fontSizeValue : defaultStyles.fontSize;
  const scale = getVideoDisplayScale();
  return Math.max(8, Math.round(base * scale));
};

const createHistorySnapshot = (): HistorySnapshot => ({
  segments: state.segments.map((segment) => ({ ...segment })),
  subtitles: state.subtitles.map((subtitle) => cloneSubtitleForHistory(subtitle)),
  selectedSegmentId: state.selectedSegmentId,
  selectedSubtitleId: state.selectedSubtitleId,
  videoTime: video.currentTime || 0
});

const applyHistorySnapshot = (snapshot: HistorySnapshot) => {
  state.segments = snapshot.segments.map((segment) => ({ ...segment }));
  state.subtitles = snapshot.subtitles.map((subtitle) => ({
    ...subtitle,
    styles: { ...subtitle.styles },
    position: { ...subtitle.position }
  }));
  state.selectedSegmentId = snapshot.selectedSegmentId;
  state.selectedSubtitleId = snapshot.selectedSubtitleId;
  refreshSegmentsUI();
  renderSubtitleList();
  if (Number.isFinite(snapshot.videoTime) && video.duration) {
    video.currentTime = clamp(snapshot.videoTime, 0, video.duration);
  }
};

const updateUndoRedoButtons = () => {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
};

const pushUndoSnapshot = () => {
  if (historyDisabled()) return;
  undoStack.push(createHistorySnapshot());
  if (undoStack.length > MAX_HISTORY) {
    undoStack.splice(0, undoStack.length - MAX_HISTORY);
  }
  redoStack.length = 0;
  updateUndoRedoButtons();
};

const resetHistoryStacks = () => {
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtons();
};

const undoLastChange = () => {
  if (undoStack.length === 0) return;
  redoStack.push(createHistorySnapshot());
  const snapshot = undoStack.pop();
  if (snapshot) {
    applyHistorySnapshot(snapshot);
  }
  updateUndoRedoButtons();
};

const redoLastUndo = () => {
  if (redoStack.length === 0) return;
  undoStack.push(createHistorySnapshot());
  const snapshot = redoStack.pop();
  if (snapshot) {
    applyHistorySnapshot(snapshot);
  }
  updateUndoRedoButtons();
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const clampPositionValue = (value: number, fallback: number) =>
  clamp(Number.isFinite(value) ? value : fallback, SUBTITLE_POSITION_PADDING, 100 - SUBTITLE_POSITION_PADDING);

const ensureSubtitlePosition = (entry: SubtitleEntry): SubtitlePosition => {
  const base = entry.position ?? { ...DEFAULT_SUBTITLE_POSITION };
  const position: SubtitlePosition = {
    xPercent: clampPositionValue(base.xPercent, DEFAULT_SUBTITLE_POSITION.xPercent),
    yPercent: clampPositionValue(base.yPercent, DEFAULT_SUBTITLE_POSITION.yPercent)
  };
  entry.position = position;
  return position;
};

const enforceDecimalPrecision = (input: HTMLInputElement) => {
  input.addEventListener('input', () => {
    const { value } = input;
    if (!value.includes('.')) return;
    const [intPart, decimalPart] = value.split('.');
    if (decimalPart && decimalPart.length > 2) {
      input.value = `${intPart}.${decimalPart.slice(0, 2)}`;
    }
  });
  input.addEventListener('blur', () => {
    if (!input.value) return;
    const parsed = Number(input.value);
    if (Number.isNaN(parsed)) {
      input.value = '';
      return;
    }
    input.value = (Math.floor(parsed * 100) / 100).toFixed(2);
  });
};

enforceDecimalPrecision(subtitleStart);
enforceDecimalPrecision(subtitleEnd);

const updateSubtitlePosition = (entry: SubtitleEntry, newPosition: SubtitlePosition) => {
  const next = {
    xPercent: clampPositionValue(newPosition.xPercent, DEFAULT_SUBTITLE_POSITION.xPercent),
    yPercent: clampPositionValue(newPosition.yPercent, DEFAULT_SUBTITLE_POSITION.yPercent)
  };
  const current = entry.position ?? DEFAULT_SUBTITLE_POSITION;
  if (Math.abs(current.xPercent - next.xPercent) < 0.1 && Math.abs(current.yPercent - next.yPercent) < 0.1) {
    return;
  }
  pushUndoSnapshot();
  entry.position = next;
};

type ExportStatus = 'idle' | 'success' | 'error' | 'progress';

const exportStatusClasses: ExportStatus[] = ['success', 'error', 'progress'];

const setExportStatus = (message: string, status: ExportStatus = 'idle') => {
  exportStatusLabel.textContent = message;
  exportStatusClasses.forEach((cls) => {
    exportStatusLabel.classList.toggle(cls, cls === status && status !== 'idle');
  });
};

const updateExportButtonState = () => {
  exportCutsBtn.disabled = exportInProgress || !state.videoPath || state.segments.length === 0;
};

const updateExportOpenButton = () => {
  openExportBtn.disabled = !lastExportPath;
};

const shortenPath = (filePath: string) => {
  if (!filePath) return '';
  return filePath.length > 45 ? `...${filePath.slice(-45)}` : filePath;
};

const prepareSegmentsForExport = (): SegmentRange[] =>
  [...state.segments]
    .sort((a, b) => a.start - b.start)
    .map((segment) => ({ start: Number(segment.start.toFixed(3)), end: Number(segment.end.toFixed(3)) }));

const prepareSubtitlesForExport = (): SubtitleExportPayload[] => {
  const sortedSegments = [...state.segments].sort((a, b) => a.start - b.start);
  const results: SubtitleExportPayload[] = [];
  let offset = 0;
  sortedSegments.forEach((segment) => {
    const segmentDuration = Math.max(segment.end - segment.start, 0);
    if (segmentDuration <= 0) {
      return;
    }
    state.subtitles.forEach((subtitle) => {
      const overlapStart = Math.max(segment.start, subtitle.start);
      const overlapEnd = Math.min(segment.end, subtitle.end);
      if (overlapEnd - overlapStart >= MIN_EXPORT_SUBTITLE_DURATION) {
        const relativeStart = overlapStart - segment.start + offset;
        const relativeEnd = overlapEnd - segment.start + offset;
        const position = ensureSubtitlePosition(subtitle);
        results.push({
          id: subtitle.id,
          text: subtitle.text,
          start: Number(relativeStart.toFixed(3)),
          end: Number(relativeEnd.toFixed(3)),
          styles: {
            ...subtitle.styles,
            fontSize: convertFontSizeForExport(subtitle.styles.fontSize)
          },
          position: { ...position }
        });
      }
    });
    offset += segmentDuration;
  });
  return results;
};

const sortSegmentsInPlace = () => {
  state.segments.sort((a, b) => a.start - b.start);
};

const findSegmentAtTime = (time: number) =>
  state.segments.find((segment) => time >= segment.start - CUT_EPSILON && time <= segment.end - CUT_EPSILON);

const findNextSegmentAfter = (time: number) => state.segments.find((segment) => segment.start > time + CUT_EPSILON);

const generateId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const resetState = () => {
  state.segments = [];
  state.selectedSegmentId = null;
  state.subtitles = [];
  state.selectedSubtitleId = null;
  overlayEditingId = null;
  subtitleOverlay.innerHTML = '';
  subtitleOverlay.style.display = 'none';
  lastExportPath = null;
  resetHistoryStacks();
  updateSegmentList();
  renderVideoTrack();
  renderSubtitleList();
  videoNameLabel.textContent = state.videoName || '未選択';
  setExportStatus('');
  updateExportButtonState();
  updateExportOpenButton();
};

const cleanupObjectUrl = () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
};

const clearLoadedVideo = () => {
  cleanupObjectUrl();
  if (video.src) {
    video.removeAttribute('src');
    video.load();
  }
};

const setVideoSource = (src: string) => {
  if (!src) return;
  video.src = src;
  dropHint.style.display = 'none';
  setChooseFileButtonVisibility(true);
  resetState();
};

const openVideoFromFile = async (file: File) => {
  if (!file) return;
  if (zubaAPI?.cacheVideoFile) {
    try {
      setExportStatus('動画を読み込んでいます...', 'progress');
      const buffer = await file.arrayBuffer();
      const cachedPath = await zubaAPI.cacheVideoFile(file.name || 'video', buffer);
      if (cachedPath) {
        openVideoFromPath(cachedPath, file.name || 'Untitled');
        setExportStatus('');
        return;
      }
    } catch (error) {
      console.error('[renderer] failed to cache temp video', error);
      setExportStatus('動画の一時保存に失敗しました', 'error');
    }
  }
  cleanupObjectUrl();
  objectUrl = URL.createObjectURL(file);
  state.videoName = file.name || 'Untitled';
  state.videoPath = null;
  videoNameLabel.textContent = state.videoName;
  setVideoSource(objectUrl);
  setExportStatus('この取り込み方法では書き出しは無効です。ファイルパスを貼り付けてください。', 'error');
};

const openVideoFromPath = (filePath: string, displayName?: string) => {
  if (!filePath || !zubaAPI?.pathToFileUrl) return;
  cleanupObjectUrl();
  const fileUrl = zubaAPI.pathToFileUrl(filePath);
  if (!fileUrl) return;
  state.videoName = displayName ?? filePath.split(/[/\\]/).pop() ?? 'Untitled';
  state.videoPath = filePath;
  videoNameLabel.textContent = state.videoName;
  setVideoSource(fileUrl);
};

const handleFiles = async (fileList: FileList | null) => {
  if (!fileList || fileList.length === 0) return;
  const fileArray = Array.from(fileList);
  const file = fileArray.find((f) => f.type.startsWith('video')) ?? fileArray[0];
  const fileWithPath = file as File & { path?: string };
  try {
    if (fileWithPath.path && zubaAPI?.pathToFileUrl) {
      openVideoFromPath(fileWithPath.path, file.name);
      return;
    }
    await openVideoFromFile(file);
  } catch (error) {
    console.error('[renderer] failed to handle dropped file', error);
    setExportStatus('動画の読み込みに失敗しました', 'error');
  }
};

const handlePathText = (text: string | null | undefined) => {
  const parsedPath = extractVideoPathFromText(text ?? '');
  if (!parsedPath) {
    return false;
  }
  openVideoFromPath(parsedPath);
  return true;
};

const updateSegmentList = () => {
  cutList.innerHTML = '';
  state.segments.forEach((segment, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>パート ${index + 1}</span><span>${formatTime(segment.start)} → ${formatTime(segment.end)}</span>`;
    if (segment.id === state.selectedSegmentId) {
      li.classList.add('active');
    }
    li.addEventListener('click', () => {
      selectSegment(segment.id);
    });
    cutList.appendChild(li);
  });
};

const highlightVideoTrack = (segmentId: string | null) => {
  const blocks = videoTrack.querySelectorAll<HTMLDivElement>('.video-segment-block');
  blocks.forEach((block) => {
    block.classList.toggle('active', block.dataset.id === segmentId);
  });
};

const videoScrubState: { active: boolean; pointerId: number | null; wasPlaying: boolean } = {
  active: false,
  pointerId: null,
  wasPlaying: false
};

const seekVideoByPointer = (clientX: number) => {
  const rect = videoTrack.getBoundingClientRect();
  if (!rect.width || !video.duration) return;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  video.currentTime = ratio * video.duration;
  updatePlayhead();
  applySubtitleOverlay();
};

const renderVideoTrack = () => {
  const duration = video.duration || 0;
  videoTrack.querySelectorAll('.video-segment-block').forEach((node) => node.remove());
  const hasSegments = Boolean(video.src && duration > 0 && state.segments.length > 0);
  videoTrackEmpty.style.display = hasSegments ? 'none' : 'flex';
  videoPlayhead.style.display = hasSegments ? 'block' : 'none';
  if (!hasSegments) {
    highlightVideoTrack(null);
    return;
  }

  state.segments.forEach((segment) => {
    const block = document.createElement('div');
    block.className = 'video-segment-block';
    block.dataset.id = segment.id;
    block.innerHTML = `<span>${formatTime(segment.start)} → ${formatTime(segment.end)}</span>`;
    const len = Math.max(segment.end - segment.start, MIN_SEGMENT_DURATION);
    const widthPercent = clamp((len / duration) * 100, MIN_TRACK_PERCENT, 100);
    const leftPercent = clamp((segment.start / duration) * 100, 0, 100 - widthPercent);
    block.style.width = `${widthPercent}%`;
    block.style.left = `${leftPercent}%`;
    block.addEventListener('click', () => {
      selectSegment(segment.id);
    });
    videoTrack.appendChild(block);
  });
  highlightVideoTrack(state.selectedSegmentId);
};

const selectSegment = (segmentId: string | null) => {
  if (state.selectedSegmentId === segmentId) {
    highlightVideoTrack(segmentId);
    return;
  }
  state.selectedSegmentId = segmentId;
  updateSegmentList();
  highlightVideoTrack(segmentId);
};

const refreshSegmentsUI = () => {
  sortSegmentsInPlace();
  updateSegmentList();
  renderVideoTrack();
  updateExportButtonState();
};

const enforceSegmentPlayback = () => {
  if (!video.src || state.segments.length === 0) {
    video.pause();
    return;
  }
  const now = video.currentTime || 0;
  const activeSegment = findSegmentAtTime(now);
  if (activeSegment) {
    if (state.selectedSegmentId !== activeSegment.id) {
      selectSegment(activeSegment.id);
    }
    return;
  }
  if (cutSeekInProgress) return;
  const nextSegment = findNextSegmentAfter(now);
  cutSeekInProgress = true;
  if (nextSegment) {
    const targetTime = nextSegment.start + CUT_EPSILON;
    video.currentTime = clamp(targetTime, 0, video.duration || targetTime);
  } else {
    video.pause();
    const last = state.segments[state.segments.length - 1];
    if (last) {
      video.currentTime = clamp(last.end, 0, video.duration || last.end);
    }
  }
  window.setTimeout(() => {
    cutSeekInProgress = false;
  }, 0);
};

const seedSegmentsForVideo = () => {
  const duration = video.duration || 0;
  if (!video.src || duration <= 0) {
    state.segments = [];
    state.selectedSegmentId = null;
    refreshSegmentsUI();
    return;
  }
  state.segments = [
    {
      id: generateId(),
      start: 0,
      end: duration
    }
  ];
  sortSegmentsInPlace();
  state.selectedSegmentId = state.segments[0]?.id ?? null;
  refreshSegmentsUI();
  enforceSegmentPlayback();
};

const ensureBaseSegment = () => {
  if (state.segments.length === 0) {
    seedSegmentsForVideo();
  }
};

const addCutAtCurrentTime = () => {
  if (!video.src) return;
  const duration = video.duration || 0;
  if (duration <= 0) return;
  ensureBaseSegment();
  sortSegmentsInPlace();
  const time = clamp(video.currentTime || 0, 0, duration);
  const targetIndex = state.segments.findIndex((segment) => time > segment.start + CUT_EPSILON && time < segment.end - CUT_EPSILON);
  if (targetIndex === -1) return;
  const target = state.segments[targetIndex];
  const firstHalf: VideoSegment = {
    ...target,
    end: time
  };
  const secondHalf: VideoSegment = {
    id: generateId(),
    start: time,
    end: target.end
  };
  if (secondHalf.end - secondHalf.start < MIN_SEGMENT_DURATION || firstHalf.end - firstHalf.start < MIN_SEGMENT_DURATION) {
    return;
  }
  pushUndoSnapshot();
  state.segments.splice(targetIndex, 1, firstHalf, secondHalf);
  state.selectedSegmentId = secondHalf.id;
  refreshSegmentsUI();
  enforceSegmentPlayback();
};

const deleteSelectedSegment = () => {
  if (!state.selectedSegmentId) return;
  sortSegmentsInPlace();
  const index = state.segments.findIndex((segment) => segment.id === state.selectedSegmentId);
  if (index === -1) return;
  pushUndoSnapshot();
  state.segments.splice(index, 1);
  if (state.segments.length === 0) {
    clearLoadedVideo();
    return;
  }
  const fallback = state.segments[index] ?? state.segments[index - 1] ?? null;
  state.selectedSegmentId = fallback?.id ?? null;
  refreshSegmentsUI();
  enforceSegmentPlayback();
};

const exportCuts = async () => {
  if (!zubaAPI?.exportCuts) {
    setExportStatus('書き出し機能が利用できません', 'error');
    return;
  }
  if (!state.videoPath) {
    setExportStatus('元動画のパスが取得できませんでした', 'error');
    return;
  }
  const segments = prepareSegmentsForExport();
  if (segments.length === 0) {
    setExportStatus('書き出すカットがありません', 'error');
    return;
  }
  const subtitlesForExport = prepareSubtitlesForExport();
  const videoWidth = Math.round(video.videoWidth || 0);
  const videoHeight = Math.round(video.videoHeight || 0);
  try {
    exportInProgress = true;
    updateExportButtonState();
    setExportStatus('書き出し中...', 'progress');
    console.log('[renderer] exporting', {
      segmentCount: segments.length,
      subtitleCount: subtitlesForExport.length,
      videoWidth,
      videoHeight
    });
    const result = await zubaAPI.exportCuts({
      sourcePath: state.videoPath,
      segments,
      subtitles: subtitlesForExport,
      videoWidth,
      videoHeight
    });
    if (result.success) {
      const location = result.outputPath ? shortenPath(result.outputPath) : '';
      setExportStatus(location ? `保存しました: ${location}` : '保存しました', 'success');
      lastExportPath = result.outputPath ?? null;
      updateExportOpenButton();
    } else if (result.canceled) {
      setExportStatus('書き出しをキャンセルしました');
      lastExportPath = null;
      updateExportOpenButton();
    } else {
      setExportStatus(result.error ?? '書き出しに失敗しました', 'error');
      lastExportPath = null;
      updateExportOpenButton();
    }
  } catch (error) {
    setExportStatus(error instanceof Error ? error.message : '書き出しに失敗しました', 'error');
    lastExportPath = null;
    updateExportOpenButton();
  } finally {
    exportInProgress = false;
    updateExportButtonState();
  }
};

const renderSubtitleList = () => {
  subtitleList.innerHTML = '';
  [...state.subtitles]
    .sort((a, b) => a.start - b.start)
    .forEach((item) => {
      const li = document.createElement('li');
      const timeSpan = document.createElement('span');
      timeSpan.textContent = `${formatTime(item.start)} → ${formatTime(item.end)}`;
      const textSpan = document.createElement('span');
      textSpan.textContent = item.text || '（無題）';
      li.appendChild(timeSpan);
      li.appendChild(textSpan);
      if (item.id === state.selectedSubtitleId) {
        li.classList.add('active');
      }
      li.addEventListener('click', () => {
        beginSubtitleEditing(item, { focusText: true });
      });
      subtitleList.appendChild(li);
    });
  renderSubtitleTrack();
  applySubtitleOverlay();
};

const updateSubtitleTiming = (id: string, start: number, end: number) => {
  const entry = state.subtitles.find((item) => item.id === id);
  if (!entry) return;
  const total = video.duration || 0;
  const duration = Math.max(end - start, MIN_SUBTITLE_DURATION);
  const safeStart = clamp(start, 0, total > 0 ? Math.max(total - duration, 0) : start);
  const safeEnd = safeStart + duration;
  if (Math.abs(entry.start - safeStart) < 0.001 && Math.abs(entry.end - safeEnd) < 0.001) {
    return;
  }
  pushUndoSnapshot();
  entry.start = Number(safeStart.toFixed(2));
  entry.end = Number(safeEnd.toFixed(2));
  if (state.selectedSubtitleId === entry.id) {
    subtitleStart.value = entry.start.toFixed(2);
    subtitleEnd.value = entry.end.toFixed(2);
  }
  renderSubtitleList();
};

const fillSubtitleFormFromEntry = (entry: SubtitleEntry | null) => {
  if (!entry) return;
  subtitleText.value = entry.text;
  subtitleStart.value = entry.start.toFixed(2);
  subtitleEnd.value = entry.end.toFixed(2);
  fontColor.value = entry.styles.fontColor;
  bgColor.value = entry.styles.backgroundColor;
  fontSize.value = entry.styles.fontSize.toString();
  fontFamily.value = entry.styles.fontFamily;
};

const beginSubtitleEditing = (entry: SubtitleEntry, options?: { focusText?: boolean; scrollIntoView?: boolean }) => {
  if (overlayEditingId && overlayEditingId !== entry.id) {
    endOverlayInlineEditing(true);
  }
  state.selectedSubtitleId = entry.id;
  fillSubtitleFormFromEntry(entry);
  renderSubtitleList();
  if (options?.scrollIntoView) {
    subtitleForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (options?.focusText) {
    subtitleText.focus();
  }
};

const focusOverlayEditable = (entryId: string) => {
  requestAnimationFrame(() => {
    const element = subtitleOverlay.querySelector<HTMLDivElement>(`.subtitle-overlay-item[data-id="${entryId}"]`);
    if (!element) return;
    element.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
};

const startOverlayInlineEditing = (target?: SubtitleEntry | null) => {
  const entry =
    target ??
    (() => {
      const now = video.currentTime || 0;
      return state.subtitles.find((item) => now >= item.start && now <= item.end) ?? null;
    })();
  if (!entry) return;
  if (overlayEditingId && overlayEditingId !== entry.id) {
    endOverlayInlineEditing(true);
  }
  overlayEditingId = entry.id;
  beginSubtitleEditing(entry, { focusText: false });
  focusOverlayEditable(entry.id);
};

const endOverlayInlineEditing = (commit: boolean) => {
  if (!overlayEditingId) return;
  const entry = state.subtitles.find((item) => item.id === overlayEditingId);
  const element = subtitleOverlay.querySelector<HTMLDivElement>(`.subtitle-overlay-item[data-id="${overlayEditingId}"]`);
  if (commit && entry && element) {
    const nextText = element.textContent?.trim() ?? '';
    if (nextText !== entry.text) {
      pushUndoSnapshot();
      entry.text = nextText;
      if (state.selectedSubtitleId === entry.id) {
        fillSubtitleFormFromEntry(entry);
      }
    }
  } else if (entry && element) {
    element.textContent = entry.text;
  }
  overlayEditingId = null;
  renderSubtitleList();
};

const enableSubtitleDrag = (block: HTMLDivElement, subtitle: SubtitleEntry, totalDuration: number) => {
  let dragState: { pointerId: number; startX: number; baseStart: number; span: number; moved: boolean } | null = null;

  const pxToSeconds = (deltaPx: number) => {
    const rect = subtitleTrack.getBoundingClientRect();
    if (!rect.width) return 0;
    return (deltaPx / rect.width) * totalDuration;
  };

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      baseStart: subtitle.start,
      span: Math.max(subtitle.end - subtitle.start, MIN_SUBTITLE_DURATION),
      moved: false
    };
    block.setPointerCapture(event.pointerId);
    block.classList.add('dragging');
    event.preventDefault();
  };

  const pointerMove = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - dragState.startX) > 1) {
      dragState.moved = true;
    }
    const deltaSeconds = pxToSeconds(event.clientX - dragState.startX);
    const newStart = clamp(dragState.baseStart + deltaSeconds, 0, Math.max(totalDuration - dragState.span, 0));
    const percent = (newStart / totalDuration) * 100;
    block.style.left = `${percent}%`;
    block.dataset.previewStart = newStart.toString();
    block.dataset.previewEnd = (newStart + dragState.span).toString();
    event.preventDefault();
  };

  const pointerUp = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    block.releasePointerCapture(event.pointerId);
    block.classList.remove('dragging');
    const previewStart = parseFloat(block.dataset.previewStart ?? `${subtitle.start}`);
    const previewEnd = parseFloat(block.dataset.previewEnd ?? `${subtitle.end}`);
    const wasMoved = dragState.moved;
    dragState = null;
    updateSubtitleTiming(subtitle.id, previewStart, previewEnd);
    if (wasMoved) {
      block.dataset.dragSkip = 'true';
      window.setTimeout(() => {
        block.dataset.dragSkip = 'false';
      }, 0);
    }
    event.preventDefault();
  };

  block.addEventListener('pointerdown', pointerDown);
  block.addEventListener('pointermove', pointerMove);
  block.addEventListener('pointerup', pointerUp);
  block.addEventListener('pointercancel', pointerUp);
};

const enableSubtitleResizeHandle = (
  block: HTMLDivElement,
  handle: HTMLDivElement,
  subtitle: SubtitleEntry,
  totalDuration: number,
  edge: 'start' | 'end'
) => {
  if (totalDuration <= 0) return;
  const pxToSeconds = (deltaPx: number) => {
    const rect = subtitleTrack.getBoundingClientRect();
    if (!rect.width) return 0;
    return (deltaPx / rect.width) * totalDuration;
  };

  let resizeState:
    | {
        pointerId: number;
        startX: number;
        originalStart: number;
        originalEnd: number;
        previewStart: number;
        previewEnd: number;
        moved: boolean;
      }
    | null = null;

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      originalStart: subtitle.start,
      originalEnd: subtitle.end,
      previewStart: subtitle.start,
      previewEnd: subtitle.end,
      moved: false
    };
    handle.setPointerCapture(event.pointerId);
    block.classList.add('resizing');
    block.dataset.resizeSkip = 'true';
  };

  const pointerMove = (event: PointerEvent) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const deltaSeconds = pxToSeconds(event.clientX - resizeState.startX);
    if (edge === 'start') {
      const newStart = clamp(
        resizeState.originalStart + deltaSeconds,
        0,
        Math.max(resizeState.originalEnd - MIN_SUBTITLE_DURATION, 0)
      );
      resizeState.previewStart = newStart;
    } else {
      const newEnd = clamp(
        resizeState.originalEnd + deltaSeconds,
        resizeState.originalStart + MIN_SUBTITLE_DURATION,
        totalDuration
      );
      resizeState.previewEnd = newEnd;
    }
    resizeState.moved = true;
    const previewLen = Math.max(resizeState.previewEnd - resizeState.previewStart, MIN_SUBTITLE_DURATION);
    const leftPercent = clamp((resizeState.previewStart / totalDuration) * 100, 0, 100);
    const widthPercent = clamp((previewLen / totalDuration) * 100, MIN_TRACK_PERCENT, 100);
    block.style.left = `${leftPercent}%`;
    block.style.width = `${widthPercent}%`;
  };

  const pointerUp = (event: PointerEvent) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    handle.releasePointerCapture(event.pointerId);
    block.classList.remove('resizing');
    block.dataset.resizeSkip = 'false';
    if (resizeState.moved) {
      block.dataset.dragSkip = 'true';
      updateSubtitleTiming(subtitle.id, resizeState.previewStart, resizeState.previewEnd);
      requestAnimationFrame(() => {
        block.dataset.dragSkip = 'false';
      });
    }
    resizeState = null;
  };

  handle.addEventListener('pointerdown', pointerDown);
  handle.addEventListener('pointermove', pointerMove);
  handle.addEventListener('pointerup', pointerUp);
  handle.addEventListener('pointercancel', pointerUp);
};

const highlightSubtitleTrack = (activeId: string | null) => {
  const blocks = subtitleTrack.querySelectorAll<HTMLDivElement>('.subtitle-block');
  blocks.forEach((block) => {
    const blockId = block.dataset.id;
    const shouldHighlight = Boolean((activeId && blockId === activeId) || (state.selectedSubtitleId && blockId === state.selectedSubtitleId));
    block.classList.toggle('active', shouldHighlight);
  });
};

const renderSubtitleTrack = () => {
  const duration = video.duration || 0;
  const hasTrack = Boolean(video.src && duration > 0 && state.subtitles.length > 0);
  subtitleTrack.querySelectorAll('.subtitle-block').forEach((node) => node.remove());
  subtitleTrackEmpty.style.display = hasTrack ? 'none' : 'flex';
  if (!hasTrack) {
    subtitleTrack.style.height = '';
    highlightSubtitleTrack(null);
    return;
  }

  const sorted = [...state.subtitles].sort((a, b) => a.start - b.start);
  const laneEndTimes: number[] = [];
  const layout = sorted.map((subtitle) => {
    let laneIndex = laneEndTimes.findIndex((end) => subtitle.start >= end - MIN_SUBTITLE_DURATION / 2);
    if (laneIndex === -1) {
      laneIndex = laneEndTimes.length;
      laneEndTimes.push(subtitle.end);
    } else {
      laneEndTimes[laneIndex] = Math.max(subtitle.end, laneEndTimes[laneIndex]);
    }
    return { subtitle, laneIndex };
  });
  const laneCount = laneEndTimes.length || 1;
  const trackHeight = Math.max(
    64,
    laneCount * SUBTITLE_LANE_HEIGHT + Math.max(0, laneCount - 1) * SUBTITLE_LANE_GAP + 16
  );
  subtitleTrack.style.height = `${trackHeight}px`;

  layout.forEach(({ subtitle, laneIndex }) => {
    const block = document.createElement('div');
    block.className = 'subtitle-block';
    block.dataset.id = subtitle.id;
    block.textContent = subtitle.text || '（無題）';
    block.style.backgroundColor = subtitle.styles.backgroundColor;
    block.style.color = subtitle.styles.fontColor;
    const len = Math.max(subtitle.end - subtitle.start, MIN_SUBTITLE_DURATION);
    const widthPercent = clamp((len / duration) * 100, MIN_TRACK_PERCENT, 100);
    const leftPercent = clamp((subtitle.start / duration) * 100, 0, 100 - widthPercent);
    block.style.width = `${widthPercent}%`;
    block.style.left = `${leftPercent}%`;
    block.style.top = `${8 + laneIndex * (SUBTITLE_LANE_HEIGHT + SUBTITLE_LANE_GAP)}px`;
    block.style.height = `${SUBTITLE_LANE_HEIGHT}px`;
    block.addEventListener('click', (event) => {
      event.stopPropagation();
      if (block.dataset.dragSkip === 'true' || block.dataset.resizeSkip === 'true') return;
      beginSubtitleEditing(subtitle, { focusText: false, scrollIntoView: true });
    });
    const leftHandle = document.createElement('div');
    leftHandle.className = 'subtitle-handle left';
    const rightHandle = document.createElement('div');
    rightHandle.className = 'subtitle-handle right';
    block.appendChild(leftHandle);
    block.appendChild(rightHandle);
    subtitleTrack.appendChild(block);
    enableSubtitleDrag(block, subtitle, duration);
    enableSubtitleResizeHandle(block, leftHandle, subtitle, duration, 'start');
    enableSubtitleResizeHandle(block, rightHandle, subtitle, duration, 'end');
  });
  const active = findActiveSubtitle(state.subtitles, video.currentTime || 0);
  highlightSubtitleTrack(active?.id ?? null);
};

const updateTrackLabels = () => {
  subtitleTrackStartLabel.textContent = '0.00s';
  subtitleTrackEndLabel.textContent = formatTime(video.duration || 0);
};

const deleteSelectedSubtitle = () => {
  if (!state.selectedSubtitleId) return;
  const targetId = state.selectedSubtitleId;
  if (overlayEditingId && overlayEditingId === targetId) {
    endOverlayInlineEditing(false);
  }
  pushUndoSnapshot();
  state.subtitles = state.subtitles.filter((item) => item.id !== targetId);
  state.selectedSubtitleId = null;
  renderSubtitleList();
  applySubtitleOverlay();
};

const clearSubtitleForm = () => {
  state.selectedSubtitleId = null;
  subtitleText.value = '';
  const now = video.currentTime || 0;
  subtitleStart.value = now.toFixed(2);
  subtitleEnd.value = (now + 2).toFixed(2);
  fontColor.value = defaultStyles.fontColor;
  bgColor.value = defaultStyles.backgroundColor;
  fontSize.value = defaultStyles.fontSize.toString();
  fontFamily.value = defaultStyles.fontFamily;
  renderSubtitleList();
};

const prepareSubtitleAtCurrentTime = () => {
  if (!video.src) return;
  state.selectedSubtitleId = null;
  const now = video.currentTime || 0;
  subtitleStart.value = now.toFixed(2);
  subtitleEnd.value = (now + 2).toFixed(2);
  renderSubtitleList();
  subtitleText.focus();
  subtitleForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const upsertSubtitle = (event: SubmitEvent) => {
  event.preventDefault();
  if (!video.src) return;

  const start = parseFloat(subtitleStart.value);
  const end = parseFloat(subtitleEnd.value);
  if (Number.isNaN(start) || Number.isNaN(end)) return;

  const existingEntry = state.selectedSubtitleId
    ? state.subtitles.find((item) => item.id === state.selectedSubtitleId)
    : null;

  const entry = buildSubtitleEntry(
    {
      id: state.selectedSubtitleId ?? undefined,
      text: subtitleText.value,
      start,
      end,
      styles: {
        fontColor: fontColor.value,
        backgroundColor: bgColor.value,
        fontSize: parseInt(fontSize.value, 10) || defaultStyles.fontSize,
        fontFamily: fontFamily.value
      },
      position: existingEntry?.position ?? { ...DEFAULT_SUBTITLE_POSITION }
    },
    generateId
  );

  const existingIndex = state.subtitles.findIndex((item) => item.id === entry.id);
  pushUndoSnapshot();
  if (existingIndex >= 0) {
    state.subtitles.splice(existingIndex, 1, entry);
  } else {
    state.subtitles.push(entry);
  }
  state.selectedSubtitleId = entry.id;
  renderSubtitleList();
};

const getActiveSubtitlesAtTime = (time: number) =>
  state.subtitles.filter((item) => time >= item.start && time <= item.end);

const attachOverlayInlineHandlers = (element: HTMLDivElement, entry: SubtitleEntry) => {
  element.addEventListener('keydown', (event) => {
    if (overlayEditingId !== entry.id) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      endOverlayInlineEditing(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      endOverlayInlineEditing(false);
    }
  });
  element.addEventListener('blur', () => {
    if (overlayEditingId !== entry.id) return;
    endOverlayInlineEditing(true);
  });
};

const enableOverlayPositionDrag = (element: HTMLDivElement, entry: SubtitleEntry) => {
  let dragState:
    | {
        pointerId: number;
        moved: boolean;
        lastPosition: SubtitlePosition;
      }
    | null = null;

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || overlayEditingId === entry.id) return;
    dragState = {
      pointerId: event.pointerId,
      moved: false,
      lastPosition: { ...ensureSubtitlePosition(entry) }
    };
    element.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const overlayRect = subtitleOverlay.getBoundingClientRect();
    if (!overlayRect.width || !overlayRect.height) return;
    dragState.moved = true;
    element.classList.add('repositioning');
    const xPercent = clampPositionValue(
      ((event.clientX - overlayRect.left) / overlayRect.width) * 100,
      DEFAULT_SUBTITLE_POSITION.xPercent
    );
    const yPercent = clampPositionValue(
      ((event.clientY - overlayRect.top) / overlayRect.height) * 100,
      DEFAULT_SUBTITLE_POSITION.yPercent
    );
    dragState.lastPosition = { xPercent, yPercent };
    element.style.left = `${xPercent}%`;
    element.style.top = `${yPercent}%`;
    element.dataset.previewX = xPercent.toString();
    element.dataset.previewY = yPercent.toString();
  };

  const pointerUp = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    element.releasePointerCapture(event.pointerId);
    element.classList.remove('repositioning');
    if (dragState.moved) {
      const nextPosition = dragState.lastPosition;
      updateSubtitlePosition(entry, nextPosition);
      renderSubtitleList();
      element.dataset.skipClick = 'true';
      requestAnimationFrame(() => {
        element.dataset.skipClick = 'false';
      });
    }
    dragState = null;
  };

  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('pointermove', pointerMove);
  element.addEventListener('pointerup', pointerUp);
  element.addEventListener('pointercancel', pointerUp);
};

const applySubtitleOverlay = () => {
  subtitleOverlay.innerHTML = '';
  if (!video.src || state.subtitles.length === 0) {
    subtitleOverlay.style.display = 'none';
    highlightSubtitleTrack(null);
    return;
  }

  const now = video.currentTime || 0;
  const activeEntries = getActiveSubtitlesAtTime(now);
  if (overlayEditingId) {
    const editingEntry = state.subtitles.find((item) => item.id === overlayEditingId);
    if (editingEntry && !activeEntries.some((item) => item.id === editingEntry.id)) {
      activeEntries.push(editingEntry);
    }
  }

  if (activeEntries.length === 0) {
    subtitleOverlay.style.display = 'none';
    highlightSubtitleTrack(state.selectedSubtitleId);
    return;
  }

  subtitleOverlay.style.display = 'block';
  activeEntries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'subtitle-overlay-item';
    item.dataset.id = entry.id;
    const position = ensureSubtitlePosition(entry);
    item.style.left = `${position.xPercent}%`;
    item.style.top = `${position.yPercent}%`;
    item.style.fontSize = `${entry.styles.fontSize}px`;
    item.style.fontFamily = entry.styles.fontFamily;
    item.style.color = entry.styles.fontColor;
    item.style.backgroundColor = `${entry.styles.backgroundColor}cc`;
    item.textContent = entry.text || '（無題）';
    if (state.selectedSubtitleId === entry.id) {
      item.classList.add('selected');
    }
    if (overlayEditingId === entry.id) {
      item.classList.add('editing');
      item.contentEditable = 'true';
      item.setAttribute('role', 'textbox');
      item.tabIndex = 0;
    } else {
      item.contentEditable = 'false';
      item.removeAttribute('role');
      item.tabIndex = -1;
    }

    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (item.dataset.skipClick === 'true') return;
      beginSubtitleEditing(entry, { focusText: true, scrollIntoView: true });
    });

    item.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      startOverlayInlineEditing(entry);
    });

    attachOverlayInlineHandlers(item, entry);
    enableOverlayPositionDrag(item, entry);
    subtitleOverlay.appendChild(item);
  });

  if (overlayEditingId) {
    focusOverlayEditable(overlayEditingId);
  }

  const primaryActiveId = activeEntries[0]?.id ?? overlayEditingId ?? null;
  highlightSubtitleTrack(primaryActiveId);
};

video.addEventListener('loadedmetadata', () => {
  durationLabel.textContent = formatTime(video.duration || 0);
  clearSubtitleForm();
  updateVideoTrackLabels();
  seedSegmentsForVideo();
  updatePlayhead();
  updateTrackLabels();
  renderSubtitleTrack();
  enforceSegmentPlayback();
});

video.addEventListener('timeupdate', () => {
  enforceSegmentPlayback();
  currentTimeLabel.textContent = formatTime(video.currentTime || 0);
  updatePlayhead();
  applySubtitleOverlay();
});

video.addEventListener('seeking', updatePlayhead);
video.addEventListener('seeked', () => {
  updatePlayhead();
  enforceSegmentPlayback();
});

video.addEventListener('emptied', () => {
  durationLabel.textContent = '0.00s';
  currentTimeLabel.textContent = '0.00s';
  dropHint.style.display = 'block';
  videoTrackStartLabel.textContent = '0.00s';
  videoTrackEndLabel.textContent = '0.00s';
  videoPlayhead.style.display = 'none';
  state.segments = [];
  state.selectedSegmentId = null;
  state.videoPath = null;
  state.videoName = '';
  videoNameLabel.textContent = '未選択';
  lastExportPath = null;
  resetHistoryStacks();
  refreshSegmentsUI();
  subtitleTrackEndLabel.textContent = '0.00s';
  renderSubtitleTrack();
  setExportStatus('');
  updateExportButtonState();
  updateExportOpenButton();
  setChooseFileButtonVisibility(false);
});

videoTrack.addEventListener('pointerdown', (event) => {
  if (!video.src || !video.duration || event.button !== 0) return;
  const targetElement = event.target as HTMLElement | null;
  if (targetElement?.closest('.video-segment-block')) return;
  event.preventDefault();
  videoScrubState.active = true;
  videoScrubState.pointerId = event.pointerId;
  videoScrubState.wasPlaying = !video.paused;
  video.pause();
  videoTrack.setPointerCapture(event.pointerId);
  seekVideoByPointer(event.clientX);
});

videoTrack.addEventListener('pointermove', (event) => {
  if (!videoScrubState.active || videoScrubState.pointerId !== event.pointerId) return;
  seekVideoByPointer(event.clientX);
});

const endVideoScrub = (event: PointerEvent) => {
  if (!videoScrubState.active || videoScrubState.pointerId !== event.pointerId) return;
  videoTrack.releasePointerCapture(event.pointerId);
  const shouldResume = videoScrubState.wasPlaying;
  videoScrubState.active = false;
  videoScrubState.pointerId = null;
  if (shouldResume) {
    video.play().catch(() => {
      /* ignore autoplay block */
    });
  }
};

videoTrack.addEventListener('pointerup', endVideoScrub);
videoTrack.addEventListener('pointercancel', endVideoScrub);

videoPlayhead.addEventListener('pointerdown', (event) => {
  if (!video.src || !video.duration || event.button !== 0) return;
  event.preventDefault();
  videoScrubState.active = true;
  videoScrubState.pointerId = event.pointerId;
  videoScrubState.wasPlaying = !video.paused;
  video.pause();
  videoPlayhead.setPointerCapture(event.pointerId);
  seekVideoByPointer(event.clientX);
});

videoPlayhead.addEventListener('pointermove', (event) => {
  if (!videoScrubState.active || videoScrubState.pointerId !== event.pointerId) return;
  seekVideoByPointer(event.clientX);
});

const endPlayheadScrub = (event: PointerEvent) => {
  if (!videoScrubState.active || videoScrubState.pointerId !== event.pointerId) return;
  videoPlayhead.releasePointerCapture(event.pointerId);
  const shouldResume = videoScrubState.wasPlaying;
  videoScrubState.active = false;
  videoScrubState.pointerId = null;
  if (shouldResume) {
    video.play().catch(() => {
      /* ignore autoplay block */
    });
  }
};

videoPlayhead.addEventListener('pointerup', endPlayheadScrub);
videoPlayhead.addEventListener('pointercancel', endPlayheadScrub);

chooseFileBtn.addEventListener('click', async () => {
  if (zubaAPI?.chooseVideo) {
    const filePath = await zubaAPI.chooseVideo();
    if (filePath) {
      openVideoFromPath(filePath);
      return;
    }
  }
  hiddenFileInput.click();
});

hiddenFileInput.addEventListener('change', (event) => {
  const input = event.currentTarget as HTMLInputElement | null;
  handleFiles(input?.files ?? null);
  hiddenFileInput.value = '';
});

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault();
  dropZoneDragDepth += 1;
  dropZone.classList.add('dragging');
};

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault();
  dropZoneDragDepth = Math.max(0, dropZoneDragDepth - 1);
  if (dropZoneDragDepth === 0) {
    dropZone.classList.remove('dragging');
  }
};

dropZone.addEventListener('dragover', handleDragEnter);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZoneDragDepth = 0;
  dropZone.classList.remove('dragging');
  handleFiles(event.dataTransfer?.files ?? null);
});

window.addEventListener(
  'dragover',
  (event) => {
    event.preventDefault();
  },
  false
);

window.addEventListener(
  'drop',
  (event) => {
    event.preventDefault();
  },
  false
);

dropZone.addEventListener('click', () => {
  if (!video.src) {
    hiddenFileInput.click();
  }
});

addCutBtn.addEventListener('click', () => {
  addCutAtCurrentTime();
});

deleteCutBtn.addEventListener('click', () => {
  deleteSelectedSegment();
});

addSubtitleBtn.addEventListener('click', () => {
  prepareSubtitleAtCurrentTime();
});

exportCutsBtn.addEventListener('click', () => {
  exportCuts();
});

openExportBtn.addEventListener('click', async () => {
  if (!lastExportPath) return;
  try {
    await zubaAPI?.openPath(lastExportPath);
  } catch (error) {
    setExportStatus(error instanceof Error ? error.message : 'ファイルを開けませんでした', 'error');
  }
});

undoBtn.addEventListener('click', () => {
  undoLastChange();
});

redoBtn.addEventListener('click', () => {
  redoLastUndo();
});

document.addEventListener('paste', (event) => {
  const files = event.clipboardData?.files;
  if (files && files.length > 0) {
    handleFiles(files);
    return;
  }
  const text = event.clipboardData?.getData('text/plain') ?? null;
  handlePathText(text);
});

zubaAPI?.onExternalFile((filePath) => {
  openVideoFromPath(filePath);
});

subtitleForm.addEventListener('submit', upsertSubtitle);
clearSubtitleFormBtn.addEventListener('click', clearSubtitleForm);

const shouldIgnoreGlobalShortcut = (element: HTMLElement | null) => {
  if (!element) return false;
  if (element.isContentEditable) {
    return true;
  }
  return Boolean(element.closest('input, textarea, select, button, [contenteditable="true"]'));
};

const handleGlobalKey = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (shouldIgnoreGlobalShortcut(target)) {
    return;
  }

  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redoLastUndo();
    } else {
      undoLastChange();
    }
    return;
  }

  if (meta && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoLastUndo();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    addCutAtCurrentTime();
  }

  if (event.key === 'Delete') {
    event.preventDefault();
    if (state.selectedSubtitleId) {
      deleteSelectedSubtitle();
      return;
    }
    if (state.selectedSegmentId) {
      deleteSelectedSegment();
    }
  }
};

document.addEventListener('keydown', handleGlobalKey);

videoNameLabel.textContent = '未選択';
clearSubtitleForm();
updateTrackLabels();
renderSubtitleTrack();
updateVideoTrackLabels();
refreshSegmentsUI();
updateExportButtonState();
setExportStatus('');
updateUndoRedoButtons();
updateExportOpenButton();
function updateVideoTrackLabels() {
  videoTrackStartLabel.textContent = '0.00s';
  videoTrackEndLabel.textContent = formatTime(video.duration || 0);
}

function updatePlayhead() {
  const duration = video.duration || 0;
  if (!video.src || duration <= 0) {
    videoPlayhead.style.display = 'none';
    return;
  }
  videoPlayhead.style.display = 'block';
  const percent = clamp(((video.currentTime || 0) / duration) * 100, 0, 100);
  videoPlayhead.style.left = `${percent}%`;
}
