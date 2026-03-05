const isColorEnabled = !process.env.NO_COLOR && (process.env.FORCE_COLOR || (process.stdout?.isTTY ?? false));

const baseColors = ["black", "blue", "cyan", "gray", "green", "magenta", "red", "white", "yellow"] as const;
const baseDecorations = ["bold", "dim", "italic", "underline", "reset"] as const;
const ansiCodes = { bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m", reset: "\x1b[0m", underline: "\x1b[4m" };

const fgAnsiCodes: Record<string, string> = {
  black: "\x1b[30m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  yellow: "\x1b[33m",
};

const bgAnsiCodes: Record<string, string> = {
  black: "\x1b[40m",
  blue: "\x1b[44m",
  cyan: "\x1b[46m",
  gray: "\x1b[100m",
  green: "\x1b[42m",
  magenta: "\x1b[45m",
  red: "\x1b[41m",
  white: "\x1b[47m",
  yellow: "\x1b[43m",
};

const brightColorMap: Record<string, string> = {
  "\x1b[30m": "\x1b[90m",
  "\x1b[31m": "\x1b[91m",
  "\x1b[32m": "\x1b[92m",
  "\x1b[33m": "\x1b[93m",
  "\x1b[34m": "\x1b[94m",
  "\x1b[35m": "\x1b[95m",
  "\x1b[36m": "\x1b[96m",
  "\x1b[37m": "\x1b[97m",
};

function colorize(colorCode: string) {
  return (text: string) => (isColorEnabled ? `${colorCode}${text}${ansiCodes.reset}` : text);
}

function isValidAnsi(code: string): boolean {
  for (let i = 0; i < code.length; i++) {
    const charCode = code.charCodeAt(i);
    if (charCode < 32 && charCode !== 27) return false;
  }
  return true;
}

function getColorCode({ bright = false, color }: { bright?: boolean; color: string }) {
  const bunColor = Bun.color(color, "ansi");
  const baseColor =
    typeof bunColor === "string" && bunColor.length > 0 && isValidAnsi(bunColor) ? bunColor : fgAnsiCodes[color];
  if (!baseColor) return "";

  return bright && baseColor in brightColorMap ? brightColorMap[baseColor] : baseColor;
}

const colorDecorations = baseColors.reduce(
  (acc, color) => {
    const code = getColorCode({ color });
    if (code) {
      acc[color] = colorize(code);
    }
    const brightCode = getColorCode({ bright: true, color });
    if (brightCode) {
      acc[`${color}Bright`] = colorize(brightCode);
    }
    return acc;
  },
  {} as Record<(typeof baseColors)[number] | `${(typeof baseColors)[number]}Bright`, (text: string) => string>,
);

const decorations = baseDecorations.reduce(
  (acc, decoration) => {
    acc[decoration] = colorize(ansiCodes[decoration]);
    return acc;
  },
  {} as Record<(typeof baseDecorations)[number], (text: string) => string>,
);

type BgColorKey = `bg${Capitalize<(typeof baseColors)[number]>}`;
const bgColorDecorations = baseColors.reduce(
  (acc, color) => {
    const code = bgAnsiCodes[color];
    if (code) {
      const key = `bg${color.charAt(0).toUpperCase()}${color.slice(1)}` as BgColorKey;
      acc[key] = colorize(code);
    }
    return acc;
  },
  {} as Record<BgColorKey, (text: string) => string>,
);

export const color = { ...colorDecorations, ...decorations, ...bgColorDecorations };
