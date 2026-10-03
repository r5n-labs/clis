# Configuration and questions

[Argus](../README.md) / Configuration and questions

## Built-in checks

`init --preset naming` is the default. `--preset all` additionally enables comment contradictions and missing contract explanations, architecture ownership, test meaningfulness and promised behaviour, translation quality and change regression checks. When change questions are configured, pass `--base HEAD` (or another Git revision) to `check`, `run` and `report create`. Changes include staged, unstaged, deleted and untracked selected files relative to that revision.

Tooltip accuracy is deliberately absent: finding an effect from arbitrary descriptive text is not reliably deterministic. No manual text-to-code mapping is required by any built-in check.

## Configuration commands

Run `argus config` for an interactive menu to add presets, create/edit/remove questions and edit project settings. Changes update the existing `.argus/config.json`; there is no need to initialise another configuration. Escape cancels the current operation without saving its draft. Earlier completed operations remain saved.

Direct commands are also available:

```sh
argus config show
argus config preset add comments architecture
argus config preset add all
argus config question add methods
argus config question edit methods naming-accuracy
argus config question remove methods naming-accuracy
argus config set maxQuestions 16
argus config set include '["**/*.gd", "**/*.po"]'
argus config set exclude '["addons/**", ".godot/**", ".argus/**"]'
```

`show` prints the effective configuration as JSON, including defaults. Presets are `naming`, `architecture`, `translations`, `changes`, `comment-contradictions`, `contract-explanations`, `test-meaningfulness` and `test-promises`. `all` enables these eight checks. The older broad `comments` and `tests` presets remain available. Identical presets are skipped. Unmodified earlier naming, comment, architecture and translation rubrics are upgraded when loading a config, without rewriting the file; `config show` displays the effective questions. Shared architecture and translation rubrics are framework-, format- and locale-independent; registered integrations supply specialised evidence. Custom instructions, criteria and context choices are preserved. Upgraded rubrics invalidate their old answers. Comment reviews now also cover uncommented methods; straightforward code does not require redundant comments. A preset that conflicts with a customised question stops the entire addition without changing the file. Adding `changes` or `all` requires `--base <revision>` on subsequent review commands.

Question add/edit commands open guided prompts for instructions, answer choices, code context, extra context files, target filters, the comments-only filter, flagged answers and confidence thresholds. To script these operations, supply `--file`:

```sh
argus config question add methods --file question.json
argus config question edit methods naming-accuracy --file naming-patch.json
```

An add file contains a complete question, as shown below. An edit file contains only the fields to change, for example `{"minConfidence": 0.8}`. Supplied arrays and objects replace those fields in full; other fields are retained. Set `"minConcernProbability": null` in an edit patch to disable that optional threshold; omission leaves it unchanged. Interactive edits save the complete draft, including removed optional fields. Editing `id` renames the question. Explicit `question remove <group> <id>` removes it immediately; removing through the menu asks for confirmation. Cached answers are retained.

Settings are `root`, `model`, `include`, `exclude`, `maxQuestions` and `maxRequestBytes`. File filters take JSON arrays in direct commands; the menu provides an entry editor. `root` is relative to the configuration file. Omitting a setting's value opens a prompt. Supply `--config <path>` after the subcommand and its arguments to edit an external configuration, for example `argus config preset add comments --config /path/to/config.json`. The menu also supports `argus config --config /path/to/config.json`.

Each change is validated and saved atomically. The editor refuses to overwrite a file changed since it was opened. Configuration commands do not contact the model API or delete cached answers; the [cache identity rules](execution.md#cache-semantics) determine which checks become pending. Run `argus check` after editing to preview the work.

## Custom questions

Add a choice question to a group in `questions`. No TypeScript changes are needed:

```json
{
  "version": 1,
  "root": "../game",
  "questions": {
    "methods": [
      {
        "id": "unexpected-mutation",
        "type": "choice",
        "context": "class",
        "instructions": "Does this method mutate state despite a name that promises a read-only query?",
        "criteria": {
          "consistent": "The name and state changes agree.",
          "unexpected": "A query-like name conceals a material state change.",
          "insufficient_context": "The supplied implementation does not establish the side effects."
        },
        "flag": ["unexpected"],
        "minConfidence": 0.7
      }
    ]
  }
}
```

Groups are `methods`, `classes`, `files`, `tests`, `resources`, `translations` and `changes`. Empty groups cost nothing. IDs must be unique within a group. `include` filters a question by project-relative globs; `hasComments` restricts it to targets with comments. `flag` and `minConfidence` control reporting, not evaluation. Questions use the **choice** primitive supported by the [configured model](models.md). Results are classifications and probabilities; Argus does not invent explanations or suggested fixes.

## Focused presets and uncertainty

New `all` configurations use independent `test-meaningfulness`, `test-promises`, `comment-contradictions` and `contract-explanations` checks. Existing configurations keep their broad `test-quality` and `comment-accuracy` checks until explicitly upgraded:

```sh
argus config preset upgrade
argus check
```

The upgrade replaces only unmodified stock questions, preserves customised questions and retains old cache entries. New questions require new evaluations; this is intentional, because an answer to a broad question cannot be relabelled as answers to independent questions. Checks with identical context are still batched. Individual focused presets can also be added by name with `argus config preset add`.

Each question optionally accepts `minConcernProbability`: a threshold on the sum of probabilities for its `flag` choices. This can select ambiguous candidates even when the highest-probability answer is benign. It supplements the existing winning-label/minimum-confidence rule and is disabled by default; no threshold is claimed to be calibrated. Edit it through the question editor or a JSON patch. Reporting changes reuse model answers. The report shows both the original answer and why it was selected.

See [source and context](source-and-context.md) for evidence selection and request limits.
