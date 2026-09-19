import React, { useEffect, useState } from 'react';
import {
  AgentProgress,
  AgentStepLog,
  AppSettings,
  DEFAULT_SETTINGS,
  ExtensionMessage,
} from '../shared/types';

const STATUS_COLORS: Record<string, string> = {
  running: '#10b981',
  paused: '#f59e0b',
  done: '#3b82f6',
  blocked: '#f97316',
  error: '#ef4444',
  idle: '#9ca3af',
};

/** Optional ?tabId= lets the popup drive a specific tab when it is opened as a page (tests, detached use). */
function targetTabId(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('tabId');
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) ? id : undefined;
}

export const Popup: React.FC = () => {
  const [goal, setGoal] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<AgentProgress>({
    status: 'idle',
    goal: '',
    currentStep: 0,
    maxSteps: 30,
    logs: [],
  });
  const [showBadges, setShowBadges] = useState(true);

  useEffect(() => {
    // 1. Get settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response?: { settings?: AppSettings }) => {
      if (response?.settings) {
        setSettings(response.settings);
        setShowBadges(response.settings.showOverlay ?? true);
      }
    });

    // 2. Get initial progress
    chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }, (response?: { progress?: AgentProgress }) => {
      if (response?.progress) {
        setProgress(response.progress);
        if (response.progress.goal) {
          setGoal(response.progress.goal);
        }
      }
    });

    // 3. Listen for live updates
    const listener = (msg: ExtensionMessage) => {
      if (msg.type === 'PROGRESS_UPDATE' && msg.progress) {
        setProgress(msg.progress);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleStart = () => {
    if (!goal.trim()) return;
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal: goal.trim(), tabId: targetTabId() });
  };

  const handleStep = () => {
    if (!goal.trim()) return;
    chrome.runtime.sendMessage({ type: 'STEP_AGENT', goal: goal.trim(), tabId: targetTabId() });
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
  };

  const handleToggleOverlay = () => {
    const nextVal = !showBadges;
    setShowBadges(nextVal);
    chrome.runtime.sendMessage({ type: 'TOGGLE_OVERLAY', show: nextVal, tabId: targetTabId() });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const isRunning = progress.status === 'running';

  const providerLabel = {
    typesafe: 'TypeSafe.ai (Native)',
    openrouter: 'OpenRouter (Alpha)',
    cloudflare: 'Cloudflare AI',
  }[settings.activeProvider];

  const quickGoals = [
    'Find one-way flights from Zurich to London on Google Flights',
    'Search for Taylor Swift and open her early life section',
    'Add the highest-rated product to shopping cart',
  ];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.boltIcon}>⚡</span>
          <div>
            <div style={styles.title}>Jev Ultrafast</div>
            <div style={styles.subtitle}>System 1 Browser Agent</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.providerBadge}>{providerLabel}</span>
          <button
            onClick={openOptions}
            title="Settings"
            style={styles.iconButton}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Goal Input Section */}
      <div style={styles.section}>
        <label style={styles.label}>Agent Goal</label>
        <textarea
          style={styles.textarea}
          rows={3}
          placeholder="e.g. Find one-way flights from Zurich to London on September 20, 2026..."
          value={goal}
          disabled={isRunning}
          onChange={(e) => setGoal(e.target.value)}
        />

        {/* Quick goal chips */}
        <div style={styles.chipsRow}>
          {quickGoals.map((q, idx) => (
            <button
              key={idx}
              disabled={isRunning}
              onClick={() => setGoal(q)}
              style={styles.chip}
            >
              {q.slice(0, 30)}...
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controlsRow}>
        {!isRunning ? (
          <>
            <button
              style={{ ...styles.btn, ...styles.btnPrimary }}
              disabled={!goal.trim()}
              onClick={handleStart}
            >
              ▶ Run Ultrafast
            </button>
            <button
              style={{ ...styles.btn, ...styles.btnSecondary }}
              disabled={!goal.trim()}
              onClick={handleStep}
              title={progress.status === 'paused' ? 'Execute the next step' : 'Start and execute one step'}
            >
              ⏭ Step
            </button>
          </>
        ) : (
          <button
            style={{ ...styles.btn, ...styles.btnDanger }}
            onClick={handleStop}
          >
            ⏹ Stop Agent
          </button>
        )}

        <button
          onClick={handleToggleOverlay}
          title="Toggle element badges on page"
          style={{
            ...styles.btn,
            ...styles.btnOutline,
            backgroundColor: showBadges ? '#312e81' : 'transparent',
            borderColor: showBadges ? '#6366f1' : '#374151',
          }}
        >
          🏷️ {showBadges ? 'Badges On' : 'Badges Off'}
        </button>
      </div>

      {/* Status Bar */}
      <div style={styles.statusBox}>
        <div style={styles.statusHeader}>
          <div style={styles.statusIndicator}>
            <span
              style={{
                ...styles.dot,
                backgroundColor: STATUS_COLORS[progress.status] || '#9ca3af',
              }}
            />
            <span style={styles.statusText}>
              Status: <strong>{progress.status.toUpperCase()}</strong>
            </span>
          </div>
          <span style={styles.stepCounter}>
            Step {progress.currentStep} / {progress.maxSteps}
          </span>
        </div>

        {progress.lastError && (
          <div style={styles.errorBanner}>{progress.lastError}</div>
        )}
      </div>

      {/* Live Decisions Feed */}
      <div style={styles.logsSection}>
        <div style={styles.logsTitle}>Decision Feed (Decisions, Not Strings)</div>
        <div style={styles.logsList}>
          {progress.logs.length === 0 ? (
            <div style={styles.emptyLog}>No actions recorded yet.</div>
          ) : (
            progress.logs.map((log: AgentStepLog, i) => (
              <div key={i} style={styles.logCard}>
                <div style={styles.logCardHeader}>
                  <span style={styles.opTag(log.operation)}>{log.operation}</span>
                  <span style={styles.latencyTag}>{log.latencyMs}ms</span>
                </div>
                {log.targetLabel && (
                  <div style={styles.targetRow}>
                    <span style={styles.targetId}>{log.targetId}</span>
                    <span style={styles.targetLabel}>{log.targetLabel}</span>
                  </div>
                )}
                {log.targetValue && (
                  <div style={styles.textValueRow}>
                    Typed: <code>"{log.targetValue}"</code>
                  </div>
                )}
                {log.confidence !== undefined && (
                  <div style={styles.confidenceBar}>
                    <div
                      style={{
                        ...styles.confidenceFill,
                        width: `${Math.round(log.confidence * 100)}%`,
                      }}
                    />
                    <span style={styles.confidenceText}>
                      Confidence: {Math.round(log.confidence * 100)}%
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, any> = {
  container: {
    width: 380,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: 16,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid #1e293b',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  boltIcon: {
    fontSize: 24,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  subtitle: {
    fontSize: 11,
    color: '#94a3b8',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  providerBadge: {
    fontSize: 10,
    backgroundColor: '#1e293b',
    color: '#38bdf8',
    padding: '3px 6px',
    borderRadius: 4,
    border: '1px solid #0284c7',
  },
  iconButton: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: 4,
  },
  section: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: 6,
    display: 'block',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#f8fafc',
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    resize: 'none',
    outline: 'none',
  },
  chipsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  chip: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 10,
    color: '#94a3b8',
    cursor: 'pointer',
  },
  controlsRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 14,
  },
  btn: {
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    flex: 2,
  },
  btnSecondary: {
    backgroundColor: '#334155',
    color: '#f8fafc',
    flex: 1,
  },
  btnDanger: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    flex: 2,
  },
  btnOutline: {
    border: '1px solid #374151',
    color: '#cbd5e1',
    fontSize: 11,
    padding: '6px 8px',
  },
  statusBox: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    padding: 10,
    marginBottom: 14,
  },
  statusHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  statusText: {
    fontSize: 12,
    color: '#cbd5e1',
  },
  stepCounter: {
    fontSize: 11,
    color: '#94a3b8',
  },
  errorBanner: {
    marginTop: 8,
    padding: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid #ef4444',
    borderRadius: 4,
    color: '#fca5a5',
    fontSize: 11,
  },
  logsSection: {
    marginTop: 10,
  },
  logsTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  logsList: {
    maxHeight: 200,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyLog: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    padding: '16px 0',
  },
  logCard: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    padding: 8,
    border: '1px solid #334155',
  },
  logCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  opTag: (op: string) => ({
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor:
      op === 'CLICK'
        ? '#0284c7'
        : op === 'TYPE_TEXT'
        ? '#7c3aed'
        : op === 'SELECT'
        ? '#d97706'
        : op === 'DONE'
        ? '#10b981'
        : '#475569',
    color: '#ffffff',
  }),
  latencyTag: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  targetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    marginTop: 4,
  },
  targetId: {
    backgroundColor: '#334155',
    padding: '1px 4px',
    borderRadius: 3,
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#38bdf8',
  },
  targetLabel: {
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  textValueRow: {
    fontSize: 11,
    color: '#a7f3d0',
    marginTop: 2,
  },
  confidenceBar: {
    position: 'relative',
    height: 12,
    backgroundColor: '#0f172a',
    borderRadius: 6,
    marginTop: 6,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: '#6366f1',
  },
  confidenceText: {
    position: 'absolute',
    top: 0,
    left: 6,
    fontSize: 9,
    lineHeight: '12px',
    color: '#e2e8f0',
  },
};
