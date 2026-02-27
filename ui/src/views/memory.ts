import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade } from "../app.ts";

@customElement("mc-memory")
export class MCMemory extends LitElement {
  @property({ attribute: false }) app!: AppFacade;
  @state() q = "";
  @state() selectedFile = "";
  @state() selectedContent = "";
  @state() searchResults: Array<{ file: string; line: number; text: string }> = [];
  @state() actionError = "";

  static styles = css`
    :host { display: block; height: 100%; overflow: hidden; padding: 20px; box-sizing: border-box }
    .wrap { display: grid; grid-template-columns: 280px 1fr; gap: 12px; height: 100% }
    .pane {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 12px; overflow: auto;
    }
    .search-row { display: flex; gap: 6px; margin-bottom: 10px }
    .search-row input { flex: 1 }
    .file-item {
      padding: 8px 10px; border-bottom: 1px solid #1a1a2a; cursor: pointer;
      font-size: 13px; color: #94a3b8; transition: background 100ms;
    }
    .file-item:hover { background: #1e1e2e; color: #e2e8f0 }
    .file-item.active { background: #1e1e2e; color: #a78bfa }
    .meta { font-size: 12px; color: #475569; margin-top: 2px }
    pre { white-space: pre-wrap; font-size: 13px; color: #cbd5e1; margin: 0 }
    .hit {
      font-size: 12px; border-bottom: 1px solid #1a1a2a; padding: 6px 0;
      cursor: pointer;
    }
    .hit:hover { background: #1e1e2e }
    .hit b { color: #a78bfa }
    .empty { color: #475569; font-size: 13px; padding: 20px; text-align: center }
    .err { color: #f87171; font-size: 13px; margin-bottom: 8px }
    input, button {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 6px; font-size: 13px;
    }
    button { cursor: pointer }
    button:hover { background: #1e1e2e }
    h3 { margin: 0 0 12px; font-size: 15px; color: #94a3b8 }
  `;

  private async openFile(name: string) {
    this.actionError = "";
    try {
      const r = await this.app.gw.request<{ content: string }>("mc.memory.read", { file: name });
      this.selectedFile = name;
      this.selectedContent = r.content;
      this.searchResults = [];
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  private async search() {
    this.actionError = "";
    if (!this.q.trim()) return;
    try {
      const r = await this.app.gw.request<{ results: Array<{ file: string; line: number; text: string }> }>(
        "mc.memory.search", { query: this.q }
      );
      this.searchResults = r.results || [];
      this.selectedFile = "";
      this.selectedContent = "";
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  private fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  render() {
    const files = this.app.memoryFiles || [];
    return html`
      <div class="wrap">
        <div class="pane">
          ${this.actionError ? html`<div class="err">${this.actionError}</div>` : ""}
          <div class="search-row">
            <input
              .value=${this.q}
              @input=${(e: any) => (this.q = e.target.value)}
              @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this.search(); }}
              placeholder="Search memory..."
            />
            <button @click=${() => this.search()}>Search</button>
          </div>
          <div class="meta" style="margin-bottom:8px">${files.length} files</div>
          ${files.map(
            (f: any) => html`
              <div class="file-item ${this.selectedFile === f.name ? "active" : ""}" @click=${() => this.openFile(f.name)}>
                ${f.name}
                <div class="meta">${this.fmtSize(f.size)}</div>
              </div>
            `
          )}
        </div>
        <div class="pane">
          ${this.searchResults.length
            ? html`
                <h3>Search results for "${this.q}"</h3>
                ${this.searchResults.map(
                  (h) => html`<div class="hit" @click=${() => this.openFile(h.file)}>
                    <b>${h.file}:${h.line}</b> ${h.text}
                  </div>`
                )}
              `
            : this.selectedFile
              ? html`<h3>${this.selectedFile}</h3><pre>${this.selectedContent}</pre>`
              : html`<div class="empty">Select a file or search</div>`}
        </div>
      </div>
    `;
  }
}
