/**
 * Core type definitions for JevBrowserExt
 */

export type JevProviderType = 'typesafe' | 'openrouter' | 'cloudflare';
export type TextHelperProvider = 'openrouter' | 'deepseek' | 'openai';

export interface TypeSafeConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
  endpoint?: string;
}

export interface TextHelperConfig {
  provider: TextHelperProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Defaults applied when the text helper's base URL or model is left empty. */
export const TEXT_HELPER_PRESETS: Record<TextHelperProvider, { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

export interface AppSettings {
  activeProvider: JevProviderType;
  typesafe: TypeSafeConfig;
  openrouter: OpenRouterConfig;
  cloudflare: CloudflareConfig;
  textHelper: TextHelperConfig;
  maxSteps: number;
  stepDelayMs: number;
  showOverlay: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openrouter',
  typesafe: {
    apiKey: '',
    model: 'jev-latest',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
  },
  openrouter: {
    apiKey: '',
    model: 'typesafe/jev-1.13',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
  },
  cloudflare: {
    accountId: '',
    apiToken: '',
    model: 'typesafe/jev',
  },
  textHelper: {
    provider: 'openrouter',
    apiKey: '',
    baseUrl: TEXT_HELPER_PRESETS.openrouter.baseUrl,
    model: TEXT_HELPER_PRESETS.openrouter.model,
  },
  maxSteps: 30,
  stepDelayMs: 300,
  showOverlay: true,
};

/**
 * Model ids that earlier versions of this extension stored as defaults but that the provider
 * rejects today. They are rewritten on load so an old install keeps working after an update.
 * OpenRouter has no `typesafe/jev-latest`; that alias only exists on the TypeSafe API.
 */
export const OBSOLETE_OPENROUTER_JEV_MODELS: Record<string, string> = {
  'typesafe/jev-latest': 'typesafe/jev-1.13',
  'typesafe/jev': 'typesafe/jev-1.13',
};

/** Bare DeepSeek ids are only valid on api.deepseek.com; OpenRouter needs the vendor prefix. */
export const OBSOLETE_OPENROUTER_TEXT_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-r1',
};

/** Deep-merges stored settings over the defaults and migrates values known to be obsolete. */
export function mergeSettings(stored: Partial<AppSettings> | undefined | null): AppSettings {
  const s = stored || {};
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    typesafe: { ...DEFAULT_SETTINGS.typesafe, ...(s.typesafe || {}) },
    openrouter: { ...DEFAULT_SETTINGS.openrouter, ...(s.openrouter || {}) },
    cloudflare: { ...DEFAULT_SETTINGS.cloudflare, ...(s.cloudflare || {}) },
    textHelper: { ...DEFAULT_SETTINGS.textHelper, ...(s.textHelper || {}) },
  };

  const jevModel = (merged.openrouter.model || '').trim();
  merged.openrouter.model = OBSOLETE_OPENROUTER_JEV_MODELS[jevModel] || jevModel || DEFAULT_SETTINGS.openrouter.model;
  if (!(merged.openrouter.endpoint || '').trim()) merged.openrouter.endpoint = DEFAULT_SETTINGS.openrouter.endpoint;

  if (!(merged.typesafe.model || '').trim()) merged.typesafe.model = DEFAULT_SETTINGS.typesafe.model;
  if (!(merged.typesafe.endpoint || '').trim()) merged.typesafe.endpoint = DEFAULT_SETTINGS.typesafe.endpoint;
  if (!(merged.cloudflare.model || '').trim()) merged.cloudflare.model = DEFAULT_SETTINGS.cloudflare.model;

  const helper = merged.textHelper;
  if (!TEXT_HELPER_PRESETS[helper.provider]) helper.provider = DEFAULT_SETTINGS.textHelper.provider;
  const preset = TEXT_HELPER_PRESETS[helper.provider];
  if (!(helper.baseUrl || '').trim()) helper.baseUrl = preset.baseUrl;
  const textModel = (helper.model || '').trim();
  helper.model =
    (helper.baseUrl.includes('openrouter.ai') && OBSOLETE_OPENROUTER_TEXT_MODELS[textModel]) || textModel || preset.model;

  return merged;
}

// Jev Question Primitives
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string | Record<string, any>;
  criteria: Record<string, any>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string | Record<string, any>;
  criteria?: Record<string, string>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string | Record<string, any>;
  min?: number;
  max?: number;
  criteria?: string[] | Record<string, string>;
}

export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export interface ObservedElement {
  index: string;
  label: string;
  role?: string;
  value?: string;
  operations: string[];
  checked?: string;
  selected?: string;
  expanded?: string;
  options?: Array<{ index: string; label: string; value: string }>;
}

export interface RecentAction {
  action?: string;
  kind?: string;
  text?: string;
  page_changed?: boolean;
}

export interface JevState {
  page: {
    url: string;
    title: string;
    text: string;
  };
  elements: ObservedElement[];
  recent_actions: RecentAction[];
}

export interface JevRequest {
  model: string;
  state: JevState;
  questions: JevQuestions;
}

export interface JevChoiceAnswer {
  type?: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevNoulAnswer {
  type?: 'noul';
  probability: number;
  noul?: number;
}

export interface JevScoreAnswer {
  type?: 'score';
  score: number;
  confidence?: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer | any>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// DOM Snapshot and Actions
export interface ElementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ActionKind = 'click' | 'fill' | 'select' | 'scroll' | 'wait';

export interface PageAction {
  id: string; // e.g. "e1", "e2", "scroll_down", "scroll_up", "wait"
  node?: number; // code-owned DOM node identity in the content script cache
  kind: ActionKind;
  role?: string;
  label: string;
  value?: string;
  current_value?: string;
  delta?: number;
  rect?: ElementRect;
  checked?: string;
  selected?: string;
  expanded?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: { y: number; height: number };
  actions: PageAction[];
  omitted_actions: number;
}

/** Result of executing one action inside the page. `stale` means nothing was executed. */
export interface ActResult {
  success: boolean;
  stale?: boolean;
  error?: string;
}

export type AgentStatus = 'idle' | 'running' | 'paused' | 'done' | 'blocked' | 'error';

export interface AgentStepLog {
  step: number;
  timestamp: number;
  operation: string;
  targetId?: string;
  targetLabel?: string;
  targetValue?: string;
  confidence?: number;
  latencyMs: number;
  provider: JevProviderType;
  probabilities?: Record<string, number>;
  error?: string;
}

export interface AgentProgress {
  status: AgentStatus;
  goal: string;
  currentStep: number;
  maxSteps: number;
  logs: AgentStepLog[];
  lastError?: string;
}

// Messages between Extension components
export type ExtensionMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SETTINGS_RESPONSE'; settings: AppSettings }
  | { type: 'SAVE_SETTINGS'; settings: AppSettings }
  | { type: 'START_AGENT'; goal: string; tabId?: number }
  | { type: 'STOP_AGENT' }
  | { type: 'STEP_AGENT'; goal: string; tabId?: number }
  | { type: 'GET_PROGRESS' }
  | { type: 'PROGRESS_UPDATE'; progress: AgentProgress }
  | { type: 'PING' }
  | { type: 'CONTENT_OBSERVE' }
  | { type: 'CONTENT_ACT'; action: PageAction; text?: string }
  | { type: 'CONTENT_STATUS'; text?: string; latencyMs?: number; clear?: boolean }
  | { type: 'TOGGLE_OVERLAY'; show: boolean; tabId?: number };
