// Plain-text problem report for the crash screen. Pure; carries no user data.
function lines(text: string | null | undefined, max: number): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(0, max);
}

export function crashDetails(args: { error: unknown; componentStack?: string | null; platform: string; at: string }): string {
  const { error } = args;
  let name = 'Error';
  let message = '';
  let stack: string | undefined;
  if (error instanceof Error) {
    name = error.name || 'Error';
    message = error.message;
    stack = error.stack;
  } else if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof e.name === 'string') name = e.name;
    message = typeof e.message === 'string' ? e.message : safeString(error);
    if (typeof e.stack === 'string') stack = e.stack;
  } else {
    message = safeString(error);
  }

  const out = ['SplitSnap problem report', `Time: ${args.at}`, `Platform: ${args.platform}`, `Error: ${name}: ${message}`];
  const stackLines = lines(stack, 30);
  if (stackLines.length > 0) out.push('', 'Stack:', ...stackLines);
  const componentLines = lines(args.componentStack, 15);
  if (componentLines.length > 0) out.push('', 'Component stack:', ...componentLines);
  return out.join('\n');
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return 'unknown';
  }
}
