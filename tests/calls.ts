/** Intercepted outbound calls (filled by tests/setup.ts). */
export const calls: {
  telegram: { method: string; body: any }[];
  resend: { path: string; body: any; headers: Record<string, string> }[];
} = { telegram: [], resend: [] };
