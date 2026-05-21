import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    onData: (callback: (data: string) => void) => {
      ipcRenderer.on(IPC.TERMINAL_DATA, (_event, data) => callback(data));
    },
    onExit: (callback: (code: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_EXIT, (_event, code) => callback(code));
    },
    onReady: (callback: (pid: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_READY, (_event, pid) => callback(pid));
    },
    sendInput: (data: string) => {
      ipcRenderer.send(IPC.TERMINAL_INPUT, data);
    },
    resize: (cols: number, rows: number) => {
      ipcRenderer.send(IPC.TERMINAL_RESIZE, cols, rows);
    },
    restart: () => {
      ipcRenderer.send(IPC.TERMINAL_RESTART);
    },
  },
  resources: {
    onUpdate: (callback: (data: unknown) => void) => {
      ipcRenderer.on(IPC.RESOURCE_UPDATE, (_event, data) => callback(data));
    },
    start: () => ipcRenderer.send(IPC.RESOURCE_START),
    stop: () => ipcRenderer.send(IPC.RESOURCE_STOP),
  },
  compact: {
    getStatus: () => ipcRenderer.invoke(IPC.COMPACT_STATUS),
    install: () => ipcRenderer.invoke(IPC.COMPACT_INSTALL),
    uninstall: () => ipcRenderer.invoke(IPC.COMPACT_UNINSTALL),
    getConfig: () => ipcRenderer.invoke(IPC.COMPACT_CONFIG_GET),
    setConfig: (config: unknown) =>
      ipcRenderer.invoke(IPC.COMPACT_CONFIG_SET, config),
  },
  git: {
    detect: (cwd?: string) => ipcRenderer.invoke(IPC.GIT_DETECT, cwd),
    getCwd: () => ipcRenderer.invoke(IPC.GIT_GET_CWD),
    setCwd: (cwd: string) => ipcRenderer.invoke(IPC.GIT_SET_CWD, cwd),
    pickDir: () => ipcRenderer.invoke(IPC.GIT_PICK_DIR),
  },
  github: {
    authState: () => ipcRenderer.invoke(IPC.GITHUB_AUTH_STATE),
    setToken: (token: string) => ipcRenderer.invoke(IPC.GITHUB_SET_TOKEN, token),
    clearToken: () => ipcRenderer.invoke(IPC.GITHUB_CLEAR_TOKEN),
    getRepoInfo: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_REPO_INFO, owner, repo),
    listCommits: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_COMMITS, owner, repo),
    listBranches: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_BRANCHES, owner, repo),
    listPullRequests: (
      owner: string,
      repo: string,
      state: 'open' | 'closed' | 'all' = 'open'
    ) => ipcRenderer.invoke(IPC.GITHUB_PRS, owner, repo, state),
    listIssues: (
      owner: string,
      repo: string,
      state: 'open' | 'closed' | 'all' = 'open'
    ) => ipcRenderer.invoke(IPC.GITHUB_ISSUES, owner, repo, state),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.GITHUB_OPEN_EXTERNAL, url),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
