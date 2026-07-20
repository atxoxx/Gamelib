import type { TempUnit } from "../context/SettingsContext";

/** Convert a Celsius value to Fahrenheit. */
export function cToF(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/** Convert a single temperature reading from °C to the display unit. */
export function toDisplayTemp(celsius: number, unit: TempUnit): number {
  return unit === "f" ? cToF(celsius) : celsius;
}

/** Format a Celsius temperature for display, honouring the user's unit. */
export function formatTemp(celsius: number, unit: TempUnit): string {
  if (!Number.isFinite(celsius)) return "—";
  if (unit === "f") {
    return `${Math.round(cToF(celsius))}°F`;
  }
  return `${Math.round(celsius)}°C`;
}

/** Map a Celsius array to the display unit (for chart series data). */
export function toDisplayTemps(values: number[], unit: TempUnit): number[] {
  return unit === "f" ? values.map(cToF) : values;
}

/** Lower bound of the fixed temperature chart axis, in the display unit. */
export function tempMinY(unit: TempUnit): number {
  return unit === "f" ? 32 : 0;
}

/** Upper bound of the fixed temperature chart axis, in the display unit. */
export function tempMaxY(unit: TempUnit): number {
  return unit === "f" ? 212 : 100;
}

/** Short unit label ("°C" / "°F"). */
export function tempUnitLabel(unit: TempUnit): string {
  return unit === "f" ? "°F" : "°C";
}

/** Convert a hot-temperature threshold from °C to the display unit. */
export function tempThreshold(celsius: number, unit: TempUnit): number {
  return unit === "f" ? Math.round(cToF(celsius)) : celsius;
}
