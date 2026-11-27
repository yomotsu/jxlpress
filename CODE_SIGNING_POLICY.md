# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Windows releases of JXLPress are built from this repository by [GitHub Actions](.github/workflows/release.yml) and signed through SignPath. Only releases built by that workflow from a tagged commit of this repository are signed.

## Team roles

- Committers and reviewers: [yomotsu](https://github.com/yomotsu)
- Approvers: [yomotsu](https://github.com/yomotsu)

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, with the following exception:

- **Update check**: at startup, and when "アップデートを確認…" is chosen from the Help menu, JXLPress requests `https://api.github.com/repos/yomotsu/jxlpress/releases/latest` to see whether a newer version exists. The request carries no personal data and none of your images or settings; GitHub receives the usual connection data such as your IP address and the `User-Agent: JXLPress/<version>` header. GitHub's handling of that data is covered by the [GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

Images are converted locally on your computer and are never uploaded.
