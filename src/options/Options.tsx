import React, { useEffect, useState } from 'react';
import { callJevProvider } from '../shared/providers';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  JevProviderType,
  JevRequest,
  TEXT_HELPER_PRESETS,
  TextHelperProvider,
} from '../shared/types';

/** A minimal, valid decision request used by the connection test. */
const TEST_REQUEST: Omit<JevRequest, 'model'> = {
  state: {
    page: { url: 'https://example.com', title: 'Example', text: 'Example Domain' },
    elements: [{ index: '1', label: 'More information', operations: ['CLICK'] }],
    recent_actions: [],
  },
  questions: {
    operation: {
      type: 'choice',
      criteria: { CLICK: 'Click more information', DONE: 'Done' },
      instructions: 'Pick an operation',
    },
    click_target: {
      type: 'choice',
      criteria: { '1': { element: '[1] More information' } },
      instructions: 'Which element to click?',
    },
  },
};

export const Options: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<JevProviderType>('openrouter');
  const [savedToast, setSavedToast] = useState(false);
  const [testingStatus, setTestingStatus] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res?: { settings?: AppSettings }) => {
      if (res?.settings) {
        setSettings(res.settings);
        setActiveTab(res.settings.activeProvider || 'openrouter');
      }
    });
  }, []);

  const handleSave = () => {
    chrome.runtime.sendMessage(
      { type: 'SAVE_SETTINGS', settings },
      () => {
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 2500);
      }
    );
  };

  const handleTestConnection = async (provider: JevProviderType) => {
    setTestingStatus(`Testing ${provider.toUpperCase()} connection...`);
    try {
      const testSettings: AppSettings = { ...settings, activeProvider: provider };
      const model =
        provider === 'typesafe'
          ? settings.typesafe.model
          : provider === 'openrouter'
          ? settings.openrouter.model
          : settings.cloudflare.model;
      const started = Date.now();
      const res = await callJevProvider(testSettings, { model, ...TEST_REQUEST });
      const summary = JSON.stringify(res.answers?.operation ?? res.answers ?? res).slice(0, 120);
      setTestingStatus(`✅ Success in ${Date.now() - started}ms. operation → ${summary}`);
    } catch (err: any) {
      setTestingStatus(`❌ Test failed: ${err?.message || String(err)}`);
    }
  };

  const handleTextProviderChange = (provider: TextHelperProvider) => {
    const preset = TEXT_HELPER_PRESETS[provider];
    setSettings({
      ...settings,
      textHelper: { ...settings.textHelper, provider, baseUrl: preset.baseUrl, model: preset.model },
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>⚡ Jev Ultrafast Extension Settings</h1>
          <p style={styles.subtitle}>
            Configure your Jev model provider (TypeSafe.ai, OpenRouter, Cloudflare) and Text Helper.
          </p>
        </div>

        {/* Active Provider Selector */}
        <div style={styles.section}>
          <label style={styles.sectionLabel}>Active Jev Provider</label>
          <div style={styles.providerTabs}>
            {(['openrouter', 'typesafe', 'cloudflare'] as JevProviderType[]).map((p) => (
              <button
                key={p}
                style={{
                  ...styles.providerTab,
                  ...(settings.activeProvider === p ? styles.providerTabActive : {}),
                }}
                onClick={() => {
                  setSettings({ ...settings, activeProvider: p });
                  setActiveTab(p);
                }}
              >
                {p === 'openrouter' && 'OpenRouter (Decisions)'}
                {p === 'typesafe' && 'TypeSafe.ai (Official)'}
                {p === 'cloudflare' && 'Cloudflare Workers AI'}
              </button>
            ))}
          </div>
        </div>

        {/* Provider Configuration Forms */}
        <div style={styles.providerConfigBox}>
          {activeTab === 'typesafe' && (
            <div>
              <h3 style={styles.subhead}>TypeSafe.ai Configuration</h3>
              <div style={styles.field}>
                <label style={styles.label}>API Key</label>
                <input
                  type="password"
                  style={styles.input}
                  placeholder="sk-..."
                  value={settings.typesafe.apiKey}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      typesafe: { ...settings.typesafe, apiKey: e.target.value },
                    })
                  }
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Model</label>
                <input
                  type="text"
                  style={styles.input}
                  value={settings.typesafe.model}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      typesafe: { ...settings.typesafe, model: e.target.value },
                    })
                  }
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Endpoint</label>
                <input
                  type="text"
                  style={styles.input}
                  value={settings.typesafe.endpoint}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      typesafe: { ...settings.typesafe, endpoint: e.target.value },
                    })
                  }
                />
              </div>
              <button
                style={styles.btnSecondary}
                onClick={() => handleTestConnection('typesafe')}
              >
                Test TypeSafe API
              </button>
            </div>
          )}

          {activeTab === 'openrouter' && (
            <div>
              <h3 style={styles.subhead}>OpenRouter Configuration</h3>
              <div style={styles.field}>
                <label style={styles.label}>OpenRouter API Key</label>
                <input
                  type="password"
                  style={styles.input}
                  placeholder="sk-or-v1-..."
                  value={settings.openrouter.apiKey}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      openrouter: { ...settings.openrouter, apiKey: e.target.value },
                    })
                  }
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Model</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="typesafe/jev-1.13"
                  value={settings.openrouter.model}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      openrouter: { ...settings.openrouter, model: e.target.value },
                    })
                  }
                />
                <small style={{ color: '#6b7280', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                  Standard OpenRouter slug: <code>typesafe/jev-1.13</code> (Note: OpenRouter does not support <code>typesafe/jev-latest</code>)
                </small>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Endpoint</label>
                <input
                  type="text"
                  style={styles.input}
                  value={settings.openrouter.endpoint}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      openrouter: { ...settings.openrouter, endpoint: e.target.value },
                    })
                  }
                />
              </div>
              <button
                style={styles.btnSecondary}
                onClick={() => handleTestConnection('openrouter')}
              >
                Test OpenRouter Decisions API
              </button>
            </div>
          )}

          {activeTab === 'cloudflare' && (
            <div>
              <h3 style={styles.subhead}>Cloudflare Workers AI Configuration</h3>
              <div style={styles.field}>
                <label style={styles.label}>Account ID</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="Cloudflare Account ID"
                  value={settings.cloudflare.accountId}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      cloudflare: { ...settings.cloudflare, accountId: e.target.value },
                    })
                  }
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>API Token</label>
                <input
                  type="password"
                  style={styles.input}
                  placeholder="Cloudflare API Token (Workers AI Read/Write)"
                  value={settings.cloudflare.apiToken}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      cloudflare: { ...settings.cloudflare, apiToken: e.target.value },
                    })
                  }
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Model</label>
                <input
                  type="text"
                  style={styles.input}
                  value={settings.cloudflare.model}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      cloudflare: { ...settings.cloudflare, model: e.target.value },
                    })
                  }
                />
              </div>
              <button
                style={styles.btnSecondary}
                onClick={() => handleTestConnection('cloudflare')}
              >
                Test Cloudflare AI
              </button>
            </div>
          )}

          {testingStatus && <div style={styles.testStatusBanner}>{testingStatus}</div>}
        </div>

        {/* Text Helper Generation Model */}
        <div style={styles.section}>
          <label style={styles.sectionLabel}>
            Text Generation Helper (for TYPE_TEXT operations)
          </label>
          <p style={styles.helpText}>
            When Jev selects an input box to fill, this lightweight LLM generates the text payload from the goal.
            Changing the provider resets Base URL and Model to that provider's defaults.
          </p>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Provider / Service</label>
              <select
                style={styles.input}
                value={settings.textHelper.provider}
                onChange={(e) => handleTextProviderChange(e.target.value as TextHelperProvider)}
              >
                <option value="openrouter">OpenRouter (Default)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI / Compatible API</option>
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Model Name</label>
              <input
                type="text"
                style={styles.input}
                value={settings.textHelper.model}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    textHelper: { ...settings.textHelper, model: e.target.value },
                  })
                }
              />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <input
              type="password"
              style={styles.input}
              placeholder="API Key for Text Model (optional if OpenRouter key is set)"
              value={settings.textHelper.apiKey}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  textHelper: { ...settings.textHelper, apiKey: e.target.value },
                })
              }
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Base URL</label>
            <input
              type="text"
              style={styles.input}
              value={settings.textHelper.baseUrl}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  textHelper: { ...settings.textHelper, baseUrl: e.target.value },
                })
              }
            />
          </div>
        </div>

        {/* Agent Execution Settings */}
        <div style={styles.section}>
          <label style={styles.sectionLabel}>Agent Runtime Parameters</label>
          <div style={styles.grid2}>
            <div style={styles.field}>
              <label style={styles.label}>Max Steps</label>
              <input
                type="number"
                style={styles.input}
                value={settings.maxSteps}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxSteps: parseInt(e.target.value, 10) || 30,
                  })
                }
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Step Delay (ms)</label>
              <input
                type="number"
                style={styles.input}
                value={settings.stepDelayMs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    stepDelayMs: parseInt(e.target.value, 10) || 300,
                  })
                }
              />
            </div>
          </div>

          <div style={styles.checkboxField}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.showOverlay}
                onChange={(e) =>
                  setSettings({ ...settings, showOverlay: e.target.checked })
                }
              />
              Show [1], [2] element badges overlay on webpage during execution
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={styles.actionsRow}>
          <button style={styles.btnPrimary} onClick={handleSave}>
            Save All Settings
          </button>
          {savedToast && <span style={styles.savedToast}>✅ Settings saved!</span>}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, any> = {
  container: {
    backgroundColor: '#090d16',
    minHeight: '100vh',
    padding: '32px 16px',
    display: 'flex',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#e2e8f0',
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    border: '1px solid #1e293b',
    padding: 32,
    maxWidth: 680,
    width: '100%',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
  },
  header: {
    marginBottom: 24,
    borderBottom: '1px solid #1e293b',
    paddingBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f8fafc',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 6,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#38bdf8',
    marginBottom: 10,
    display: 'block',
  },
  helpText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: -4,
    marginBottom: 12,
  },
  providerTabs: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  providerTab: {
    flex: 1,
    padding: '10px 14px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center',
  },
  providerTabActive: {
    backgroundColor: '#312e81',
    borderColor: '#6366f1',
    color: '#ffffff',
  },
  providerConfigBox: {
    backgroundColor: '#131e32',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 20,
    marginBottom: 24,
  },
  subhead: {
    fontSize: 15,
    color: '#f1f5f9',
    marginTop: 0,
    marginBottom: 16,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
    display: 'block',
    fontWeight: 500,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  checkboxField: {
    marginTop: 10,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#cbd5e1',
    cursor: 'pointer',
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px solid #1e293b',
  },
  btnPrimary: {
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    backgroundColor: '#1e293b',
    color: '#38bdf8',
    border: '1px solid #0284c7',
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 6,
  },
  savedToast: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: 600,
  },
  testStatusBanner: {
    marginTop: 14,
    padding: 10,
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#e2e8f0',
    wordBreak: 'break-all',
  },
};
