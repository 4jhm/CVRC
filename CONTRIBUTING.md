# Contributing to VRCN

Thanks for considering contributing to VRCN.

Before you contribute, there are a few things I need to make clear.

## Pull Requests

Please try to keep each Pull Request focused on **one feature** or **one bug fix**.

Do not include multiple unrelated fixes or features in one PR. This helps reduce conflicts with other PRs and with my own changes, since VRCN is under heavy daily development.

Sometimes I work on VRCN for many hours per day, so large or mixed PRs can quickly become hard to review and merge safely.

## PR Description Requirements

Make sure your PR clearly explains what you changed and why.

Your PR should include:

* A clear title
* A proper description
* What bug was fixed or what feature was added
* Steps to test the change
* Screenshots or videos if the change affects the UI
* Any important technical details I should know

If your PR has no clear title or description, I will not review it.

Please provide enough information so I can verify, test, and understand your changes before making a merge decision.

## AI Usage in Pull Requests

I do not mind AI being used as a helper tool, especially for front-end related work, as long as the result is not redundant, vulnerable, messy, or unmaintainable.

AI can be used to:

* Find or explain code
* Suggest possible solutions
* Help with small code snippets
* Help with larger changes, if you fully understand the result

If AI was used in your PR, you must include an **AI disclaimer** in the PR description.

The disclaimer should explain:

* Which AI tool was used
* What the AI helped with
* Which files or parts were affected
* What you personally reviewed or changed afterwards

Do not submit AI-generated code that you do not understand.

If your whole implementation is AI-only and has no real human work, review, or effort behind it, please do not contribute it.

If you do not have basic knowledge of C#, HTML, TypeScript, JavaScript, or CSS and only rely on "vibe coding", please do not open a PR. Instead, open an issue and request the feature you wanted to implement.

## Front-End Related PRs

Front-end related PRs are allowed, but they may be reviewed more strictly.

Some of the early CSS and JavaScript in VRCN started as Claude Code pre-designs around 4 months before this document was written on 06.05.2026. Some of that code was redundant or hard to maintain and has already been refactored, while other parts are still being cleaned up.

Because of this, I may deny front-end PRs if they make the code harder to maintain or repeat old problems.

For front-end PRs, please make sure that your changes are:

* Clean
* Maintainable
* Not redundant
* Consistent with the existing UI
* Responsive where needed
* Easy to understand

## Back-End Related PRs

Back-end related PRs have a strict **No-AI policy**.

Do not use AI to implement back-end code.

This rule exists for safety, security, and stability reasons. Back-end changes can break important parts of VRCN or introduce problems that are hard to detect.

If AI helped you understand something, you must clearly explain that in the PR description. However, I do not accept fully AI-generated back-end code at all.

For back-end PRs, you must be able to explain:

* What the code does
* Why the change is needed
* How it was tested
* Which files were changed
* Whether the change affects data, security, authentication, API usage, or app stability

## Code Quality

Please make sure your code is clean and understandable.

Avoid:

* Redundant code
* Unused code
* Large unrelated rewrites
* Messy formatting
* Unclear variable names
* Unsafe logic
* Unnecessary dependencies

Try to follow the existing project style as much as possible.

## Issues Instead of Pull Requests

If you are unsure how to implement something correctly, please open an issue instead of a Pull Request.

This is especially recommended if:

* You are not familiar with the codebase
* You are relying mostly on AI
* The feature touches back-end logic
* The change could affect security or stability
* You are unsure how to test your implementation

Opening an issue is always better than submitting unsafe or unreviewable code.

## Final Note

I appreciate contributions, but VRCN is actively developed and needs to stay maintainable, safe, and stable.

Good PRs with clear explanations are welcome.
Messy, unclear, fully AI-generated, or unsafe PRs will be denied.