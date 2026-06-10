import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import * as path from 'path';

export type ApiHttpMethod = 'GET' | 'POST';

export interface AiApiLink {
  id: string;
  slug: string;
  name: string;
  description: string;
  url: string;
  method: ApiHttpMethod;
  headers: Record<string, string>;
  body?: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  lastStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiApiLinkPayload {
  slug: string;
  name: string;
  description?: string;
  url: string;
  method?: ApiHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  enabled?: boolean;
}

export type UpdateAiApiLinkPayload = Partial<CreateAiApiLinkPayload>;

export interface AiApiTestResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  sample: string;
  error?: string;
}

export interface FetchedApiContext {
  slug: string;
  name: string;
  description: string;
  status: number | null;
  ok: boolean;
  body: string;
  error?: string;
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_CHARS = 4000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/;

@Injectable()
export class AiApiLinksService {
  private readonly logger = new Logger(AiApiLinksService.name);
  private readonly aiDataDir = path.resolve(process.cwd(), 'data', 'ai');
  private readonly storePath = path.resolve(process.cwd(), 'data', 'ai', 'api-links.json');
  private cache: AiApiLink[] | null = null;

  async list(): Promise<AiApiLink[]> {
    return this.loadAll();
  }

  async listEnabled(): Promise<AiApiLink[]> {
    const all = await this.loadAll();
    return all.filter(item => item.enabled);
  }

  async create(payload: CreateAiApiLinkPayload): Promise<AiApiLink> {
    const slug = this.normalizeSlug(payload.slug);
    this.assertValidUrl(payload.url);

    const all = await this.loadAll();
    if (all.some(item => item.slug === slug)) {
      throw new BadRequestException(`API slug "${slug}" already exists`);
    }

    const now = new Date().toISOString();
    const entity: AiApiLink = {
      id: randomUUID(),
      slug,
      name: (payload.name || slug).trim().slice(0, 80),
      description: (payload.description ?? '').trim().slice(0, 400),
      url: payload.url.trim(),
      method: payload.method === 'POST' ? 'POST' : 'GET',
      headers: this.sanitizeHeaders(payload.headers),
      body: payload.body?.toString().slice(0, 4000),
      enabled: payload.enabled !== false,
      lastFetchedAt: null,
      lastError: null,
      lastStatus: null,
      createdAt: now,
      updatedAt: now,
    };

    all.push(entity);
    await this.persist(all);
    return entity;
  }

  async update(id: string, payload: UpdateAiApiLinkPayload): Promise<AiApiLink> {
    const all = await this.loadAll();
    const idx = all.findIndex(item => item.id === id);
    if (idx === -1) throw new NotFoundException('API link not found');

    const current = all[idx];
    const next: AiApiLink = { ...current };

    if (payload.slug !== undefined) {
      const slug = this.normalizeSlug(payload.slug);
      if (slug !== current.slug && all.some(item => item.slug === slug)) {
        throw new BadRequestException(`API slug "${slug}" already exists`);
      }
      next.slug = slug;
    }
    if (payload.name !== undefined) next.name = payload.name.trim().slice(0, 80) || next.slug;
    if (payload.description !== undefined) next.description = payload.description.trim().slice(0, 400);
    if (payload.url !== undefined) {
      this.assertValidUrl(payload.url);
      next.url = payload.url.trim();
    }
    if (payload.method !== undefined) next.method = payload.method === 'POST' ? 'POST' : 'GET';
    if (payload.headers !== undefined) next.headers = this.sanitizeHeaders(payload.headers);
    if (payload.body !== undefined) next.body = payload.body?.toString().slice(0, 4000);
    if (payload.enabled !== undefined) next.enabled = Boolean(payload.enabled);
    next.updatedAt = new Date().toISOString();

    all[idx] = next;
    await this.persist(all);
    return next;
  }

  async remove(id: string): Promise<void> {
    const all = await this.loadAll();
    const filtered = all.filter(item => item.id !== id);
    if (filtered.length === all.length) {
      throw new NotFoundException('API link not found');
    }
    await this.persist(filtered);
  }

  async test(id: string): Promise<AiApiTestResult> {
    const all = await this.loadAll();
    const item = all.find(entry => entry.id === id);
    if (!item) throw new NotFoundException('API link not found');

    const start = Date.now();
    const result = await this.fetchOne(item);
    const duration = Date.now() - start;
    const sample = (result.body ?? '').slice(0, 600);

    const idx = all.findIndex(entry => entry.id === id);
    if (idx !== -1) {
      all[idx] = {
        ...all[idx],
        lastFetchedAt: new Date().toISOString(),
        lastError: result.error ?? null,
        lastStatus: result.status,
        updatedAt: new Date().toISOString(),
      };
      await this.persist(all);
    }

    return {
      ok: result.ok,
      status: result.status,
      durationMs: duration,
      sample,
      error: result.error,
    };
  }

  extractSlugs(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/\/([a-z0-9][a-z0-9_-]{1,38}[a-z0-9])/gi);
    if (!matches) return [];
    const set = new Set<string>();
    for (const raw of matches) {
      set.add(raw.slice(1).toLowerCase());
    }
    return [...set];
  }

  async fetchSlugs(slugs: string[]): Promise<FetchedApiContext[]> {
    if (!slugs.length) return [];
    const all = await this.loadAll();
    const targets = slugs
      .map(slug => all.find(item => item.slug === slug.toLowerCase() && item.enabled))
      .filter((item): item is AiApiLink => Boolean(item));

    const results = await Promise.all(
      targets.map(async target => {
        const fetched = await this.fetchOne(target);
        const idx = all.findIndex(entry => entry.id === target.id);
        if (idx !== -1) {
          all[idx] = {
            ...all[idx],
            lastFetchedAt: new Date().toISOString(),
            lastError: fetched.error ?? null,
            lastStatus: fetched.status,
          };
        }
        return {
          slug: target.slug,
          name: target.name,
          description: target.description,
          status: fetched.status,
          ok: fetched.ok,
          body: fetched.body,
          error: fetched.error,
        } satisfies FetchedApiContext;
      }),
    );

    await this.persist(all).catch(error => {
      this.logger.warn(`Failed to persist API fetch state: ${error instanceof Error ? error.message : String(error)}`);
    });

    return results;
  }

  private async fetchOne(item: AiApiLink): Promise<{
    ok: boolean;
    status: number | null;
    body: string;
    error?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const init: RequestInit = {
        method: item.method,
        headers: this.buildFetchHeaders(item),
        signal: controller.signal,
      };

      if (item.method === 'POST' && item.body) {
        init.body = item.body;
      }

      const response = await fetch(item.url, init);
      const raw = await response.text();
      const trimmed = raw.length > MAX_BODY_CHARS ? `${raw.slice(0, MAX_BODY_CHARS)}…` : raw;
      return {
        ok: response.ok,
        status: response.status,
        body: trimmed,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? `Request timed out after ${FETCH_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      return { ok: false, status: null, body: '', error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildFetchHeaders(item: AiApiLink): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      'User-Agent': 'NOXUS-AI-Open-WhatsApp/1.0 (+api-link-fetcher)',
    };
    for (const [key, value] of Object.entries(item.headers)) {
      if (!key || !value) continue;
      headers[key] = value;
    }
    if (item.method === 'POST' && item.body && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  private async loadAll(): Promise<AiApiLink[]> {
    if (this.cache) return [...this.cache];
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.cache = parsed.filter((entry): entry is AiApiLink => this.isValidEntry(entry));
        return [...this.cache];
      }
    } catch {
      // file may not exist yet
    }
    this.cache = [];
    return [];
  }

  private async persist(all: AiApiLink[]): Promise<void> {
    await mkdir(this.aiDataDir, { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
    this.cache = [...all];
  }

  private normalizeSlug(raw: string): string {
    const slug = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\/+/, '');
    if (!SLUG_PATTERN.test(slug)) {
      throw new BadRequestException(
        'Slug must be 3-40 chars, lowercase letters, digits, hyphen or underscore, start and end alphanumeric',
      );
    }
    return slug;
  }

  private assertValidUrl(url: string): void {
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('protocol');
      }
    } catch {
      throw new BadRequestException('URL must be a valid http(s) URL');
    }
  }

  private sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {};
    const result: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(headers)) {
      const key = String(rawKey ?? '')
        .trim()
        .slice(0, 80);
      const value = String(rawValue ?? '')
        .trim()
        .slice(0, 400);
      if (key && value) result[key] = value;
    }
    return result;
  }

  private isValidEntry = (entry: unknown): entry is AiApiLink => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Partial<AiApiLink>;
    return Boolean(candidate.id && candidate.slug && candidate.url);
  };
}
