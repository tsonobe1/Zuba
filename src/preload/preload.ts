import { contextBridge, ipcRenderer } from 'electron';
import { pathToFileURL } from 'url';
import type { ExportSegmentsPayload, QuickCutAPI } from '../types/quickcut';

type ExternalFileCallback = (filePath: string) => void;

const api: QuickCutAPI = {
  chooseVideo: () => ipcRenderer.invoke('dialog:chooseVideo'),
  pathToFileUrl: (filePath: string) => (filePath ? pathToFileURL(filePath).href : null),
  onExternalFile: (callback: ExternalFileCallback) => {
    ipcRenderer.on('video:file-opened-externally', (_event, filePath: string) => {
      callback(filePath);
    });
  },
  exportCuts: (payload: ExportSegmentsPayload) => ipcRenderer.invoke('video:exportCuts', payload),
  openPath: (filePath: string) => ipcRenderer.invoke('file:openPath', filePath)
};

contextBridge.exposeInMainWorld('quickCutAPI', api);
