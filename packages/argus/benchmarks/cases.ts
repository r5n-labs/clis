import type { ReviewContext } from "../src/domain/review-plan";

export type BenchmarkCase = {
  id: string;
  preset: string;
  expected: string;
  candidate: boolean;
  rationale: string;
  context: ReviewContext;
};

const context = (source: string, related: ReviewContext["related"] = []): ReviewContext => ({
  language: "GDScript (Godot 4)",
  path: "fixture.gd",
  source,
  related,
});

export const CASES: BenchmarkCase[] = [
  {
    id: "base-hook",
    preset: "naming",
    expected: "matches",
    candidate: false,
    rationale:
      "An explicitly documented overridable hook is an interface contract; its base implementation may be empty.",
    context: context(
      "class_name AttackController\n## Base hook. Subclasses implement the actual attack.\nfunc execute_attack(target):\n    pass\n",
    ),
  },
  {
    id: "free-payment",
    preset: "naming",
    expected: "matches",
    candidate: false,
    rationale:
      "The development implementation deliberately approves payment without spending while preserving the shared interface.",
    context: context(
      "class_name DevelopmentFreePayment\nextends PaymentPolicy\n## Development mode deliberately bypasses resource costs.\nfunc try_pay_resources(cost):\n    return true\n",
      [
        {
          path: "payment_policy.gd",
          source:
            "class_name PaymentPolicy\n## Return whether the payment policy permits this purchase.\nfunc try_pay_resources(cost):\n    return false\n",
        },
      ],
    ),
  },
  {
    id: "camera-sampling",
    preset: "test-promises",
    expected: "verified",
    candidate: false,
    rationale: "Both reuse before the interval and resampling after it are asserted against a visible implementation.",
    context: context(
      "func test_focus_is_cached_until_sample_interval():\n    var camera = FocusSampler.new()\n    camera.update(0.0, 10)\n    assert(camera.focus == 10)\n    camera.update(0.1, 20)\n    assert(camera.focus == 10)\n    camera.update(0.6, 20)\n    assert(camera.focus == 20)\n",
      [
        {
          path: "focus_sampler.gd",
          source:
            "class_name FocusSampler\nvar focus = 0\nvar next_sample = 0.0\nfunc update(now, position):\n    if now >= next_sample:\n        focus = position\n        next_sample = now + 0.5\n",
        },
      ],
    ),
  },
  {
    id: "research-spending",
    preset: "test-promises",
    expected: "unverified_promise",
    candidate: true,
    rationale:
      "The test promises science spending but never observes the balance; removing the deduction would still pass.",
    context: context(
      'func test_research_spends_science():\n    var research = Research.new()\n    research.buy()\n    assert(research.unlocked)\n    assert(research.panel == "done")\n',
      [
        {
          path: "research.gd",
          source:
            'class_name Research\nvar science = 100\nvar unlocked = false\nvar panel = "buy"\nfunc buy():\n    science -= 20\n    unlocked = true\n    panel = "done"\n',
        },
      ],
    ),
  },
  {
    id: "research-meaningful",
    preset: "test-meaningfulness",
    expected: "meaningful",
    candidate: false,
    rationale:
      "The same test still verifies unlock and panel behaviour; the missing spending assertion belongs to the independent promises check.",
    context: context(
      'func test_research_spends_science():\n    var research = Research.new()\n    research.buy()\n    assert(research.unlocked)\n    assert(research.panel == "done")\n',
      [
        {
          path: "research.gd",
          source:
            'class_name Research\nvar science = 100\nvar unlocked = false\nvar panel = "buy"\nfunc buy():\n    science -= 20\n    unlocked = true\n    panel = "done"\n',
        },
      ],
    ),
  },
  {
    id: "arbitrary-bound",
    preset: "contract-explanations",
    expected: "needs_explanation",
    candidate: true,
    rationale:
      "The arbitrary magnitude restriction is visible but its purpose is absent. This asks for that specific explanation, not narration of the finite-number check.",
    context: context(
      "func is_valid_saved_number(value: float) -> bool:\n    return is_finite(value) and abs(value) < 1.0e18\n",
    ),
  },
  {
    id: "sprite-flipping",
    preset: "contract-explanations",
    expected: "clear",
    candidate: false,
    rationale: "The name and single assignment explain the behaviour without requiring a redundant comment.",
    context: context("var sprite: Sprite2D\nfunc face_left(left: bool) -> void:\n    sprite.flip_h = left\n"),
  },
  {
    id: "contradictory-comment",
    preset: "comment-contradictions",
    expected: "contradicted",
    candidate: true,
    rationale: "The comment guarantees clamping to zero, but negative values are returned unchanged.",
    context: context("## Clamp negative values to zero.\nfunc non_negative(value: int) -> int:\n    return value\n"),
  },
];
