import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Slash,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useAiApisQuery,
  useAiConfigQuery,
  useAiInteractionsQuery,
  useAiKnowledgeQuery,
  useClearAiInteractionsMutation,
  useCreateAiApiMutation,
  useDeleteAiApiMutation,
  useTestAiApiMutation,
  useUpdateAiApiMutation,
  useUpdateAiConfigMutation,
  useUpdateAiKnowledgeMutation,
} from '../hooks/queries';
import type {
  AiApiLink,
  AiApiTestResult,
  AiInteraction,
  CreateAiApiLinkPayload,
  UpdateAiConfigPayload,
} from '../services/api';
import './AiManager.css';

interface SettingsDraft {
  enabled: boolean;
  geminiApiKey: string;
  geminiModel: string;
  knowledgePath: string;
  knowledgeMaxChars: number;
  maxReplyChars: number;
  cooldownMs: number;
  includeGroups: boolean;
  temperature: number;
  systemPrompt: string;
}

interface ApiFormState {
  slug: string;
  name: string;
  description: string;
  url: string;
  method: 'GET' | 'POST';
  headersText: string;
  body: string;
  enabled: boolean;
}

const defaultDraft: SettingsDraft = {
  enabled: false,
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  knowledgePath: './data/knowledge/noxus.md',
  knowledgeMaxChars: 20000,
  maxReplyChars: 900,
  cooldownMs: 30000,
  includeGroups: false,
  temperature: 0.35,
  systemPrompt:
    'You are NOXUS AI Open WhatsApp customer support. You are accurate, concise, and grounded only in company-provided knowledge.',
};

const emptyApiForm: ApiFormState = {
  slug: '',
  name: '',
  description: '',
  url: '',
  method: 'GET',
  headersText: '',
  body: '',
  enabled: true,
};

interface SlashSuggestionsState {
  open: boolean;
  query: string;
  startIndex: number;
}

export function AiManager() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('aiManager.title'));
  const toast = useToast();
  const { data: config, isLoading: configLoading } = useAiConfigQuery();
  const { data: knowledge, isLoading: knowledgeLoading } = useAiKnowledgeQuery();
  const {
    data: interactions = [],
    isLoading: interactionsLoading,
    refetch: refetchInteractions,
  } = useAiInteractionsQuery(100);
  const { data: apis = [], isLoading: apisLoading, refetch: refetchApis } = useAiApisQuery();
  const updateConfig = useUpdateAiConfigMutation();
  const updateKnowledge = useUpdateAiKnowledgeMutation();
  const clearInteractions = useClearAiInteractionsMutation(100);
  const createApi = useCreateAiApiMutation();
  const updateApi = useUpdateAiApiMutation();
  const deleteApi = useDeleteAiApiMutation();
  const testApi = useTestAiApiMutation();

  const [draft, setDraft] = useState<SettingsDraft>(defaultDraft);
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [apiForm, setApiForm] = useState<ApiFormState>(emptyApiForm);
  const [editingApiId, setEditingApiId] = useState<string | null>(null);
  const [showApiForm, setShowApiForm] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, AiApiTestResult>>({});
  const [slashState, setSlashState] = useState<SlashSuggestionsState>({ open: false, query: '', startIndex: -1 });
  const knowledgeRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!config) return;
    setDraft({
      enabled: config.enabled,
      geminiApiKey: '',
      geminiModel: config.model || defaultDraft.geminiModel,
      knowledgePath: config.knowledgePath || defaultDraft.knowledgePath,
      knowledgeMaxChars: config.knowledgeMaxChars || defaultDraft.knowledgeMaxChars,
      maxReplyChars: config.maxReplyChars || defaultDraft.maxReplyChars,
      cooldownMs: config.cooldownMs ?? defaultDraft.cooldownMs,
      includeGroups: config.includeGroups,
      temperature: config.temperature ?? defaultDraft.temperature,
      systemPrompt: config.systemPrompt || defaultDraft.systemPrompt,
    });
  }, [config]);

  useEffect(() => {
    if (!knowledge) return;
    setKnowledgeDraft(knowledge.content);
  }, [knowledge]);

  const updateDraft = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const saveConfig = async () => {
    const payload: UpdateAiConfigPayload = {
      enabled: draft.enabled,
      geminiModel: draft.geminiModel,
      knowledgePath: draft.knowledgePath,
      knowledgeMaxChars: draft.knowledgeMaxChars,
      maxReplyChars: draft.maxReplyChars,
      cooldownMs: draft.cooldownMs,
      includeGroups: draft.includeGroups,
      temperature: draft.temperature,
      systemPrompt: draft.systemPrompt,
      clearApiKey: clearKey,
    };

    if (draft.geminiApiKey.trim()) {
      payload.geminiApiKey = draft.geminiApiKey.trim();
    }

    try {
      await updateConfig.mutateAsync(payload);
      setClearKey(false);
      updateDraft('geminiApiKey', '');
      toast.success(t('aiManager.toasts.configSaved'));
    } catch (error) {
      toast.error(t('aiManager.toasts.configFailed'), error instanceof Error ? error.message : t('common.unknownError'));
    }
  };

  const saveKnowledge = async () => {
    try {
      await updateKnowledge.mutateAsync(knowledgeDraft);
      toast.success(t('aiManager.toasts.knowledgeSaved'));
    } catch (error) {
      toast.error(t('aiManager.toasts.knowledgeFailed'), error instanceof Error ? error.message : t('common.unknownError'));
    }
  };

  const handleClearInteractions = async () => {
    try {
      await clearInteractions.mutateAsync();
      toast.success(t('aiManager.toasts.logsCleared'));
    } catch (error) {
      toast.error(t('aiManager.toasts.logsFailed'), error instanceof Error ? error.message : t('common.unknownError'));
    }
  };

  const startCreateApi = () => {
    setApiForm(emptyApiForm);
    setEditingApiId(null);
    setShowApiForm(true);
  };

  const startEditApi = (api: AiApiLink) => {
    setApiForm({
      slug: api.slug,
      name: api.name,
      description: api.description,
      url: api.url,
      method: api.method,
      headersText: Object.entries(api.headers || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      body: api.body ?? '',
      enabled: api.enabled,
    });
    setEditingApiId(api.id);
    setShowApiForm(true);
  };

  const closeApiForm = () => {
    setShowApiForm(false);
    setEditingApiId(null);
    setApiForm(emptyApiForm);
  };

  const submitApiForm = async () => {
    const trimmedSlug = apiForm.slug.trim().toLowerCase().replace(/^\/+/, '');
    if (!trimmedSlug) {
      toast.error(t('aiManager.apis.errors.slugRequired'));
      return;
    }
    if (!apiForm.url.trim()) {
      toast.error(t('aiManager.apis.errors.urlRequired'));
      return;
    }
    const headers = parseHeaders(apiForm.headersText);
    const payload: CreateAiApiLinkPayload = {
      slug: trimmedSlug,
      name: apiForm.name.trim() || trimmedSlug,
      description: apiForm.description.trim(),
      url: apiForm.url.trim(),
      method: apiForm.method,
      headers,
      body: apiForm.method === 'POST' ? apiForm.body : undefined,
      enabled: apiForm.enabled,
    };

    try {
      if (editingApiId) {
        await updateApi.mutateAsync({ id: editingApiId, payload });
        toast.success(t('aiManager.apis.toasts.updated'));
      } else {
        await createApi.mutateAsync(payload);
        toast.success(t('aiManager.apis.toasts.created'));
      }
      closeApiForm();
    } catch (error) {
      toast.error(
        editingApiId ? t('aiManager.apis.toasts.updateFailed') : t('aiManager.apis.toasts.createFailed'),
        error instanceof Error ? error.message : t('common.unknownError'),
      );
    }
  };

  const removeApi = async (api: AiApiLink) => {
    if (!window.confirm(t('aiManager.apis.confirmDelete', { name: api.name }))) {
      return;
    }
    try {
      await deleteApi.mutateAsync(api.id);
      toast.success(t('aiManager.apis.toasts.deleted'));
    } catch (error) {
      toast.error(t('aiManager.apis.toasts.deleteFailed'), error instanceof Error ? error.message : t('common.unknownError'));
    }
  };

  const runTestApi = async (api: AiApiLink) => {
    try {
      const result = await testApi.mutateAsync(api.id);
      setTestResults(prev => ({ ...prev, [api.id]: result }));
      if (result.ok) {
        toast.success(t('aiManager.apis.toasts.testOk', { ms: result.durationMs }));
      } else {
        toast.error(t('aiManager.apis.toasts.testFailed'), result.error ?? `HTTP ${result.status}`);
      }
    } catch (error) {
      toast.error(t('aiManager.apis.toasts.testFailed'), error instanceof Error ? error.message : t('common.unknownError'));
    }
  };

  const insertSlug = (slug: string) => {
    const ta = knowledgeRef.current;
    if (!ta) return;
    const value = knowledgeDraft;
    const cursor = ta.selectionStart ?? value.length;
    const start = slashState.startIndex >= 0 ? slashState.startIndex : cursor;
    const before = value.slice(0, start);
    const after = value.slice(cursor);
    const insert = `/${slug}`;
    const next = `${before}${insert}${after}`;
    setKnowledgeDraft(next);
    setSlashState({ open: false, query: '', startIndex: -1 });
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = start + insert.length;
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const handleKnowledgeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setKnowledgeDraft(value);
    const cursor = event.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const slashIndex = before.lastIndexOf('/');
    if (slashIndex === -1) {
      setSlashState({ open: false, query: '', startIndex: -1 });
      return;
    }

    const prevChar = slashIndex === 0 ? '' : before.charAt(slashIndex - 1);
    const isBoundary = slashIndex === 0 || /[\s\n([{,.;:]/.test(prevChar);
    const segment = before.slice(slashIndex + 1);
    if (!isBoundary || /\s/.test(segment) || segment.length > 32) {
      setSlashState({ open: false, query: '', startIndex: -1 });
      return;
    }

    setSlashState({ open: true, query: segment.toLowerCase(), startIndex: slashIndex });
  };

  const handleKnowledgeKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && slashState.open) {
      event.preventDefault();
      setSlashState({ open: false, query: '', startIndex: -1 });
    }
  };

  const filteredSuggestions = useMemo(() => {
    const enabledApis = apis.filter(api => api.enabled);
    if (!slashState.query) return enabledApis.slice(0, 6);
    return enabledApis
      .filter(api => api.slug.toLowerCase().includes(slashState.query) || api.name.toLowerCase().includes(slashState.query))
      .slice(0, 6);
  }, [apis, slashState.query]);

  const referencedSlugs = useMemo(() => {
    const matches = knowledgeDraft.match(/\/([a-z0-9][a-z0-9_-]{1,38}[a-z0-9])/gi);
    if (!matches) return [];
    const set = new Set<string>();
    for (const raw of matches) {
      set.add(raw.slice(1).toLowerCase());
    }
    return [...set];
  }, [knowledgeDraft]);

  const ready = Boolean(config?.enabled && config.configured && config.knowledgeLoaded);
  const statusLabel = ready
    ? t('aiManager.status.ready')
    : config?.enabled
      ? t('aiManager.status.needsSetup')
      : t('aiManager.status.off');

  const locale = i18n.resolvedLanguage || i18n.language;
  const formatDate = (value?: string | null) => {
    if (!value) return t('common.never');
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  };

  if (configLoading || knowledgeLoading) {
    return (
      <div className="ai-manager-page ai-manager-loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="ai-manager-page">
      <PageHeader
        title={t('aiManager.title')}
        subtitle={t('aiManager.subtitle')}
        badge={<span className={`ai-live-badge ${ready ? 'ready' : config?.enabled ? 'attention' : 'off'}`}>{statusLabel}</span>}
        actions={
          <button className="ai-button secondary" onClick={() => void refetchInteractions()}>
            <RefreshCw size={16} />
            {t('common.refresh')}
          </button>
        }
      />

      <section className="ai-status-grid">
        <StatusCard
          icon={Power}
          label={t('aiManager.cards.autoReply')}
          value={draft.enabled ? t('common.enabled') : t('common.disabled')}
          state={draft.enabled ? 'ready' : 'off'}
        />
        <StatusCard
          icon={KeyRound}
          label={t('aiManager.cards.key')}
          value={config?.hasApiKey ? t('aiManager.cards.keyReady') : t('aiManager.cards.keyMissing')}
          state={config?.hasApiKey ? 'ready' : 'attention'}
        />
        <StatusCard
          icon={Database}
          label={t('aiManager.cards.knowledge')}
          value={config?.knowledgeLoaded ? t('common.active') : t('common.inactive')}
          state={config?.knowledgeLoaded ? 'ready' : 'attention'}
        />
        <StatusCard
          icon={Plug}
          label={t('aiManager.cards.apis')}
          value={String(apis.filter(api => api.enabled).length)}
          state={apis.length ? 'ready' : 'neutral'}
        />
      </section>

      <div className="ai-manager-layout">
        <section className="ai-panel">
          <PanelHeader icon={BrainCircuit} title={t('aiManager.settings.title')} subtitle={t('aiManager.settings.subtitle')} />

          <div className="ai-switch-row">
            <div>
              <strong>{t('aiManager.settings.enable')}</strong>
              <span>{t('aiManager.settings.enableHint')}</span>
            </div>
            <label className="ai-switch">
              <input type="checkbox" checked={draft.enabled} onChange={event => updateDraft('enabled', event.target.checked)} />
              <span />
            </label>
          </div>

          <div className="ai-form-grid">
            <label className="ai-field">
              <span>{t('aiManager.settings.geminiKey')}</span>
              <div className="ai-secret-input">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draft.geminiApiKey}
                  onChange={event => updateDraft('geminiApiKey', event.target.value)}
                  placeholder={config?.hasApiKey ? t('aiManager.settings.keyConfigured') : t('aiManager.settings.keyPlaceholder')}
                  autoComplete="off"
                />
                <button type="button" onClick={() => setShowKey(prev => !prev)} aria-label={showKey ? t('aiManager.settings.hideKey') : t('aiManager.settings.showKey')}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <label className="ai-field">
              <span>{t('aiManager.settings.model')}</span>
              <input value={draft.geminiModel} onChange={event => updateDraft('geminiModel', event.target.value)} />
            </label>

            <label className="ai-field">
              <span>{t('aiManager.settings.knowledgePath')}</span>
              <input value={draft.knowledgePath} onChange={event => updateDraft('knowledgePath', event.target.value)} />
            </label>

            <label className="ai-field">
              <span>{t('aiManager.settings.maxReplyChars')}</span>
              <input
                type="number"
                min={120}
                max={4000}
                value={draft.maxReplyChars}
                onChange={event => updateDraft('maxReplyChars', Number(event.target.value))}
              />
            </label>

            <label className="ai-field">
              <span>{t('aiManager.settings.cooldown')}</span>
              <input
                type="number"
                min={0}
                max={600000}
                value={draft.cooldownMs}
                onChange={event => updateDraft('cooldownMs', Number(event.target.value))}
              />
            </label>

            <label className="ai-field">
              <span>{t('aiManager.settings.temperature')}</span>
              <input
                type="number"
                min={0}
                max={1.5}
                step={0.05}
                value={draft.temperature}
                onChange={event => updateDraft('temperature', Number(event.target.value))}
              />
            </label>
          </div>

          <label className="ai-check-row">
            <input type="checkbox" checked={draft.includeGroups} onChange={event => updateDraft('includeGroups', event.target.checked)} />
            <span>{t('aiManager.settings.includeGroups')}</span>
          </label>

          <label className="ai-check-row warning">
            <input type="checkbox" checked={clearKey} onChange={event => setClearKey(event.target.checked)} />
            <span>{t('aiManager.settings.clearKey')}</span>
          </label>

          <label className="ai-field full">
            <span>{t('aiManager.settings.systemPrompt')}</span>
            <textarea rows={4} value={draft.systemPrompt} onChange={event => updateDraft('systemPrompt', event.target.value)} />
          </label>

          <div className="ai-panel-footer">
            <button className="ai-button primary" onClick={saveConfig} disabled={updateConfig.isPending}>
              {updateConfig.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {t('aiManager.settings.save')}
            </button>
          </div>
        </section>

        <section className="ai-panel ai-knowledge-panel">
          <PanelHeader icon={Database} title={t('aiManager.knowledge.title')} subtitle={t('aiManager.knowledge.subtitle')} />
          <div className="ai-path-pill">{knowledge?.path || draft.knowledgePath}</div>
          <div className="ai-knowledge-hint">
            <Slash size={14} />
            <span>{t('aiManager.knowledge.slashHint')}</span>
          </div>
          <div className="ai-knowledge-wrapper">
            <textarea
              ref={knowledgeRef}
              className="ai-knowledge-editor"
              value={knowledgeDraft}
              onChange={handleKnowledgeChange}
              onKeyDown={handleKnowledgeKeyDown}
              placeholder={t('aiManager.knowledge.placeholder')}
            />
            {slashState.open && filteredSuggestions.length > 0 && (
              <div className="ai-slash-popover">
                <div className="ai-slash-title">
                  <Slash size={12} />
                  {t('aiManager.knowledge.slashTitle')}
                </div>
                <ul>
                  {filteredSuggestions.map(api => (
                    <li key={api.id}>
                      <button type="button" onClick={() => insertSlug(api.slug)}>
                        <span className="ai-slash-slug">/{api.slug}</span>
                        <span className="ai-slash-name">{api.name}</span>
                        {api.description && <span className="ai-slash-desc">{api.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {referencedSlugs.length > 0 && (
            <div className="ai-slash-summary">
              <Link2 size={14} />
              <span>{t('aiManager.knowledge.referenced')}</span>
              {referencedSlugs.map(slug => {
                const found = apis.find(api => api.slug === slug);
                const ok = found?.enabled;
                return (
                  <span key={slug} className={`ai-slash-chip ${found ? (ok ? 'ok' : 'warn') : 'missing'}`}>
                    /{slug}
                  </span>
                );
              })}
            </div>
          )}

          <div className="ai-panel-footer split">
            <span>{t('aiManager.knowledge.updatedAt', { value: formatDate(knowledge?.updatedAt) })}</span>
            <button className="ai-button primary" onClick={saveKnowledge} disabled={updateKnowledge.isPending}>
              {updateKnowledge.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {t('aiManager.knowledge.save')}
            </button>
          </div>
        </section>
      </div>

      <section className="ai-panel ai-apis-panel">
        <div className="ai-panel-heading">
          <PanelHeader icon={WebhookIcon} title={t('aiManager.apis.title')} subtitle={t('aiManager.apis.subtitle')} />
          <div className="ai-heading-actions">
            <button className="ai-button secondary" onClick={() => void refetchApis()}>
              <RefreshCw size={14} />
              {t('common.refresh')}
            </button>
            <button className="ai-button primary" onClick={startCreateApi}>
              <Plus size={14} />
              {t('aiManager.apis.add')}
            </button>
          </div>
        </div>

        {apisLoading ? (
          <div className="ai-empty-state">
            <Loader2 className="animate-spin" size={24} />
            <span>{t('common.loading')}</span>
          </div>
        ) : apis.length === 0 ? (
          <div className="ai-empty-state">
            <Plug size={26} />
            <span>{t('aiManager.apis.empty')}</span>
            <small>{t('aiManager.apis.emptyHint')}</small>
          </div>
        ) : (
          <div className="ai-api-list">
            {apis.map(api => (
              <ApiCard
                key={api.id}
                api={api}
                testResult={testResults[api.id]}
                onEdit={() => startEditApi(api)}
                onDelete={() => void removeApi(api)}
                onTest={() => void runTestApi(api)}
                onToggle={() =>
                  updateApi.mutate(
                    { id: api.id, payload: { enabled: !api.enabled } },
                    {
                      onError: error =>
                        toast.error(
                          t('aiManager.apis.toasts.updateFailed'),
                          error instanceof Error ? error.message : t('common.unknownError'),
                        ),
                    },
                  )
                }
                testing={testApi.isPending}
                formatDate={formatDate}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      {showApiForm && (
        <ApiFormModal
          form={apiForm}
          editing={Boolean(editingApiId)}
          onChange={setApiForm}
          onClose={closeApiForm}
          onSubmit={() => void submitApiForm()}
          pending={createApi.isPending || updateApi.isPending}
        />
      )}

      <section className="ai-panel ai-interactions-panel">
        <div className="ai-panel-heading">
          <PanelHeader icon={MessageSquare} title={t('aiManager.interactions.title')} subtitle={t('aiManager.interactions.subtitle')} />
          <div className="ai-heading-actions">
            <button className="ai-icon-button" onClick={() => void refetchInteractions()} aria-label={t('common.refresh')}>
              <RefreshCw size={16} />
            </button>
            <button className="ai-icon-button danger" onClick={handleClearInteractions} aria-label={t('aiManager.interactions.clear')}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {interactionsLoading ? (
          <div className="ai-empty-state">
            <Loader2 className="animate-spin" size={24} />
            <span>{t('common.loading')}</span>
          </div>
        ) : interactions.length === 0 ? (
          <div className="ai-empty-state">
            <Bot size={30} />
            <span>{t('aiManager.interactions.empty')}</span>
          </div>
        ) : (
          <div className="ai-interactions-list">
            {interactions.map(interaction => (
              <InteractionItem
                key={interaction.id}
                interaction={interaction}
                formatDate={formatDate}
                statusLabel={t(`aiManager.interactions.status.${interaction.status}`)}
                reasonLabel={interaction.reason ? t(`aiManager.interactions.reasons.${interaction.reason}`, { defaultValue: interaction.reason }) : undefined}
                questionLabel={t('aiManager.interactions.question')}
                replyLabel={t('aiManager.interactions.reply')}
                decisionLabel={t('aiManager.interactions.decision')}
                noReplyLabel={t('aiManager.interactions.noReply')}
              />
            ))}
          </div>
        )}
      </section>

      {config?.lastError && (
        <div className="ai-alert">
          <AlertTriangle size={18} />
          <span>{config.lastError}</span>
        </div>
      )}
    </div>
  );
}

function PanelHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="ai-panel-title">
      <span className="ai-panel-icon">
        <Icon size={18} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  state: 'ready' | 'attention' | 'off' | 'neutral';
}) {
  return (
    <div className={`ai-status-card ${state}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ApiCard({
  api,
  testResult,
  onEdit,
  onDelete,
  onTest,
  onToggle,
  testing,
  formatDate,
  t,
}: {
  api: AiApiLink;
  testResult?: AiApiTestResult;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggle: () => void;
  testing: boolean;
  formatDate: (value?: string | null) => string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <article className={`ai-api-card ${api.enabled ? 'on' : 'off'}`}>
      <header className="ai-api-card-header">
        <div className="ai-api-card-title">
          <code className="ai-api-slug">/{api.slug}</code>
          <strong>{api.name}</strong>
          <span className={`ai-api-method ${api.method.toLowerCase()}`}>{api.method}</span>
        </div>
        <label className="ai-switch small" aria-label={t('aiManager.apis.toggle')}>
          <input type="checkbox" checked={api.enabled} onChange={onToggle} />
          <span />
        </label>
      </header>
      {api.description && <p className="ai-api-description">{api.description}</p>}
      <div className="ai-api-url" title={api.url}>{api.url}</div>
      <div className="ai-api-meta">
        <span>{t('aiManager.apis.lastFetched', { value: formatDate(api.lastFetchedAt) })}</span>
        {api.lastStatus !== null && (
          <span className={`ai-api-status-pill ${api.lastError ? 'fail' : 'ok'}`}>
            HTTP {api.lastStatus}
          </span>
        )}
        {api.lastError && <span className="ai-api-error">{api.lastError}</span>}
      </div>
      {testResult && (
        <pre className={`ai-api-sample ${testResult.ok ? 'ok' : 'fail'}`}>
          {testResult.ok ? testResult.sample || '(empty response)' : testResult.error}
        </pre>
      )}
      <div className="ai-api-actions">
        <button className="ai-button secondary" onClick={onTest} disabled={testing}>
          {testing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          {t('aiManager.apis.test')}
        </button>
        <button className="ai-button secondary" onClick={onEdit}>
          <Pencil size={14} />
          {t('common.edit')}
        </button>
        <button className="ai-icon-button danger" onClick={onDelete} aria-label={t('common.delete')}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function ApiFormModal({
  form,
  editing,
  onChange,
  onClose,
  onSubmit,
  pending,
}: {
  form: ApiFormState;
  editing: boolean;
  onChange: (next: ApiFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const update = <K extends keyof ApiFormState>(key: K, value: ApiFormState[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="ai-modal-backdrop" onClick={onClose}>
      <div className="ai-modal" onClick={event => event.stopPropagation()}>
        <header className="ai-modal-header">
          <div>
            <h2>{editing ? t('aiManager.apis.editTitle') : t('aiManager.apis.createTitle')}</h2>
            <p>{t('aiManager.apis.formSubtitle')}</p>
          </div>
          <button className="ai-icon-button" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </header>

        <div className="ai-form-grid">
          <label className="ai-field">
            <span>{t('aiManager.apis.fields.slug')}</span>
            <input
              value={form.slug}
              onChange={event => update('slug', event.target.value)}
              placeholder="e.g. prices"
              autoFocus
            />
          </label>
          <label className="ai-field">
            <span>{t('aiManager.apis.fields.name')}</span>
            <input value={form.name} onChange={event => update('name', event.target.value)} placeholder="e.g. Live prices" />
          </label>
        </div>

        <label className="ai-field full">
          <span>{t('aiManager.apis.fields.description')}</span>
          <textarea
            rows={2}
            value={form.description}
            onChange={event => update('description', event.target.value)}
            placeholder={t('aiManager.apis.fields.descriptionPlaceholder')}
          />
        </label>

        <div className="ai-form-grid">
          <label className="ai-field">
            <span>{t('aiManager.apis.fields.method')}</span>
            <select value={form.method} onChange={event => update('method', event.target.value as 'GET' | 'POST')}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </label>
          <label className="ai-check-row">
            <input type="checkbox" checked={form.enabled} onChange={event => update('enabled', event.target.checked)} />
            <span>{t('aiManager.apis.fields.enabled')}</span>
          </label>
        </div>

        <label className="ai-field full">
          <span>{t('aiManager.apis.fields.url')}</span>
          <input value={form.url} onChange={event => update('url', event.target.value)} placeholder="https://api.example.com/data" />
        </label>

        <label className="ai-field full">
          <span>{t('aiManager.apis.fields.headers')}</span>
          <textarea
            rows={3}
            value={form.headersText}
            onChange={event => update('headersText', event.target.value)}
            placeholder={'Authorization: Bearer xyz\nX-Tenant: noxus'}
          />
        </label>

        {form.method === 'POST' && (
          <label className="ai-field full">
            <span>{t('aiManager.apis.fields.body')}</span>
            <textarea
              rows={4}
              value={form.body}
              onChange={event => update('body', event.target.value)}
              placeholder='{"query":"latest"}'
            />
          </label>
        )}

        <div className="ai-modal-footer">
          <button className="ai-button secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="ai-button primary" onClick={onSubmit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {editing ? t('common.save') : t('aiManager.apis.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

function InteractionItem({
  interaction,
  formatDate,
  statusLabel,
  reasonLabel,
  questionLabel,
  replyLabel,
  decisionLabel,
  noReplyLabel,
}: {
  interaction: AiInteraction;
  formatDate: (value?: string | null) => string;
  statusLabel: string;
  reasonLabel?: string;
  questionLabel: string;
  replyLabel: string;
  decisionLabel: string;
  noReplyLabel: string;
}) {
  return (
    <article className={`ai-interaction-item ${interaction.status}`}>
      <div className="ai-interaction-meta">
        <span className={`ai-interaction-status ${interaction.status}`}>{statusLabel}</span>
        <span>{formatDate(interaction.timestamp)}</span>
        <span>{interaction.sessionId}</span>
        <span>{interaction.from}</span>
      </div>
      <div className="ai-interaction-body">
        <div>
          <strong>
            <MessageSquare size={14} />
            {questionLabel}
          </strong>
          <p>{interaction.question}</p>
        </div>
        <div>
          <strong>
            {interaction.status === 'replied' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
            {interaction.status === 'replied' ? replyLabel : decisionLabel}
          </strong>
          <p>{interaction.reply || interaction.error || reasonLabel || noReplyLabel}</p>
        </div>
      </div>
    </article>
  );
}

function parseHeaders(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}
