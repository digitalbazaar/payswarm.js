Hacking on payswarm.js
======================

Want to hack on payswarm.js? Great! Here are a few notes:

Code
----

* In general, follow a common [Node.js Style Guide][].
* Try to make the code pass [jshint][] checks.
  * `npm run-script lint`
* Use version X.Y.Z-dev in dev mode.
* Use version X.Y.Z for releases.
* Use simple tagging prefixes for commit messages like "[tools] ...":
  * `[tools]`: various payswarm tools (bin/, tools/)
  * `[lib]`: the main library (lib/)
  * `[docs]`: documentation
  * `[package]`: payswarm.js packaging and releases

Versioning
----------

* Follow the [Semantic Versioning][] guidelines.

Release Process
---------------

* commit changes
* `$EDITOR package.json`: update to release version and remove `-dev` suffix.
* `git commit package.json -m "[package] Release {version}."`
* `git tag {version}`
* `$EDITOR package.json`: update to next version and add `-dev` suffix.
* `git commit package.json -m "[package] Start {next-version}."`
* `git push --tags`

To ensure a clean upload, use a clean checkout, and run the following:

* `git checkout {version}`
* `npm publish`

[Node.js Style Guide]: http://nodeguide.com/style.html
[jshint]: http://www.jshint.com/install/
[Semantic Versioning]: http://semver.org/
