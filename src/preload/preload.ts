import { contextBridge, ipcRenderer } from 'electron';
import { Buffer } from 'buffer';
import { pathToFileURL } from 'url';
import type { ExportSegmentsPayload, ZubaAPI } from '../types/zuba';

type ExternalFileCallback = (filePath: string) => void;

const api: ZubaAPI = {
  chooseVideo: () => ipcRenderer.invoke('dialog:chooseVideo'),
  pathToFileUrl: (filePath: string) => (filePath ? pathToFileURL(filePath).href : null),
  onExternalFile: (callback: ExternalFileCallback) => {
    ipcRenderer.on('video:file-opened-externally', (_event, filePath: string) => {
      callback(filePath);
    });
  },
  exportCuts: (payload: ExportSegmentsPayload) => ipcRenderer.invoke('video:exportCuts', payload),
  openPath: (filePath: string) => ipcRenderer.invoke('file:openPath', filePath),
  cacheVideoFile: async (fileName: string, data: ArrayBuffer) => {
    const buffer = Buffer.from(data);
    return ipcRenderer.invoke('video:cacheTempFile', {
      fileName,
      data: buffer
    });
  }
};

contextBridge.exposeInMainWorld('zubaAPI', api);
