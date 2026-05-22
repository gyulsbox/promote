const SECRET_PATTERNS: string[] = [
  "AKIA[0-9A-Z]{16}",
  "gh[poirs]_[0-9A-Za-z]{36,}",
  "xox[baprs]-[0-9]{12}-[0-9A-Za-z-]+",
  "(sk|pk)_(test|live)_[0-9a-zA-Z]{24,}",
  "eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
  "https?://[^:@\\s\"'`]+:[^@\\s\"'`]+@",
  "(?<![0-9a-fA-F])[0-9a-fA-F]{40,}(?![0-9a-fA-F])",
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern, "g"), "[REDACTED]");
  }
  return result;
}
