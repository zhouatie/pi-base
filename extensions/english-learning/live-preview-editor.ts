import type { AppKeybinding } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, EditorComponent } from "@earendil-works/pi-tui";

type AppAwareEditor = EditorComponent & {
	actionHandlers?: Map<AppKeybinding, () => void>;
	onEscape?: () => void;
	onCtrlD?: () => void;
	onPasteImage?: () => void;
	onExtensionShortcut?: (data: string) => boolean;
	focused?: boolean;
	wantsKeyRelease?: boolean;
	dispose?: () => void;
};

export class LivePreviewEditor implements EditorComponent {
	private readonly base: AppAwareEditor;
	private readonly onTextChange: (text: string) => void;
	private changeHandler: ((text: string) => void) | undefined;

	constructor(base: EditorComponent, onTextChange: (text: string) => void) {
		this.base = base;
		this.onTextChange = onTextChange;
	}

	get onSubmit(): ((text: string) => void) | undefined {
		return this.base.onSubmit;
	}

	set onSubmit(handler: ((text: string) => void) | undefined) {
		this.base.onSubmit = handler;
	}

	get onChange(): ((text: string) => void) | undefined {
		return this.changeHandler;
	}

	set onChange(handler: ((text: string) => void) | undefined) {
		this.changeHandler = handler;
		this.base.onChange = (text) => {
			handler?.(text);
			this.onTextChange(this.base.getExpandedText?.() ?? text);
		};
	}

	get actionHandlers(): Map<AppKeybinding, () => void> | undefined {
		return this.base.actionHandlers;
	}

	get onEscape(): (() => void) | undefined {
		return this.base.onEscape;
	}

	set onEscape(handler: (() => void) | undefined) {
		this.base.onEscape = handler;
	}

	get onCtrlD(): (() => void) | undefined {
		return this.base.onCtrlD;
	}

	set onCtrlD(handler: (() => void) | undefined) {
		this.base.onCtrlD = handler;
	}

	get onPasteImage(): (() => void) | undefined {
		return this.base.onPasteImage;
	}

	set onPasteImage(handler: (() => void) | undefined) {
		this.base.onPasteImage = handler;
	}

	get onExtensionShortcut(): ((data: string) => boolean) | undefined {
		return this.base.onExtensionShortcut;
	}

	set onExtensionShortcut(handler: ((data: string) => boolean) | undefined) {
		this.base.onExtensionShortcut = handler;
	}

	get focused(): boolean {
		return this.base.focused ?? false;
	}

	set focused(focused: boolean) {
		if ("focused" in this.base) this.base.focused = focused;
	}

	get wantsKeyRelease(): boolean {
		return this.base.wantsKeyRelease ?? false;
	}

	get borderColor(): ((text: string) => string) | undefined {
		return this.base.borderColor;
	}

	set borderColor(color: ((text: string) => string) | undefined) {
		this.base.borderColor = color;
	}

	render(width: number): string[] {
		return this.base.render(width);
	}

	handleInput(data: string): void {
		this.base.handleInput(data);
	}

	invalidate(): void {
		this.base.invalidate();
	}

	getText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText();
	}

	setText(text: string): void {
		this.base.setText(text);
	}

	addToHistory(text: string): void {
		this.base.addToHistory?.(text);
	}

	insertTextAtCursor(text: string): void {
		this.base.insertTextAtCursor?.(text);
	}

	getExpandedText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText();
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.base.setAutocompleteProvider?.(provider);
	}

	setPaddingX(padding: number): void {
		this.base.setPaddingX?.(padding);
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.base.setAutocompleteMaxVisible?.(maxVisible);
	}

	dispose(): void {
		this.base.dispose?.();
	}
}
