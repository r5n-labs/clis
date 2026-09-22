import { confirm, Exit, log, multiselect, select } from "@r5n/cli-core";
import type { ConfigEditor } from "../../config/ConfigEditor";
import { readJson } from "../../config/loader";
import { GROUPS, JSON_INDENT } from "../../constants";
import type { TargetGroup } from "../../domain/question";
import { PRESETS } from "../../presets";
import { requireTerminal } from "./prompt-values";
import { promptQuestion } from "./question-prompts";
import { parseSettingValue, promptSetting, settingName } from "./settings";

export class ConfigActions {
  constructor(private editor: ConfigEditor) {}

  show(): void {
    console.log(JSON.stringify(this.editor.config, null, JSON_INDENT));
  }

  upgradePresets(): void {
    const count = this.editor.upgradePresets();
    console.log(
      `Upgraded ${count} stock presets. Custom questions and cached answers were preserved. New questions need evaluation.`,
    );
  }

  async addPresets(names: string[] = []): Promise<void> {
    let selected = names;
    if (!selected.length) {
      requireTerminal();
      selected = await multiselect({
        message: "Add presets",
        options: Object.entries(PRESETS).map(([value, preset]) => ({
          label: value,
          hint: `${preset.group}: ${preset.question.id}`,
          value,
        })),
      });
    }
    const changed = this.editor.addPresets(selected);
    console.log(changed ? `Saved ${this.editor.path}` : "Selected presets are already configured");
    if (selected.includes("changes") || selected.includes("all"))
      log.info("Change checks require --base <revision> on check, run and report (for example --base HEAD)");
  }

  async addQuestion(groupName?: string, file?: string): Promise<void> {
    const group = await this.resolveGroup(groupName);
    if (!file) requireTerminal();
    const question = file ? readJson(file) : await promptQuestion();
    this.editor.addQuestion(group, question);
    this.saved();
  }

  async editQuestion(groupName?: string, id?: string, file?: string): Promise<void> {
    const group = await this.resolveGroup(groupName);
    const questionId = await this.resolveQuestion(group, id);
    const existing = this.editor.question(group, questionId);
    if (!file) requireTerminal();
    if (file) this.editor.editQuestion(group, questionId, readJson(file));
    else this.editor.replaceQuestion(group, questionId, await promptQuestion(existing));
    this.saved();
  }

  async removeQuestion(groupName?: string, id?: string): Promise<void> {
    const group = await this.resolveGroup(groupName);
    const questionId = await this.resolveQuestion(group, id);
    if (!groupName || !id) {
      requireTerminal();
      if (
        !(await confirm({
          message: `Remove ${group}/${questionId}? Cached answers will be kept.`,
          initialValue: false,
        }))
      )
        return;
    }
    this.editor.removeQuestion(group, questionId);
    this.saved();
  }

  async set(name?: string, input?: string): Promise<void> {
    const key = name === undefined ? undefined : settingName(name);
    if (key !== undefined && input !== undefined) {
      this.editor.set(key, parseSettingValue(key, input));
    } else {
      requireTerminal();
      const change = await promptSetting(this.editor.config, key);
      this.editor.set(change.key, change.value);
    }
    this.saved();
  }

  private async resolveGroup(value?: string): Promise<TargetGroup> {
    if (value !== undefined) {
      const group = GROUPS.find((group) => group === value);
      if (!group) throw new Exit(`Unknown question group: ${value}`, `Choose ${GROUPS.join(", ")}`);
      return group;
    }
    requireTerminal();
    return select({ message: "Question group", options: GROUPS.map((value) => ({ label: value, value })) });
  }

  private async resolveQuestion(group: TargetGroup, id?: string): Promise<string> {
    if (id !== undefined) return this.editor.question(group, id).id;
    const questions = this.editor.config.questions[group];
    if (!questions.length) throw new Exit(`No questions configured in ${group}`);
    requireTerminal();
    return select({
      message: "Question",
      options: questions.map((question) => ({ label: question.id, hint: question.instructions, value: question.id })),
    });
  }

  private saved(): void {
    console.log(`Saved ${this.editor.path}`);
  }
}
