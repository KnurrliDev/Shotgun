// The styles of the page and of the panel. The content security policy allows no inline styles, so the webviews use a
// constructable stylesheet. The colors come from the theme of VS Code. The 2 colors of the writers come from the design
// canvas: amber for the user and pink for Claude, with darker values for a light theme.

const CSS = `
:root { --sg-you: #f2b544; --sg-claude: #f07fc9; --sg-ok: var(--vscode-testing-iconPassed, #73c991);
  --sg-warn: var(--vscode-editorWarning-foreground, #cca700); --sg-border: var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
  --sg-engine: var(--vscode-charts-blue, #3794ff); --sg-cool: var(--vscode-charts-blue, #3794ff); --sg-warm: var(--vscode-charts-yellow, #cca700);
  --sg-hot: var(--vscode-charts-orange, #d18616); }
body.vscode-light { --sg-you: #9a6700; --sg-claude: #b0297e; }
body.vscode-high-contrast, body.vscode-high-contrast-light { --sg-you: var(--vscode-charts-yellow); --sg-claude: var(--vscode-charts-purple);
  --sg-border: var(--vscode-contrastBorder); }
html, body { margin: 0; padding: 0; }
body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.45; }
body.page-body { background: var(--vscode-editor-background); }
p { margin: 0 0 8px; }
h1, h2 { margin: 0; font-weight: 600; }
.muted { color: var(--vscode-descriptionForeground); }
.grow { flex: 1; min-width: 0; }
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.name { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }

/* the bar of the 5 stages. A dot shows the writer of a stage */
.stages { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0 0; padding: 0; list-style: none; }
.stage { display: inline-flex; align-items: center; gap: 4px; padding: 0 5px; border: 1px solid var(--sg-border); border-radius: 4px;
  font-size: 11px; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.stage.current { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.stage.done { color: var(--vscode-foreground); }
.stage .check { color: var(--sg-ok); }
.large .stage { gap: 6px; padding: 2px 9px; font-size: 12px; }
.dots { display: inline-flex; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.dots .dot + .dot { margin-left: -2px; }
.dot.user { background: var(--sg-you); }
.dot.claude { background: var(--sg-claude); }

/* the stage of the task with the badges of its writers */
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 2px; }
.badge { display: inline-block; padding: 0 5px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; line-height: 1.5; }
.badge.user { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 16%, transparent); }
.badge.claude { color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 16%, transparent); }
.title { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
.section { margin-top: 14px; }
.rule { margin: 8px 0; padding: 4px 8px; border-left: 2px solid var(--sg-border); }
.banner { margin: 8px 0; padding: 6px 8px; border-left: 3px solid var(--sg-warn); background: color-mix(in srgb, var(--sg-warn) 10%, transparent); }

/* a request that the user types in Claude Code. A click copies the words */
.tell { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; width: 100%; margin: 0 0 8px; padding: 4px 8px;
  box-sizing: border-box; border: 1px dashed var(--sg-border); border-radius: 4px; background: none; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.tell:hover { border-color: var(--sg-claude); }
.tell .who { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--sg-claude); }
.tell .words { font-family: var(--vscode-editor-font-family); font-size: 12px; }

/* the buttons in the style of VS Code */
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.btn { padding: 2px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; font: inherit; line-height: 18px;
  cursor: pointer; }
.btn.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn.small { padding: 0 8px; font-size: 11px; }
.btn:focus-visible, .tell:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

.btn:disabled { opacity: 0.5; cursor: default; }
.small { font-size: 11px; }
/* a text button, for example a part of the brief or the line of a question */
.link { padding: 0; border: 0; background: none; color: var(--vscode-textLink-foreground); font: inherit; text-align: left; cursor: pointer; }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.link.part { color: inherit; }

/* stage 1: the parts of the brief, the questions of Claude and the gate */
.row-head { display: flex; align-items: baseline; gap: 6px; margin: 12px 0 2px; }
.row-head > .muted { margin-left: auto; }
.mark.q { color: var(--sg-claude); }
.notice { margin: 8px 0; padding: 4px 8px; border-left: 3px solid var(--sg-warn); }
.gate { margin: 14px 0 0; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--sg-border) 60%, transparent); }
.gate > .btn.primary { padding: 3px 14px; }

/* stage 2: the survey. The badge Model marks the words of Claude, and the badge Engine the facts of DataFlow */
.intro { margin: 10px 0 4px; }
.badge.engine { color: var(--sg-engine); background: color-mix(in srgb, var(--sg-engine) 16%, transparent); }
.id { flex: none; min-width: 2.4em; font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); }
.chips { flex: none; display: inline-flex; flex-wrap: wrap; gap: 3px; }
.chip { padding: 0 6px; border: 1px solid var(--sg-border); border-radius: 4px; background: none; color: inherit; font: inherit; font-size: 11px;
  line-height: 18px; cursor: pointer; }
.chip.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.chip.tool { cursor: default; font-family: var(--vscode-editor-font-family); }
.mono { font-family: var(--vscode-editor-font-family); }
/* a hook: its id, its title with its kind and place below it, and its heat. A long name breaks, so no text goes over a column */
.block { display: block; }
.hooks .row .grow, .list .grow { overflow-wrap: anywhere; }
.hooks .row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%;
  margin: 2px 0; padding: 4px 6px; box-sizing: border-box; border: 1px solid transparent; border-radius: 4px; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer; }
.hooks .row:hover { background: var(--vscode-list-hoverBackground, transparent); }
.hooks .row.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.heat { padding: 0 6px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
.heat.cool { color: var(--sg-cool); background: color-mix(in srgb, var(--sg-cool) 14%, transparent); }
.heat.warm { color: var(--sg-warm); background: color-mix(in srgb, var(--sg-warm) 14%, transparent); }
.heat.hot, .heat.very-hot { color: var(--sg-hot); background: color-mix(in srgb, var(--sg-hot) 16%, transparent); }
.heat.very-hot { font-weight: 700; }
.heat.none { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--sg-border) 35%, transparent); }
.code { margin: 8px 0; padding: 6px 0; overflow-x: auto; border: 1px solid var(--sg-border); border-radius: 4px;
  background: var(--vscode-textCodeBlock-background, transparent); font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px); line-height: 1.5; }
.code-line { display: flex; white-space: pre; }
.code-line .ln { flex: none; width: 3.5em; padding-right: 10px; text-align: right; color: var(--vscode-editorLineNumber-foreground); user-select: none; }
.code-line.hook { background: color-mix(in srgb, var(--vscode-focusBorder) 14%, transparent); box-shadow: inset 2px 0 var(--vscode-focusBorder); }
.answer { margin: 10px 0 0; }
.answer > p { margin-bottom: 4px; }
.answer textarea { display: block; width: 100%; box-sizing: border-box; min-height: 3em; margin: 0 0 4px; padding: 4px 6px; resize: vertical;
  border: 1px solid var(--vscode-input-border, var(--sg-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  font: inherit; }
.answer textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* lists: the setup, the decisions and the tasks */
.list { margin: 4px 0 0; padding: 0; list-style: none; }
.list li { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; }
.list li + li { border-top: 1px solid color-mix(in srgb, var(--sg-border) 50%, transparent); }
.mark { flex: none; width: 1em; text-align: center; font-weight: 700; }
.ok .mark { color: var(--sg-ok); }
.todo .mark { color: var(--sg-warn); }
.time { flex: none; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.by-guard .text { color: var(--vscode-descriptionForeground); }
.active-task { font-weight: 600; }
details > summary { cursor: pointer; }
.problems { color: var(--vscode-errorForeground); }

/* the panel beside the text editor */
.panel { padding: 8px 12px 16px; }

/* the page in the editor area */
.page { max-width: 1100px; margin: 0 auto; padding: 20px 28px 32px; }
.page-title { margin: 4px 0 2px; font-size: 20px; }
.grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; margin-top: 18px; align-items: start; }
.column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.card { padding: 12px 14px; border: 1px solid var(--sg-border); border-radius: 6px; }
.card > h2 { margin-bottom: 6px; }
@media (max-width: 760px) { .grid { grid-template-columns: minmax(0, 1fr); } }
`;

export function applyStyles(): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(CSS);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
