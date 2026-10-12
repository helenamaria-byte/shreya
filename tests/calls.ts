/** Intercepted outbound calls (filled by tests/setup.ts). */
export const calls: {
  telegram: { method: string; body: any }[];
  resend: { path: string; body: any; headers: Record<string, string> }[];
  gemini: { prompt: string; system: string }[];
  /** Set by a test to answer Gemini calls; returns the JSON object the model "replies" with. */
  geminiResponder?: (prompt: string) => unknown;
} = { telegram: [], resend: [], gemini: [] };
