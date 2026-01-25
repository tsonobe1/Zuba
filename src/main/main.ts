import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import type { ExportSegmentsPayload, SegmentRange, SubtitleExportPayload } from '../types/zuba';

let mainWindow: BrowserWindow | null = null;
let sessionCacheDir: string | null = null;

const ensureSessionCacheDir = async () => {
  if (sessionCacheDir) {
    return sessionCacheDir;
  }
  sessionCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuba-cache-'));
  return sessionCacheDir;
};

const sanitizeCacheFileName = (fileName: string) => fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

const cleanupSessionCacheDir = async () => {
  if (!sessionCacheDir) return;
  try {
    await fs.rm(sessionCacheDir, { recursive: true, force: true });
  } catch (error) {
    console.warn('[cache] failed to remove temp cache directory', error);
  } finally {
    sessionCacheDir = null;
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1b1b1b',
    title: 'Zuba',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const getVideoFromDialog = async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '動画ファイルを選択',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
};

const formatTimeForFfmpeg = (value: number) => value.toFixed(3);

const runFfmpeg = (args: string[], tag = 'ffmpeg') =>
  new Promise<void>((resolve, reject) => {
    console.log(`[${tag}] spawn ffmpeg ${args.join(' ')}`);
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.log(`[${tag}] ${text}`);
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[${tag} error] ${text}`);
      }
    });
    child.once('error', (error) => {
      console.error(`[${tag}] failed to spawn ffmpeg`, error);
      reject(error);
    });
    child.once('exit', (code) => {
      if (code === 0) {
        console.log(`[${tag}] ffmpeg exited successfully`);
        resolve();
      } else {
        console.error(`[${tag}] ffmpeg exited with code ${code}`);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });

const escapePathForConcat = (filePath: string) => filePath.replace(/'/g, "'\\''");

const MIN_CHUNK_DURATION = 0.1;
const MIN_SUBTITLE_OUTPUT_DURATION = 0.05;
const DEFAULT_PLAY_RES_X = 1920;
const DEFAULT_PLAY_RES_Y = 1080;
const BACKGROUND_ALPHA = 0x40;

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeHexColor = (value: string | undefined, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const expanded = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }
  return fallback;
};

const sanitizeFontFamily = (value: string | undefined) => {
  if (!value) return 'Noto Sans JP';
  const cleaned = value.replace(/['"]/g, '').trim();
  const first = cleaned.split(',')[0]?.trim();
  if (!first) return 'Noto Sans JP';
  return first.replace(/[,]/g, ' ');
};

const formatAssTime = (value: number) => {
  const total = Math.max(0, value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, '0');
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}`;
};

const escapeAssText = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r?\n/g, '\\N');

const toAssColor = (hex: string, alpha = 0x00) => {
  const normalized = normalizeHexColor(hex, '#ffffff').slice(1);
  const r = normalized.slice(0, 2);
  const g = normalized.slice(2, 4);
  const b = normalized.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
};

const exportSegmentsWithFfmpeg = async (
  sourcePath: string,
  segments: SegmentRange[],
  outputPath: string,
  options?: { subtitles?: SubtitleExportPayload[]; videoWidth?: number; videoHeight?: number }
) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuba-'));
  const chunkPaths: string[] = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const chunkPath = path.join(tempDir, `segment-${index}.mp4`);
      const start = formatTimeForFfmpeg(segment.start);
      const end = formatTimeForFfmpeg(segment.end);
      const durationSeconds = Math.max(segment.end - segment.start, MIN_CHUNK_DURATION);
      const duration = formatTimeForFfmpeg(durationSeconds);
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        start,
        '-t',
        duration,
        '-i',
        sourcePath,
        '-c',
        'copy',
        '-avoid_negative_ts',
        '1',
        chunkPath
      ];
      await runFfmpeg(args, `chunk-${index}`);
      chunkPaths.push(chunkPath);
    }

    if (chunkPaths.length === 0) {
      throw new Error('書き出すセグメントが存在しません');
    }

    const concatListPath = path.join(tempDir, 'concat.txt');
    const concatContent = chunkPaths.map((chunk) => `file '${escapePathForConcat(chunk)}'`).join('\n');
    await fs.writeFile(concatListPath, concatContent, 'utf8');

    const concatOutputPath = path.join(tempDir, 'combined.mp4');
    const concatArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatOutputPath];
    await runFfmpeg(concatArgs, 'concat');

    const subtitles = options?.subtitles ?? [];
    if (subtitles.length > 0) {
      const assPath = path.join(tempDir, 'subtitles.ass');
      await createAssFile(subtitles, assPath, { width: options?.videoWidth, height: options?.videoHeight });
      try {
        const logDir = path.join(process.cwd(), 'log');
        await fs.mkdir(logDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const debugAssPath = path.join(logDir, `subtitles-${timestamp}.ass`);
        await fs.copyFile(assPath, debugAssPath);
        console.log(`[subtitles] copied ASS to ${debugAssPath}`);
      } catch (error) {
        console.warn('[subtitles] failed to save ASS for debugging', error);
      }
      const escapedAss = assPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const filterArg = `subtitles=filename='${escapedAss}'`;
      const encodeArgs = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        concatOutputPath,
        '-vf',
        filterArg,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath
      ];
      await runFfmpeg(encodeArgs, 'subtitles');
    } else {
      await fs.copyFile(concatOutputPath, outputPath);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const sanitizeSegments = (segments: SegmentRange[]) =>
  segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end - segment.start > 0.05)
    .sort((a, b) => a.start - b.start);

const sanitizeExportSubtitles = (subtitles?: SubtitleExportPayload[] | null) =>
  (subtitles ?? [])
    .filter((subtitle) => Number.isFinite(subtitle.start) && Number.isFinite(subtitle.end) && subtitle.end - subtitle.start > MIN_SUBTITLE_OUTPUT_DURATION)
    .map((subtitle) => ({
      id: subtitle.id,
      text: (subtitle.text ?? '').trim(),
      start: Math.max(0, subtitle.start),
      end: Math.max(0, subtitle.end),
      styles: {
        fontColor: normalizeHexColor(subtitle.styles?.fontColor, '#ffffff'),
        backgroundColor: normalizeHexColor(subtitle.styles?.backgroundColor, '#222222'),
        fontSize: Math.max(12, Math.round(subtitle.styles?.fontSize ?? 24)),
        fontFamily: sanitizeFontFamily(subtitle.styles?.fontFamily)
      },
      position: {
        xPercent: clampNumber(subtitle.position?.xPercent ?? 50, 0, 100),
        yPercent: clampNumber(subtitle.position?.yPercent ?? 85, 0, 100)
      }
    }))
    .sort((a, b) => a.start - b.start);

const ASS_PLAY_RES_X = 1920;
const ASS_PLAY_RES_Y = 1080;

const createAssFile = async (
  subtitles: SubtitleExportPayload[],
  targetPath: string,
  dimensions?: { width?: number; height?: number }
) => {
  const width = Math.max(Math.round(dimensions?.width ?? ASS_PLAY_RES_X), 1);
  const height = Math.max(Math.round(dimensions?.height ?? ASS_PLAY_RES_Y), 1);
  const styleMap = new Map<string, string>();
  const styleLines: string[] = [];
  let styleIndex = 0;

  const ensureStyle = (subtitle: SubtitleExportPayload) => {
    const scaledFontSize = Math.max(10, Math.round(subtitle.styles.fontSize));
    const boxThickness = Math.max(2, Math.round(scaledFontSize * 0.25));
    const key = `${subtitle.styles.fontFamily}|${scaledFontSize}|${subtitle.styles.fontColor}|${subtitle.styles.backgroundColor}|${boxThickness}`;
    if (!styleMap.has(key)) {
      styleIndex += 1;
      const name = `Style${styleIndex}`;
      const primaryColour = toAssColor(subtitle.styles.fontColor, 0x00);
      const backgroundColour = toAssColor(subtitle.styles.backgroundColor, BACKGROUND_ALPHA);
      styleLines.push(
        [
          `Style: ${name}`,
          subtitle.styles.fontFamily,
          scaledFontSize,
          primaryColour,
          primaryColour,
          backgroundColour,
          backgroundColour,
          0,
          0,
          0,
          0,
          100,
          100,
          0,
          0,
          3,
          boxThickness,
          0,
          5,
          10,
          10,
          10,
          1
        ].join(',')
      );
      styleMap.set(key, name);
    }
    return styleMap.get(key)!;
  };

  const eventLines = subtitles.map((subtitle) => {
    const clampedStart = Math.max(0, subtitle.start);
    const clampedEnd = Math.max(clampedStart + MIN_SUBTITLE_OUTPUT_DURATION, subtitle.end);
    const styleName = ensureStyle(subtitle);
    const posX = Math.round((subtitle.position.xPercent / 100) * width);
    const posY = Math.round((subtitle.position.yPercent / 100) * height);
    const overrides = `{\\pos(${posX},${posY})}`;
    const escapedText = escapeAssText(subtitle.text || '');
    return `Dialogue: 0,${formatAssTime(clampedStart)},${formatAssTime(
      clampedEnd
    )},${styleName},,0,0,0,,${overrides}${escapedText}`;
  });

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    ''
  ].join('\n');

  const stylesSection = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLines.join('\n')
  ].join('\n');

  const eventsSection = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    eventLines.join('\n')
  ].join('\n');

  const content = `${header}\n${stylesSection}\n\n${eventsSection}\n`;
  await fs.writeFile(targetPath, content, 'utf8');
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('dialog:chooseVideo', async () => getVideoFromDialog());
  ipcMain.handle('file:openPath', async (_event, filePath: string) => {
    if (!filePath) {
      throw new Error('ファイルパスが指定されていません');
    }
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
  ipcMain.handle('video:cacheTempFile', async (_event, payload: { fileName?: string; data?: Buffer }) => {
    try {
      const data = payload?.data;
      if (!data || !Buffer.isBuffer(data)) {
        throw new Error('動画データが取得できませんでした');
      }
      const cacheDir = await ensureSessionCacheDir();
      const requestedName = typeof payload?.fileName === 'string' && payload.fileName.trim() ? payload.fileName.trim() : 'video';
      const ext = path.extname(requestedName) || '.mp4';
      const safeBaseName = sanitizeCacheFileName(path.basename(requestedName, ext)) || 'clip';
      const uniqueName = `${safeBaseName}-${Date.now()}${ext}`;
      const targetPath = path.join(cacheDir, uniqueName);
      await fs.writeFile(targetPath, data);
      return targetPath;
    } catch (error) {
      console.error('[cache] failed to persist temp video', error);
      return null;
    }
  });

  ipcMain.handle('video:exportCuts', async (_event, payload: ExportSegmentsPayload) => {
    try {
      if (!payload || !payload.sourcePath) {
        throw new Error('元動画のパスが見つかりませんでした。');
      }
      const segments = sanitizeSegments(payload.segments ?? []);
      if (segments.length === 0) {
        throw new Error('書き出すカットがありません。');
      }
      const subtitles = sanitizeExportSubtitles(payload.subtitles);
      console.log('[main] export request', {
        segments: segments.length,
        subtitles: subtitles.length,
        source: payload.sourcePath
      });

      const referenceWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
      const sourceExt = path.extname(payload.sourcePath) || '.mp4';
      const baseName = path.basename(payload.sourcePath, path.extname(payload.sourcePath));
      const defaultPath = path.join(path.dirname(payload.sourcePath), `${baseName}_cut${sourceExt || '.mp4'}`);

      const saveDialogOptions = {
        title: 'カット後の動画を書き出し',
        defaultPath,
        filters: [
          { name: 'Video', extensions: [sourceExt.replace('.', '') || 'mp4'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };

      const saveResult = referenceWindow
        ? await dialog.showSaveDialog(referenceWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true, error: '書き出しをキャンセルしました。' };
      }

      const outputPath = saveResult.filePath;
      if (path.resolve(outputPath) === path.resolve(payload.sourcePath)) {
        throw new Error('元ファイルと同じパスには保存できません。別名を設定してください。');
      }

      await exportSegmentsWithFfmpeg(payload.sourcePath, segments, outputPath, {
        subtitles,
        videoWidth: payload.videoWidth,
        videoHeight: payload.videoHeight
      });
      return { success: true, outputPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {
          success: false,
          error: 'ffmpeg コマンドが見つかりません。ffmpeg をインストールしてパスを通してください。'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : '書き出しに失敗しました。'
      };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('video:file-opened-externally', filePath);
  } else {
    app.once('browser-window-created', () => {
      if (mainWindow) {
        mainWindow.webContents.send('video:file-opened-externally', filePath);
      }
    });
  }
});

app.on('will-quit', () => {
  cleanupSessionCacheDir().catch(() => {
    /* noop */
  });
});
