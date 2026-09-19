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

/** Deep-merges stored settings over the defaults so new nested keys always exist. */
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

  // Auto-migrate obsolete or invalid OpenRouter model IDs stored in Chrome storage
  if (
    !merged.openrouter.model ||
    merged.openrouter.model === 'typesafe/jev-latest' ||
    merged.openrouter.model === 'jev-latest'
  ) {
    merged.openrouter.model = 'typesafe/jev-1.13';
  }

  // Auto-migrate obsolete text helper models (404 models or ambiguous slugs)
  if (
    merged.textHelper.model === 'deepseek-chat' ||
    merged.textHelper.model?.includes('1.5-8b') ||
    !merged.textHelper.model
  ) {
    merged.textHelper.model = 'deepseek/deepseek-chat';
  }

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
  | { type: 'START_AGENT'; goal: string }
  | { type: 'STOP_AGENT' }
  | { type: 'STEP_AGENT'; goal: string }
  | { type: 'GET_PROGRESS' }
  | { type: 'PROGRESS_UPDATE'; progress: AgentProgress }
  | { type: 'PING' }
  | { type: 'CONTENT_OBSERVE' }
  | { type: 'CONTENT_ACT'; action: PageAction; text?: string }
  | { type: 'CONTENT_STATUS'; text?: string; latencyMs?: number; clear?: boolean }
  | { type: 'TOGGLE_OVERLAY'; show: boolean };
