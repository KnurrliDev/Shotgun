import * as assert from 'assert';
import * as path from 'path';
import {
	dataflowConnectionOf, isPluginOn, isSamePath, LOCAL_SETTINGS, localSettingsFile, MARKETPLACE_NAME, marketplacePathOf, PLUGIN_ID, withMarketplace,
	withoutMarketplace, withoutPlugin, withPlugin,
} from '../../claude/settings';

// The settings of Claude Code for the plugin of Shotgun (proposal P15)
suite('Settings of Claude Code', () => {
	const dir = path.resolve('/home/user/.shotgun/claude');

	test('The marketplace goes into the user settings, and the other keys stay', () => {
		const old = '{\n    "model": "opus",\n    "extraKnownMarketplaces": {\n        "other": { "source": { "source": "github", "repo": "a/b" } }\n    }\n}\n';
		const text = withMarketplace(old, dir);
		const settings = JSON.parse(text);
		assert.strictEqual(settings.model, 'opus');
		assert.deepStrictEqual(Object.keys(settings.extraKnownMarketplaces), ['other', MARKETPLACE_NAME]);
		assert.deepStrictEqual(settings.extraKnownMarketplaces[MARKETPLACE_NAME], { source: { source: 'directory', path: dir } });
		// the indent and the end of the old text stay
		assert.ok(text.startsWith('{\n    "model"') && text.endsWith('}\n'), text);
		assert.strictEqual(marketplacePathOf(text), dir);
		// a key that has no other value goes away
		assert.deepStrictEqual(JSON.parse(withoutMarketplace(withMarketplace('{}', dir))!), {});
		assert.deepStrictEqual(Object.keys(JSON.parse(withoutMarketplace(text)!).extraKnownMarketplaces), ['other']);
		assert.strictEqual(withoutMarketplace('{ "model": "opus" }'), undefined);
		assert.strictEqual(marketplacePathOf('not JSON'), undefined);
	});

	test('The plugin goes on in the local settings of a project, and goes off again', () => {
		const text = withPlugin('{\r\n\t"permissions": { "allow": ["Read"] }\r\n}');
		assert.ok(isPluginOn(text));
		assert.ok(text.includes('\r\n\t"enabledPlugins"'), JSON.stringify(text));
		assert.deepStrictEqual(JSON.parse(text).enabledPlugins, { [PLUGIN_ID]: true });
		assert.ok(isPluginOn(withPlugin(undefined)));
		assert.ok(!isPluginOn('{ "enabledPlugins": { "shotgun@shotgun-vscode": false } }'));
		assert.deepStrictEqual(JSON.parse(withoutPlugin(text)!), { permissions: { allow: ['Read'] } });
		assert.strictEqual(withoutPlugin('{}'), undefined);
		// settings that are not a JSON object do not change
		assert.throws(() => withPlugin('[1]'), /not a JSON object/);
		assert.throws(() => withPlugin('{ "a": 1, }'));
	});

	test('The connection of DataFlow, as DataFlow reads it', () => {
		const connected = '{ "extraKnownMarketplaces": { "dataflow-vscode": {} }, "enabledPlugins": { "dataflow@dataflow-vscode": true } }';
		assert.strictEqual(dataflowConnectionOf(connected), 'connected');
		assert.strictEqual(dataflowConnectionOf('{ "extraKnownMarketplaces": { "dataflow-vscode": {} } }'), 'disabled');
		assert.strictEqual(dataflowConnectionOf('{ "enabledPlugins": { "dataflow@dataflow-vscode": false } }'), 'disabled');
		assert.strictEqual(dataflowConnectionOf(undefined), 'none');
		assert.strictEqual(dataflowConnectionOf('not JSON'), 'none');
	});

	test('The paths', () => {
		assert.strictEqual(localSettingsFile(path.resolve('/p')), path.join(path.resolve('/p'), '.claude', 'settings.local.json'));
		assert.strictEqual(LOCAL_SETTINGS, '.claude/settings.local.json');
		assert.ok(isSamePath(dir, `${dir}${path.sep}`));
		assert.strictEqual(isSamePath(dir.toUpperCase(), dir), process.platform === 'win32' || process.platform === 'darwin');
	});
});
