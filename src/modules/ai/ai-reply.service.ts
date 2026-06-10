import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { appendFile, mkdir, readFile, stat, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { HookContext, HookManager, HookResult } from '../../core/hooks';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { MessageService } from '../message/message.service';
import { AiApiLinksService, FetchedApiContext } from './ai-api-links.service';

interface KnowledgeCache {
  content: string;
  mtimeMs: number;
  loadedAt: Date;
}

export interface AiRuntimeSettings {
  enabled?: boolean;
  provider?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  knowledgePath?: string;
  knowledgeMaxChars?: number;
  maxReplyChars?: number;
  cooldownMs?: number;
  includeGroups?: boolean;
  temperature?: number;
  systemPrompt?: string;
}

export interface AiStatus {
  enabled: boolean;
  provider: string;
  model: string;
  configured: boolean;
  hasApiKey: boolean;
  knowledgePath: string;
  knowledgeLoaded: boolean;
  knowledgeUpdatedAt: string | null;
  includeGroups: boolean;
  maxReplyChars: number;
  cooldownMs: number;
  lastError: string | null;
}

export interface AiConfigResponse extends AiStatus {
  knowledgeMaxChars: number;
  temperature: number;
  systemPrompt: string;
}

export interface UpdateAiConfigPayload {
  enabled?: boolean;
  geminiApiKey?: string;
  clearApiKey?: boolean;
  geminiModel?: string;
  knowledgePath?: string;
  knowledgeMaxChars?: number;
  maxReplyChars?: number;
  cooldownMs?: number;
  includeGroups?: boolean;
  temperature?: number;
  systemPrompt?: string;
}

export interface AiKnowledgeResponse {
  path: string;
  content: string;
  updatedAt: string | null;
}

export type AiInteractionStatus = 'replied' | 'skipped' | 'failed';

export interface AiInteraction {
  id: string;
  timestamp: string;
  sessionId: string;
  chatId: string;
  messageId: string;
  from: string;
  question: string;
  reply: string | null;
  status: AiInteractionStatus;
  reason?: string;
  error?: string;
  model: string;
}

@Injectable()
export class AiReplyService implements OnModuleInit {
  private readonly logger = new Logger(AiReplyService.name);
  private readonly pluginId = 'noxus-ai-auto-reply';
  private readonly sentMessageIds = new Set<string>();
  private readonly chatCooldowns = new Map<string, number>();
  private readonly aiDataDir = path.resolve(process.cwd(), 'data', 'ai');
  private readonly settingsPath = path.resolve(process.cwd(), 'data', 'ai', 'settings.json');
  private readonly interactionsPath = path.resolve(process.cwd(), 'data', 'ai', 'interactions.jsonl');
  private client: GoogleGenAI | null = null;
  private knowledgeCache: KnowledgeCache | null = null;
  private runtimeSettings: AiRuntimeSettings = {};
  private lastError: string | null = null;
  private missingKeyWarned = false;
  private missingKnowledgeWarned = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly hookManager: HookManager,
    private readonly messageService: MessageService,
    private readonly apiLinksService: AiApiLinksService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadRuntimeSettings();
    this.hookManager.register(this.pluginId, 'message:received', ctx => this.handleIncomingMessage(ctx), 50);

    if (this.isEnabled()) {
      this.logger.log('NOXUS AI auto-reply hook registered');
    } else {
      this.logger.log('NOXUS AI auto-reply is installed but disabled');
    }
  }

  async getStatus(): Promise<AiStatus> {
    await this.loadKnowledge();

    return {
      enabled: this.isEnabled(),
      provider: this.provider,
      model: this.model,
      configured: this.isConfigured(),
      hasApiKey: this.geminiApiKey.length > 0,
      knowledgePath: this.knowledgePath,
      knowledgeLoaded: this.knowledgeCache !== null,
      knowledgeUpdatedAt: this.knowledgeCache?.loadedAt.toISOString() ?? null,
      includeGroups: this.includeGroups,
      maxReplyChars: this.maxReplyChars,
      cooldownMs: this.cooldownMs,
      lastError: this.lastError,
    };
  }

  async getConfig(): Promise<AiConfigResponse> {
    return {
      ...(await this.getStatus()),
      knowledgeMaxChars: this.knowledgeMaxChars,
      temperature: this.temperature,
      systemPrompt: this.systemPrompt,
    };
  }

  async updateConfig(payload: UpdateAiConfigPayload): Promise<AiConfigResponse> {
    const next: AiRuntimeSettings = { ...this.runtimeSettings };
    const previousKnowledgePath = this.knowledgePath;

    if (typeof payload.enabled === 'boolean') next.enabled = payload.enabled;
    if (typeof payload.includeGroups === 'boolean') next.includeGroups = payload.includeGroups;
    if (payload.geminiModel !== undefined)
      next.geminiModel = this.cleanText(payload.geminiModel, 120) || 'gemini-2.5-flash';
    if (payload.knowledgePath !== undefined)
      next.knowledgePath = this.cleanText(payload.knowledgePath, 300) || './data/knowledge/noxus.md';
    if (payload.systemPrompt !== undefined)
      next.systemPrompt = this.cleanText(payload.systemPrompt, 4000) || this.defaultSystemPrompt;
    if (payload.knowledgeMaxChars !== undefined)
      next.knowledgeMaxChars = this.clampNumber(payload.knowledgeMaxChars, 1000, 100000, 20000);
    if (payload.maxReplyChars !== undefined)
      next.maxReplyChars = this.clampNumber(payload.maxReplyChars, 120, 4000, 900);
    if (payload.cooldownMs !== undefined) next.cooldownMs = this.clampNumber(payload.cooldownMs, 0, 600000, 30000);
    if (payload.temperature !== undefined) next.temperature = this.clampNumber(payload.temperature, 0, 1.5, 0.35);

    if (payload.clearApiKey) {
      next.geminiApiKey = '';
    } else if (payload.geminiApiKey !== undefined) {
      const key = payload.geminiApiKey.trim();
      if (key) next.geminiApiKey = key;
    }

    next.provider = 'gemini';
    await this.saveRuntimeSettings(next);
    this.runtimeSettings = next;
    this.client = null;
    this.missingKeyWarned = false;

    if (previousKnowledgePath !== this.knowledgePath) {
      this.knowledgeCache = null;
      this.missingKnowledgeWarned = false;
    }

    return this.getConfig();
  }

  async getKnowledge(): Promise<AiKnowledgeResponse> {
    const filePath = this.resolveKnowledgePath();

    try {
      const [rawContent, fileStat] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
      return {
        path: this.knowledgePath,
        content: rawContent,
        updatedAt: fileStat.mtime.toISOString(),
      };
    } catch {
      return {
        path: this.knowledgePath,
        content: '',
        updatedAt: null,
      };
    }
  }

  async updateKnowledge(content: string): Promise<AiKnowledgeResponse> {
    const filePath = this.resolveKnowledgePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content ?? '', 'utf8');
    this.knowledgeCache = null;
    this.missingKnowledgeWarned = false;
    return this.getKnowledge();
  }

  async getInteractions(limit = 100): Promise<AiInteraction[]> {
    const safeLimit = this.clampNumber(limit, 1, 500, 100);

    try {
      const rawContent = await readFile(this.interactionsPath, 'utf8');
      const lines = rawContent.trim().split(/\r?\n/).filter(Boolean).slice(-safeLimit);

      return lines
        .map(line => {
          try {
            return JSON.parse(line) as AiInteraction;
          } catch {
            return null;
          }
        })
        .filter((item): item is AiInteraction => item !== null)
        .reverse();
    } catch {
      return [];
    }
  }

  async clearInteractions(): Promise<void> {
    await mkdir(this.aiDataDir, { recursive: true });
    await writeFile(this.interactionsPath, '', 'utf8');
  }

  private async handleIncomingMessage(ctx: HookContext): Promise<HookResult> {
    const message = ctx.data as IncomingMessage;

    if (!ctx.sessionId || !this.isIncomingCustomerText(message)) {
      return { continue: true, data: message };
    }

    if (!this.isEnabled()) {
      return { continue: true, data: message };
    }

    if (message.isGroup && !this.includeGroups) {
      await this.logInteraction(message, ctx.sessionId, 'skipped', null, 'group_disabled');
      return { continue: true, data: message };
    }

    if (!this.isConfigured()) {
      this.warnOnceForMissingKey();
      await this.logInteraction(message, ctx.sessionId, 'skipped', null, 'missing_api_key');
      return { continue: true, data: message };
    }

    const chatKey = `${ctx.sessionId}:${message.chatId}`;
    const now = Date.now();
    const lastReplyAt = this.chatCooldowns.get(chatKey) ?? 0;
    if (now - lastReplyAt < this.cooldownMs) {
      await this.logInteraction(message, ctx.sessionId, 'skipped', null, 'cooldown');
      return { continue: true, data: message };
    }

    try {
      const knowledge = await this.loadKnowledge();
      if (!knowledge) {
        this.warnOnceForMissingKnowledge();
        await this.logInteraction(message, ctx.sessionId, 'skipped', null, 'missing_knowledge');
        return { continue: true, data: message };
      }

      const apiContexts = await this.gatherApiContexts(knowledge);
      const reply = await this.generateReply(message, knowledge, apiContexts);
      if (!reply) {
        await this.logInteraction(message, ctx.sessionId, 'skipped', null, 'empty_model_reply');
        return { continue: true, data: message };
      }

      await this.messageService.sendText(ctx.sessionId, {
        chatId: message.chatId,
        text: reply,
      });

      this.sentMessageIds.add(message.id);
      this.chatCooldowns.set(chatKey, now);
      this.trimSeenMessages();
      this.lastError = null;
      await this.logInteraction(message, ctx.sessionId, 'replied', reply);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.logInteraction(message, ctx.sessionId, 'failed', null, 'reply_failed', this.lastError);
      this.logger.error('NOXUS AI reply failed', this.lastError, {
        sessionId: ctx.sessionId,
        chatId: message.chatId,
        messageId: message.id,
      });
    }

    return { continue: true, data: message };
  }

  private isIncomingCustomerText(message: IncomingMessage): boolean {
    if (message.fromMe || this.sentMessageIds.has(message.id)) {
      return false;
    }

    const text = message.body?.trim();
    if (!text) {
      return false;
    }

    return ['chat', 'text'].includes(message.type);
  }

  private async generateReply(
    message: IncomingMessage,
    knowledge: string,
    apiContexts: FetchedApiContext[],
  ): Promise<string | null> {
    const client = this.getClient();
    const response = await client.models.generateContent({
      model: this.model,
      contents: this.buildPrompt(message, knowledge, apiContexts),
      config: {
        systemInstruction: this.systemPrompt,
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return null;
    }

    return this.limitReply(text);
  }

  private async gatherApiContexts(knowledge: string): Promise<FetchedApiContext[]> {
    const slugs = this.apiLinksService.extractSlugs(knowledge);
    if (!slugs.length) return [];

    try {
      return await this.apiLinksService.fetchSlugs(slugs);
    } catch (error) {
      this.logger.warn(`Failed to gather API contexts: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private buildPrompt(message: IncomingMessage, knowledge: string, apiContexts: FetchedApiContext[]): string {
    const parts = [
      'Customer WhatsApp message:',
      message.body.trim(),
      '',
      'Internal NOXUS AI knowledge base:',
      knowledge,
    ];

    if (apiContexts.length) {
      parts.push('');
      parts.push('Live API context (fetched from APIs referenced as /slug in the knowledge base):');
      for (const ctx of apiContexts) {
        parts.push('');
        parts.push(`[API /${ctx.slug}] ${ctx.name}`);
        if (ctx.description) {
          parts.push(`Description: ${ctx.description}`);
        }
        if (ctx.ok) {
          parts.push(`Response (status ${ctx.status ?? 'n/a'}):`);
          parts.push(ctx.body || '(empty body)');
        } else {
          parts.push(`Response failed: ${ctx.error ?? 'unknown error'}`);
        }
      }
    }

    parts.push('');
    parts.push('Reply rules:');
    parts.push('- Reply in the same language the customer used.');
    parts.push('- Use only the internal knowledge base and the live API context above.');
    parts.push(
      '- When a knowledge entry references an API with /slug, prefer the live data from that API over guesses.',
    );
    parts.push(
      '- If neither the knowledge base nor the API context contains the answer, say the team will follow up instead of inventing details.',
    );
    parts.push('- Keep the reply concise and suitable for WhatsApp.');
    parts.push('- Do not mention the model, prompts, slugs, API URLs, or internal knowledge base.');

    return parts.join('\n');
  }

  private async loadKnowledge(): Promise<string | null> {
    const filePath = this.resolveKnowledgePath();

    try {
      const fileStat = await stat(filePath);
      if (this.knowledgeCache && this.knowledgeCache.mtimeMs === fileStat.mtimeMs) {
        return this.knowledgeCache.content;
      }

      const rawContent = await readFile(filePath, 'utf8');
      const content = rawContent.trim().slice(0, this.knowledgeMaxChars);
      if (!content) {
        this.knowledgeCache = null;
        return null;
      }

      this.knowledgeCache = {
        content,
        mtimeMs: fileStat.mtimeMs,
        loadedAt: new Date(),
      };
      this.missingKnowledgeWarned = false;
      return content;
    } catch (error) {
      this.knowledgeCache = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private async loadRuntimeSettings(): Promise<void> {
    try {
      const rawContent = await readFile(this.settingsPath, 'utf8');
      this.runtimeSettings = JSON.parse(rawContent) as AiRuntimeSettings;
    } catch {
      this.runtimeSettings = {};
    }
  }

  private async saveRuntimeSettings(settings: AiRuntimeSettings): Promise<void> {
    await mkdir(this.aiDataDir, { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  private async logInteraction(
    message: IncomingMessage,
    sessionId: string,
    status: AiInteractionStatus,
    reply: string | null,
    reason?: string,
    error?: string,
  ): Promise<void> {
    const interaction: AiInteraction = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      chatId: message.chatId,
      messageId: message.id,
      from: message.from,
      question: message.body?.trim() ?? '',
      reply,
      status,
      reason,
      error,
      model: this.model,
    };

    try {
      await mkdir(this.aiDataDir, { recursive: true });
      await appendFile(this.interactionsPath, `${JSON.stringify(interaction)}\n`, 'utf8');
    } catch (logError) {
      this.logger.warn(
        `Failed to persist NOXUS AI interaction log: ${logError instanceof Error ? logError.message : String(logError)}`,
      );
    }
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.geminiApiKey });
    }
    return this.client;
  }

  private limitReply(text: string): string {
    if (text.length <= this.maxReplyChars) {
      return text;
    }

    return `${text.slice(0, this.maxReplyChars - 1).trimEnd()}.`;
  }

  private trimSeenMessages(): void {
    if (this.sentMessageIds.size <= 500) {
      return;
    }

    const excess = this.sentMessageIds.size - 500;
    for (const id of Array.from(this.sentMessageIds).slice(0, excess)) {
      this.sentMessageIds.delete(id);
    }
  }

  private resolveKnowledgePath(): string {
    return path.isAbsolute(this.knowledgePath) ? this.knowledgePath : path.resolve(process.cwd(), this.knowledgePath);
  }

  private isEnabled(): boolean {
    return this.runtimeSettings.enabled ?? this.configService.get<boolean>('ai.enabled', false);
  }

  private isConfigured(): boolean {
    return this.provider === 'gemini' && this.geminiApiKey.length > 0;
  }

  private warnOnceForMissingKey(): void {
    if (this.missingKeyWarned) {
      return;
    }

    this.missingKeyWarned = true;
    this.logger.warn('NOXUS AI auto-reply is enabled but GEMINI_API_KEY is missing');
  }

  private warnOnceForMissingKnowledge(): void {
    if (this.missingKnowledgeWarned) {
      return;
    }

    this.missingKnowledgeWarned = true;
    this.logger.warn(`NOXUS AI knowledge base is missing or empty: ${this.knowledgePath}`);
  }

  private cleanText(value: string, maxLength: number): string {
    return String(value).trim().slice(0, maxLength);
  }

  private clampNumber(value: number, min: number, max: number, fallback: number): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, numericValue));
  }

  private get defaultSystemPrompt(): string {
    return 'You are NOXUS AI customer support on WhatsApp. You are accurate, concise, and grounded only in company-provided knowledge.';
  }

  private get provider(): string {
    return this.runtimeSettings.provider ?? this.configService.get<string>('ai.provider', 'gemini');
  }

  private get geminiApiKey(): string {
    return (this.runtimeSettings.geminiApiKey ?? this.configService.get<string>('ai.geminiApiKey', '')).trim();
  }

  private get model(): string {
    return this.runtimeSettings.geminiModel ?? this.configService.get<string>('ai.geminiModel', 'gemini-2.5-flash');
  }

  private get knowledgePath(): string {
    return (
      this.runtimeSettings.knowledgePath ??
      this.configService.get<string>('ai.knowledgePath', './data/knowledge/noxus.md')
    );
  }

  private get systemPrompt(): string {
    return (
      this.runtimeSettings.systemPrompt ?? this.configService.get<string>('ai.systemPrompt', this.defaultSystemPrompt)
    );
  }

  private get includeGroups(): boolean {
    return this.runtimeSettings.includeGroups ?? this.configService.get<boolean>('ai.includeGroups', false);
  }

  private get cooldownMs(): number {
    return this.runtimeSettings.cooldownMs ?? this.configService.get<number>('ai.cooldownMs', 30000);
  }

  private get maxReplyChars(): number {
    return this.runtimeSettings.maxReplyChars ?? this.configService.get<number>('ai.maxReplyChars', 900);
  }

  private get knowledgeMaxChars(): number {
    return this.runtimeSettings.knowledgeMaxChars ?? this.configService.get<number>('ai.knowledgeMaxChars', 20000);
  }

  private get temperature(): number {
    return this.runtimeSettings.temperature ?? this.configService.get<number>('ai.temperature', 0.35);
  }

  private get maxOutputTokens(): number {
    return Math.max(64, Math.ceil(this.maxReplyChars / 3));
  }
}
