import { Exit, select } from "@r5n/cli-core";
import { SETTINGS, type Setting } from "../../config/ConfigEditor";
import type { ArgusConfig } from "../../config/types";
import { positiveInteger } from "../../config/validation";
import { promptList, promptNumber, promptText } from "./prompt-values";

export function settingName(value: string): Setting {
  const setting = SETTINGS.find((key) => key === value);
  if (!setting) throw new Exit(`Unknown setting: ${value}`, `Choose ${SETTINGS.join(", ")}`);
  return setting;
}

export function parseSettingValue(key: Setting, value: string): unknown {
  if (key === "include" || key === "exclude") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Exit(`${key} must be a JSON array of glob patterns`, `Example: argus config set ${key} '["src/**"]'`);
    }
  }
  if (key === "maxQuestions" || key === "maxRequestBytes") return positiveInteger(Number(value));
  return value;
}

export async function promptSetting(config: ArgusConfig, key?: Setting): Promise<{ key: Setting; value: unknown }> {
  const field =
    key ?? (await select({ message: "Setting", options: SETTINGS.map((value) => ({ label: value, value })) }));
  switch (field) {
    case "root":
      return { key: field, value: await promptText("Project root (relative to the config file)", config.root) };
    case "model":
      return { key: field, value: await promptText("Jev model", config.model) };
    case "include":
    case "exclude":
      return { key: field, value: await promptList(`${field} file patterns`, config[field]) };
    case "maxQuestions":
    case "maxRequestBytes":
      return { key: field, value: await promptNumber(field, config[field], positiveInteger) };
  }
}
