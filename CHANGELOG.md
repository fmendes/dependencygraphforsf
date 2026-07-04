# Change Log

All notable changes to the "dependencygraphforsf" extension will be documented in this file.

## [Released]

- Initial release 0.0.1
- 1.0.1 release:  Added issue reporting GitHub template
- 1.0.2 release:  Replaced the Node "open" package - it sometimes does not get installed properly for some reason
- 1.0.3 release:  Increased maximum number of dependencies and added context menu items and ability to display the graph for only one item with all its dependencies
- 1.0.4 release:  New icon, dependency graph for single item now includes "grandparents" and "grandchildren" dependencies, adjusted compatibility with VSCode 1.60 and later versions
- 1.0.5 release:  Enhanced code that parses method calls to work better with Mermaid JS
- 1.0.6 release:  Bug fix for Windows version
- 1.0.7 release:  Enhanced the seeking of dependencies when an item is right-clicked
- 1.0.8 release:  Better detection of non-method references, refactoring and new tests
- 1.0.9 release:  Fixed handling of folder names with spaces
- 1.0.10 release:  Fixed handling of folder names in Windows appearing as ///c%3a
- 1.1.0 release:  Internal dependency graph for a single Apex class with sObject read/write detection, clickable nodes that open files in VS Code, multi-package folder discovery via sfdx-project.json, settings (dependencyLimit, minConnections, sourceFolders), packaged flows excluded, LWC context-menu fix, deterministic graph rendering, automated test suite
- 1.1.1 release:  Graph opens in a VS Code webview panel (renderIn setting), search/filter box, day/night mode toggle, zoom controls, SVG/PNG export, depth control for the selected-item graph (selectedItemDepth setting), flows calling invocable Apex detected and labeled, triggers linked to the sObject they fire on