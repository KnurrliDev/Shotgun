# Install Shotgun

There are two methods to install Shotgun:

- Install the VSIX package of a release.
- Build the extension from the source code.

Shotgun is not in the Visual Studio Marketplace. Shotgun needs DataFlow, and DataFlow is not in the Marketplace.

- [What you need](#what-you-need)
- [Install the VSIX](#install-the-vsix)
- [Connect to Claude Code](#connect-to-claude-code)
- [Build from the source code](#build-from-the-source-code)
- [Remove Shotgun](#remove-shotgun)

## What you need

- Windows 64-bit. Shotgun needs DataFlow, and DataFlow works only on Windows 64-bit.
- VS Code 1.143 or later.
- DataFlow 0.6.2 or later. [Install DataFlow](https://github.com/KnurrliDev/DataFlow/blob/master/docs/install.md) tells how to install it.
- Claude Code 2.1.323 or later, in its extension for VS Code or in a terminal.
- A C or C++ project with a compile database, as DataFlow needs. A task can also change the other text files of the project, but DataFlow gives no facts for them.

## Install the VSIX

1. Install DataFlow first. VS Code installs Shotgun only when DataFlow is there, because Shotgun names DataFlow as a dependency.
2. Open the [releases of Shotgun](https://github.com/KnurrliDev/Shotgun/releases) on GitHub.
3. Download the file `shotgun-<version>.vsix` of the latest release.
4. In VS Code, open the Extensions view. Click **…** at the top of the view, then click **Install from VSIX…**, and select the file. You can also install the file with a command in a terminal:

   ```bat
   code --install-extension shotgun-0.1.0.vsix
   ```

5. Click the icon of Shotgun in the activity bar. The sidebar of Shotgun opens.

To update Shotgun, install the VSIX of the new release. VS Code replaces the old version.

If DataFlow is older than 0.6.2, the panel of Shotgun tells it, and Claude Code gets no tools of Shotgun. Install a new release of DataFlow.

## Connect to Claude Code

Claude Code gets the tools of Shotgun through the MCP server of DataFlow. Thus Claude Code needs the connection of DataFlow and the connection of Shotgun.

1. Open the folder of your project in VS Code, and open a C or C++ file. DataFlow asks if it can connect to Claude Code. Click **Connect**. If DataFlow does not ask, run **DataFlow: Connect to Claude Code**.
2. In the sidebar of Shotgun, click **Claude Code**. You can also run **Shotgun: Connect to Claude Code**.
3. Start a new session of Claude Code in the folder of the project. A session that runs already does not load the plugin of Shotgun.

The connection of Shotgun makes these changes:

- It writes the plugin of Shotgun into the folder `.shotgun\claude` in your home folder. This folder is a local marketplace with the name `shotgun-vscode`, and the plugin has the name `shotgun`. The plugin has the hooks and the skills of Shotgun. [The tools and the skills](tools.md) tells more.
- It adds the marketplace to `extraKnownMarketplaces` in the user settings of Claude Code: the file `.claude\settings.json` in your home folder. If the environment variable `CLAUDE_CONFIG_DIR` gives a different folder, Shotgun uses the file `settings.json` of that folder.
- It turns the plugin on in `.claude\settings.local.json` of each workspace folder with a task of Shotgun. A new task also turns the plugin on in its folder. Thus the plugin is on only in your projects with Shotgun.
- It adds `.claude/settings.local.json` to the file `info/exclude` of the git repository of the folder. Thus git does not show the file.

The sidebar of Shotgun shows the state of the connection next to **Claude Code**. At each start, a connected Shotgun writes the files of the plugin of its version again. Thus an update of Shotgun also updates the plugin.

**Shotgun: Disconnect from Claude Code** removes the marketplace from the user settings of Claude Code, and the plugin from the local settings of each folder. Then it removes the folder of the plugin.

## Build from the source code

Use this method to change Shotgun, or to use code that is not in a release.

### What you need for the build

- VS Code 1.143 or later
- Node.js 22.12 or later, with npm
- git
- DataFlow 0.6.2 or later, from a VSIX or from its repository

### Get the source code

1. Open a terminal in the folder for the repository.
2. Get the repository:

   ```bat
   git clone https://github.com/KnurrliDev/Shotgun.git
   ```

3. Go into the folder of the repository, install the npm packages, and compile the extension:

   ```bat
   cd Shotgun
   npm install
   npm run compile
   ```

### Start VS Code with Shotgun

Run `open-editor.bat` in the root folder of the repository. To open a folder in the new window, give the folder as an argument:

```bat
open-editor.bat C:\Projects\App
```

The script compiles Shotgun, and opens a new VS Code window with Shotgun. [Develop Shotgun](development.md#run-the-extension) tells more. [Make a release](development.md#make-a-release) tells how to make a VSIX package.

## Remove Shotgun

1. Run **Shotgun: Disconnect from Claude Code**. This command removes the settings of Shotgun from Claude Code, and the folder of the plugin.
2. In the Extensions view, uninstall Shotgun.

The folders `.shotgun` of your projects stay. You decide if you keep them.
