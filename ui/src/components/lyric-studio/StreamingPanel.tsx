// StreamingPanel.tsx — Collapsible LLM streaming output viewer
// Port of Lireek StreamingPanel, converted to Tailwind

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, ChevronDown, ChevronUp, Terminal, SkipForward } from 'lucide-react';

interface StreamingPanelProps {
  visible: boolean;
  streamText: string;
  phase: string;
  done: boolean;
  onSkipThinking?: () => void;
}

export const StreamingPanel: React.FC<StreamingPanelProps> = ({
  visible, streamText, phase, done, onSkipThinking,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [skipRequested, setSkipRequested] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (preRef.current && !collapsed) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [streamText, collapsed]);

  // Reset skip state when a new generation starts
  useEffect(() => {
    if (!done && streamText === '') {
      setSkipRequested(false);
    }
  }, [done, streamText]);

  if (!visible) return null;

  // Detect if model is currently inside a <think> block
  const thinkOpens = (streamText.match(/<think>/g) || []).length;
  const thinkCloses = (streamText.match(/<\/think>/g) || []).length;
  const isThinking = !done && thinkOpens > thinkCloses && !skipRequested;

  const handleSkip = () => {
    setSkipRequested(true);
    onSkipThinking?.();
  };

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-700/50 bg-zinc-900/60">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          <Terminal size={12} className="text-violet-400" />
          LLM Output
          {phase && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500 text-white">
              {phase}
            </span>
          )}
          {!done && (
            <Loader2 size={11} className="animate-spin text-violet-400" />
          )}
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>

        {/* Skip Thinking button */}
        {isThinking && onSkipThinking && (
          <button
            onClick={handleSkip}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-500 text-white hover:bg-violet-400 transition-all"
            title="Stop the model's chain-of-thought and produce output immediately"
          >
            <SkipForward size={12} />
            Skip Thinking
          </button>
        )}
        {skipRequested && !done && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-violet-400">
            <Loader2 size={11} className="animate-spin" />
            Skipping…
          </span>
        )}
      </div>

      {/* Content */}
      {!collapsed && (
        <pre
          ref={preRef}
          className="px-4 pb-3 text-xs leading-relaxed overflow-y-auto whitespace-pre-wrap break-words text-zinc-500 max-h-[300px]"
          style={{ fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", Menlo, monospace' }}
        >
          {streamText || (done ? '(no output)' : 'Waiting for LLM response…')}
        </pre>
      )}
    </div>
  );
};
