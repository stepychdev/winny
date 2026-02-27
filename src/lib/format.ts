const usdcFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdcFormatterCompact = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsdc(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return usdcFormatter.format(value);
}

export function formatUsdcCompact(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  if (Math.abs(value) >= 1000) {
    return `${usdcFormatterCompact.format(value / 1000)}k`;
  }
  return usdcFormatter.format(value);
}
