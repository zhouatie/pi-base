import assert from "node:assert/strict";
import test from "node:test";
import type { EditorComponent } from "@earendil-works/pi-tui";
import { LivePreviewEditor } from "./live-preview-editor.ts";

class FakeEditor implements EditorComponent {
	private text = "";
	expandedText: string | undefined;
	onSubmit: ((text: string) => void) | undefined;
	onChange: ((text: string) => void) | undefined;
	focused = false;
	actionHandlers = new Map();

	render(): string[] {
		return [this.text];
	}

	handleInput(data: string): void {
		this.setText(this.text + data);
	}

	invalidate(): void {}

	getText(): string {
		return this.text;
	}

	getExpandedText(): string {
		return this.expandedText ?? this.text;
	}

	setText(text: string): void {
		this.text = text;
		this.onChange?.(text);
	}
}

test("observes editor changes while preserving the core change handler", () => {
	const base = new FakeEditor();
	const coreChanges: string[] = [];
	const previewChanges: string[] = [];
	const editor = new LivePreviewEditor(base, (text) => previewChanges.push(text));
	editor.onChange = (text) => coreChanges.push(text);

	editor.setText("programmatic change");
	editor.handleInput("!");

	assert.deepEqual(coreChanges, ["programmatic change", "programmatic change!"]);
	assert.deepEqual(previewChanges, ["programmatic change", "programmatic change!"]);
});

test("uses expanded content for preview while preserving the core marker text", () => {
	const base = new FakeEditor();
	const coreChanges: string[] = [];
	const previewChanges: string[] = [];
	const editor = new LivePreviewEditor(base, (text) => previewChanges.push(text));
	editor.onChange = (text) => coreChanges.push(text);
	base.expandedText = "full pasted content";

	base.setText("[paste #1 1001 chars]");

	assert.deepEqual(coreChanges, ["[paste #1 1001 chars]"]);
	assert.deepEqual(previewChanges, ["full pasted content"]);
	assert.equal(editor.getText(), "full pasted content");
});

test("delegates focus and app action handlers to a wrapped custom editor", () => {
	const base = new FakeEditor();
	const editor = new LivePreviewEditor(base, () => {});

	editor.focused = true;
	assert.equal(base.focused, true);
	assert.equal(editor.actionHandlers, base.actionHandlers);
});
