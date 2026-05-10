import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { easeButton, easeEntrance } from "../../lib/motion";

/**
 * macOS-style chat window like ChatGPT / Claude.
 *
 * Supports:
 *   - "response": normal AI reply
 *   - "blocked":  Cloudflare Prompt Guard intercepts the message and shows a
 *                 DLP block banner instead
 *   - "redacted": message goes through but PII is redacted in-flight
 */
export type ChatMode = "response" | "blocked" | "redacted";

export interface ChatWindowProps {
  title?: string;
  /** Display name shown above the user bubble. */
  user?: string;
  /** Display name shown above the AI bubble. */
  assistant?: string;
  /** User's prompt text. */
  prompt: string;
  /** Optional code block shown beneath the prompt. */
  code?: string;
  /** AI response text (auto-defaulted if blank). */
  response?: string;
  mode?: ChatMode;
  /** Replay key — bumping it restarts the typewriter. */
  replayKey?: number | string;
  /** Animation phase: 0=empty, 1=prompt typing, 2=response typing, 3=done. */
  phase?: 0 | 1 | 2 | 3;
  /** When true, run the phases automatically on mount / replay. */
  autoplay?: boolean;
  className?: string;
}

const DEFAULT_RESPONSE_BY_MODE: Record<ChatMode, string> = {
  response:
    "I've reviewed your authentication module. A few observations:\n\n• Hardcoded secret key embedded in source\n• Weak token validation, easily forgeable\n• No expiration, indefinite reuse risk\n\nWant me to draft a fix?",
  blocked:
    "Unable to send this message. Your prompt was blocked by your organisation's AI policy. The content matched a sensitive-data rule (source code with embedded secrets). Try rephrasing without confidential material, or open a ticket to request an exemption.",
  redacted:
    "I've reviewed the snippet you shared. The variable values were redacted before reaching me. That's normal and means the secret never left your perimeter. Based on the structure I can see, I'd suggest…",
};

export function ChatWindow({
  title = "Claude",
  user = "You",
  assistant = "Claude",
  prompt,
  code,
  response,
  mode = "response",
  replayKey,
  phase: phaseProp,
  autoplay = true,
  className = "",
}: ChatWindowProps) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(phaseProp ?? 0);

  useEffect(() => {
    if (phaseProp !== undefined) {
      setPhase(phaseProp);
      return;
    }
    if (!autoplay) return;
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), 400);
    const t2 = setTimeout(() => setPhase(2), 400 + Math.max(prompt.length * 20, 1500));
    const t3 = setTimeout(
      () => setPhase(3),
      400 + Math.max(prompt.length * 20, 1500) + 2200,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [autoplay, prompt, replayKey, phaseProp]);

  const finalResponse = response ?? DEFAULT_RESPONSE_BY_MODE[mode];

  // For typewriter effect inside a single phase, run a smooth animation.
  const [typedPrompt, setTypedPrompt] = useState("");
  const [typedResponse, setTypedResponse] = useState("");

  useEffect(() => {
    if (phase < 1) {
      setTypedPrompt("");
      return;
    }
    if (phase >= 2) {
      setTypedPrompt(prompt);
      return;
    }
    setTypedPrompt("");
    let i = 0;
    const interval = setInterval(() => {
      i += Math.max(1, Math.ceil(prompt.length / 60));
      if (i >= prompt.length) {
        setTypedPrompt(prompt);
        clearInterval(interval);
      } else {
        setTypedPrompt(prompt.slice(0, i));
      }
    }, 24);
    return () => clearInterval(interval);
  }, [phase, prompt]);

  useEffect(() => {
    if (phase < 2) {
      setTypedResponse("");
      return;
    }
    if (phase >= 3) {
      setTypedResponse(finalResponse);
      return;
    }
    setTypedResponse("");
    let i = 0;
    const interval = setInterval(() => {
      i += Math.max(1, Math.ceil(finalResponse.length / 80));
      if (i >= finalResponse.length) {
        setTypedResponse(finalResponse);
        clearInterval(interval);
      } else {
        setTypedResponse(finalResponse.slice(0, i));
      }
    }, 22);
    return () => clearInterval(interval);
  }, [phase, finalResponse]);

  const isBlocked = mode === "blocked";
  const isRedacted = mode === "redacted";

  return (
    <div
      className={[
        "flex w-full flex-col overflow-hidden rounded-2xl border border-[#333] bg-[#1a1a1a] shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.1)]",
        className,
      ].join(" ")}
      data-no-advance
    >
      {/* Chrome */}
      <div className="flex items-center gap-2 border-b border-[#333] bg-[#2a2a2a] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        <span className="flex-1 text-center text-xs font-medium text-[#999]">
          {title}
        </span>
        <span className="flex w-12 items-center justify-end gap-1 text-[10px] text-[#666]">
          {isBlocked && (
            <span className="flex items-center gap-1 rounded-full bg-[color:var(--color-cf-orange-light)] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-cf-orange">
              <Lock className="h-2.5 w-2.5" />
              Guarded
            </span>
          )}
          {isRedacted && (
            <span className="flex items-center gap-1 rounded-full bg-[color:var(--color-cf-info)]/15 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-[color:var(--color-cf-info)]">
              <ShieldCheck className="h-2.5 w-2.5" />
              DLP
            </span>
          )}
        </span>
      </div>

      {/* Conversation */}
      <div className="flex flex-col gap-3 p-5">
        <AnimatePresence>
          {phase >= 1 && (
            <motion.div
              key="user-bubble"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeEntrance }}
              className="rounded-xl border border-[#333] bg-[#2a2a2a] p-4"
            >
              <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-cf-orange">
                {user}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#cfcfcf]">
                {typedPrompt}
                {phase === 1 && (
                  <span className="ml-0.5 inline-block opacity-60">▌</span>
                )}
              </div>
              {code && phase >= 2 && (
                <motion.pre
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="mt-3 overflow-x-auto rounded-lg border border-[#333] bg-[#0e0e0f] p-3 font-mono text-[11px] leading-relaxed text-[#a0a0a0]"
                >
                  {isRedacted
                    ? code.replace(/(['"])([^'"]*?)(['"])/g, '"████████"')
                    : code}
                </motion.pre>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Response or DLP block */}
        <AnimatePresence>
          {phase >= 2 &&
            (isBlocked ? (
              <motion.div
                key="block"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: easeEntrance }}
                className="flex items-start gap-3 rounded-xl border border-[#dc2626]/40 bg-[#dc2626]/10 p-4"
              >
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#EAB308]"
                  strokeWidth={2}
                />
                <div className="flex-1">
                  <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[#FF7A7A]">
                    Cloudflare Prompt Guard · Blocked
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#FF9C9C]">
                    {typedResponse}
                    {phase === 2 && (
                      <span className="ml-0.5 inline-block opacity-60">▌</span>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="response"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: easeEntrance }}
                className="rounded-xl border border-[#333] bg-[#2a2a2a] p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-[#0A95FF]" />
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[#0A95FF]">
                    {assistant}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#aaa]">
                  {typedResponse}
                  {phase === 2 && (
                    <span className="ml-0.5 inline-block opacity-60">▌</span>
                  )}
                </div>
              </motion.div>
            ))}
        </AnimatePresence>

        {/* Input bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4, ease: easeButton }}
          className="mt-2 flex items-center gap-2 border-t border-[#333] pt-3"
        >
          <span className="flex-1 truncate font-mono text-xs text-[#999]">
            {isBlocked
              ? "Try a sanitised prompt…"
              : "Ask anything. Your prompt is logged & protected."}
          </span>
          {(isBlocked || isRedacted) && (
            <span className="flex items-center gap-1 font-mono text-[10px] font-medium text-[#16A34A]">
              <ShieldCheck className="h-3 w-3" /> Protected
            </span>
          )}
        </motion.div>
      </div>
    </div>
  );
}
