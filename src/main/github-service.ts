import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Octokit } from '@octokit/rest';
import type {
  GitHubAuthState,
  GitHubBranch,
  GitHubCommit,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepoInfo,
} from '../shared/types';

interface GitHubStoreSchema {
  encryptedToken?: string;
  plainToken?: string;
  lastLogin?: string;
  lastScopes?: string[];
}

const USER_AGENT = 'claude-code-studio';
const STORE_FILE = 'github-auth.json';

export class GitHubService {
  private storePath: string;
  private store: GitHubStoreSchema;
  private octokit: Octokit | null = null;
  private cachedAuth: GitHubAuthState = { hasToken: false, login: null, scopes: [] };

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.store = this.readStore();
    this.cachedAuth = {
      hasToken: this.hasStoredToken(),
      login: this.store.lastLogin ?? null,
      scopes: this.store.lastScopes ?? [],
    };
  }

  getAuthState(): GitHubAuthState {
    return { ...this.cachedAuth };
  }

  async setToken(token: string): Promise<GitHubAuthState> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token cannot be empty');

    const octokit = this.makeOctokit(trimmed);
    const { data, headers } = await octokit.users.getAuthenticated();
    const scopes = parseScopes(headers['x-oauth-scopes']);

    this.persistToken(trimmed);
    this.store.lastLogin = data.login;
    this.store.lastScopes = scopes;
    this.writeStore();

    this.octokit = octokit;
    this.cachedAuth = { hasToken: true, login: data.login, scopes };
    return { ...this.cachedAuth };
  }

  clearToken(): GitHubAuthState {
    this.store = {};
    this.writeStore();
    this.octokit = null;
    this.cachedAuth = { hasToken: false, login: null, scopes: [] };
    return { ...this.cachedAuth };
  }

  async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    const client = this.requireClient();
    const { data } = await client.repos.get({ owner, repo });
    return {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      language: data.language,
      topics: data.topics ?? [],
      updatedAt: data.updated_at,
    };
  }

  async listCommits(owner: string, repo: string, perPage = 20): Promise<GitHubCommit[]> {
    const client = this.requireClient();
    const { data } = await client.repos.listCommits({ owner, repo, per_page: perPage });
    return data.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: (c.commit.message ?? '').split('\n')[0],
      authorName: c.commit.author?.name ?? 'unknown',
      authorLogin: c.author?.login ?? null,
      authorAvatarUrl: c.author?.avatar_url ?? null,
      date: c.commit.author?.date ?? c.commit.committer?.date ?? '',
      htmlUrl: c.html_url,
    }));
  }

  async listBranches(owner: string, repo: string, perPage = 50): Promise<GitHubBranch[]> {
    const client = this.requireClient();
    const [{ data: branches }, { data: repoData }] = await Promise.all([
      client.repos.listBranches({ owner, repo, per_page: perPage }),
      client.repos.get({ owner, repo }),
    ]);
    return branches.map((b) => ({
      name: b.name,
      sha: b.commit.sha,
      protected: b.protected,
      isDefault: b.name === repoData.default_branch,
    }));
  }

  async listPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open'
  ): Promise<GitHubPullRequest[]> {
    const client = this.requireClient();
    const { data } = await client.pulls.list({ owner, repo, state, per_page: 30 });
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state as 'open' | 'closed',
      draft: pr.draft ?? false,
      merged: Boolean(pr.merged_at),
      authorLogin: pr.user?.login ?? 'unknown',
      authorAvatarUrl: pr.user?.avatar_url ?? null,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      htmlUrl: pr.html_url,
      commentCount: 0,
    }));
  }

  async listIssues(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open'
  ): Promise<GitHubIssue[]> {
    const client = this.requireClient();
    const { data } = await client.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: 30,
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state as 'open' | 'closed',
        authorLogin: i.user?.login ?? 'unknown',
        authorAvatarUrl: i.user?.avatar_url ?? null,
        labels: (i.labels ?? []).map((l) =>
          typeof l === 'string'
            ? { name: l, color: '888888' }
            : { name: l.name ?? '', color: l.color ?? '888888' }
        ),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        htmlUrl: i.html_url,
        commentCount: i.comments,
      }));
  }

  private requireClient(): Octokit {
    if (this.octokit) return this.octokit;
    const token = this.readToken();
    if (!token) throw new Error('GitHub token not set. Add a Personal Access Token first.');
    this.octokit = this.makeOctokit(token);
    return this.octokit;
  }

  private makeOctokit(token: string): Octokit {
    return new Octokit({ auth: token, userAgent: USER_AGENT });
  }

  private hasStoredToken(): boolean {
    return Boolean(this.store.encryptedToken || this.store.plainToken);
  }

  private persistToken(token: string): void {
    delete this.store.encryptedToken;
    delete this.store.plainToken;
    if (safeStorage.isEncryptionAvailable()) {
      this.store.encryptedToken = safeStorage.encryptString(token).toString('base64');
    } else {
      this.store.plainToken = token;
    }
    this.writeStore();
  }

  private readToken(): string | null {
    if (this.store.encryptedToken && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(this.store.encryptedToken, 'base64'));
      } catch {
        return null;
      }
    }
    return this.store.plainToken ?? null;
  }

  private readStore(): GitHubStoreSchema {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
    } catch {
      return {};
    }
  }

  private writeStore(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = this.storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2));
    fs.renameSync(tmp, this.storePath);
  }
}

function parseScopes(header: string | string[] | undefined): string[] {
  if (!header) return [];
  const value = Array.isArray(header) ? header[0] : header;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
