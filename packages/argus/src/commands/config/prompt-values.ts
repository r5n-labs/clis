import { Exit, log, select, text } from "@r5n/cli-core";
import { textValue } from "../../config/validation";

export function requireTerminal(): void {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true)
    throw new Exit(
      "Interactive configuration requires a terminal",
      "Use explicit arguments; question add/edit also accept --file <json-path>",
    );
}

export function validationMessage(validate: () => unknown): string | undefined {
  try {
    validate();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid value";
  }
}

export async function promptText(message: string, initialValue?: string): Promise<string> {
  return text({ message, initialValue, validate: (value) => validationMessage(() => textValue(value)) });
}

export async function promptNumber(
  message: string,
  initialValue: number,
  validate: (value: unknown) => number,
): Promise<number> {
  const value = await text({
    message,
    initialValue: String(initialValue),
    validate: (value) => validationMessage(() => validate(Number(textValue(value)))),
  });
  return validate(Number(value));
}

export async function promptList(message: string, initial: string[]): Promise<string[]> {
  const values = [...initial];
  while (true) {
    const action = await select({
      message: `${message} — select an entry to remove it`,
      options: [
        ...values.map((value, index) => ({ label: value, value: String(index) })),
        { label: "Add entry", value: "add" },
        { label: "Done", value: "done" },
      ],
    });
    if (action === "done") return values;
    if (action === "add") {
      const value = await promptText("Entry");
      if (!values.includes(value)) values.push(value);
    } else {
      values.splice(Number(action), 1);
    }
  }
}

export async function promptCriteria(initial: Record<string, string>): Promise<Record<string, string>> {
  let criteria = { ...initial };
  const MIN_CHOICES = 2;
  while (true) {
    const action = await select({
      message: "Answer choices",
      options: [
        ...Object.entries(criteria).map(([key, description]) => ({
          label: key,
          hint: description,
          value: `choice:${key}`,
        })),
        { label: "Add choice", value: "add" },
        { label: "Done", value: "done" },
      ],
    });
    if (action === "done") {
      if (Object.keys(criteria).length >= MIN_CHOICES) return criteria;
      log.warn("Add at least two answer choices");
      continue;
    }
    if (action === "add") {
      const key = await text({
        message: "Choice key",
        validate: (value) =>
          validationMessage(() => {
            const key = textValue(value);
            if (Object.hasOwn(criteria, key)) throw new Exit("That choice already exists");
          }),
      });
      criteria = { ...criteria, [key]: await promptText("What does this choice mean?") };
      continue;
    }
    const key = action.slice("choice:".length);
    const operation = await select({
      message: key,
      options: [
        { label: "Edit description", value: "edit" },
        { label: "Remove choice", value: "remove" },
        { label: "Back", value: "back" },
      ],
    });
    if (operation === "edit") criteria[key] = await promptText("Description", criteria[key]);
    if (operation === "remove") delete criteria[key];
  }
}
