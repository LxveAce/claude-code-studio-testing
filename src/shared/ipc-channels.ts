export const IPC = {
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_READY: 'terminal:ready',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_RESTART: 'terminal:restart',

  RESOURCE_UPDATE: 'resources:update',
  RESOURCE_START: 'resources:start',
  RESOURCE_STOP: 'resources:stop',

  COMPACT_INSTALL: 'compact:install',
  COMPACT_UNINSTALL: 'compact:uninstall',
  COMPACT_STATUS: 'compact:status',
  COMPACT_CONFIG_GET: 'compact:config-get',
  COMPACT_CONFIG_SET: 'compact:config-set',

  GIT_DETECT: 'git:detect',
  GIT_SET_CWD: 'git:set-cwd',
  GIT_GET_CWD: 'git:get-cwd',
  GIT_PICK_DIR: 'git:pick-dir',

  GITHUB_AUTH_STATE: 'github:auth-state',
  GITHUB_SET_TOKEN: 'github:set-token',
  GITHUB_CLEAR_TOKEN: 'github:clear-token',
  GITHUB_REPO_INFO: 'github:repo-info',
  GITHUB_COMMITS: 'github:commits',
  GITHUB_BRANCHES: 'github:branches',
  GITHUB_PRS: 'github:prs',
  GITHUB_ISSUES: 'github:issues',
  GITHUB_OPEN_EXTERNAL: 'github:open-external',

  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATE: 'auth:state',

  SYNC_PUSH: 'sync:push',
  SYNC_PULL: 'sync:pull',
  SYNC_STATUS: 'sync:status',
} as const;
