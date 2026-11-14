// The last prompts of the user in this window. The context hook gives each prompt to Shotgun before Claude gets it.
// submit_brief checks a brief from the chat against these prompts (decision 12). Shotgun keeps them only in memory: no
// file has them, and they go away with the window.

export class PromptLog {
	private readonly items: string[] = [];

	constructor(private readonly maxCount = 20, private readonly maxChars = 200_000) {}

	// A value that Claude Code did not fill, for example ${prompt}, is not a prompt
	add(prompt: string): void {
		if (!prompt.trim() || /^\$\{[^}]*\}$/.test(prompt.trim())) {
			return;
		}
		this.items.push(prompt);
		// the newest prompt stays, also if it is longer than the maximum
		while (this.items.length > this.maxCount || (this.items.length > 1 && this.items.reduce((n, p) => n + p.length, 0) > this.maxChars)) {
			this.items.shift();
		}
	}

	get prompts(): readonly string[] {
		return this.items;
	}
}
