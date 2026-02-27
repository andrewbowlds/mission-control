import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  AppFacade,
  TrelloBoard,
  TrelloList,
  TrelloCard,
  TrelloComment,
  TrelloLabel,
  TrelloChecklistItem,
} from "../app.ts";

const LABEL_COLORS = [
  { color: "#ef4444", name: "Red" },
  { color: "#f97316", name: "Orange" },
  { color: "#eab308", name: "Yellow" },
  { color: "#22c55e", name: "Green" },
  { color: "#3b82f6", name: "Blue" },
  { color: "#a855f7", name: "Purple" },
];

@customElement("mc-trello")
export class McTrello extends LitElement {
  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    /* ── Toolbar ─────────────────────────────────────────────────────────── */
    .toolbar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; border-bottom: 1px solid #1e1e2e;
      background: #0d0d14; flex-shrink: 0;
    }
    .toolbar select, .toolbar input, .toolbar button {
      background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 6px 10px; font-size: 13px; font-family: inherit;
    }
    .toolbar button { cursor: pointer; }
    .toolbar button:hover { background: #1e1e2e; }
    .toolbar .btn-primary { background: #7c3aed; border-color: #8b5cf6; }
    .toolbar .btn-primary:hover { background: #8b5cf6; }
    .toolbar .btn-danger { color: #ef4444; border-color: #3b0a0a; }
    .toolbar .btn-danger:hover { background: #3b0a0a; }
    .board-name { font-size: 15px; font-weight: 600; color: #e2e8f0; }
    .board-desc { font-size: 12px; color: #64748b; margin-left: 4px; }

    /* ── Board ───────────────────────────────────────────────────────────── */
    .board {
      flex: 1; display: flex; gap: 12px; padding: 12px;
      overflow-x: auto; overflow-y: hidden; align-items: flex-start;
    }

    /* ── List (column) ───────────────────────────────────────────────────── */
    .list {
      min-width: 272px; max-width: 272px; background: #111118;
      border: 1px solid #1e1e2e; border-radius: 10px;
      display: flex; flex-direction: column; max-height: 100%;
    }
    .list-header {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 12px; border-bottom: 1px solid #1e1e2e; flex-shrink: 0;
    }
    .list-title {
      font-size: 13px; font-weight: 600; color: #e2e8f0; flex: 1;
      background: none; border: none; padding: 0; font-family: inherit;
      outline: none; cursor: text;
    }
    .list-title:focus { border-bottom: 1px solid #a78bfa; }
    .list-count { font-size: 11px; color: #64748b; }
    .list-menu-btn {
      background: none; border: none; color: #64748b; cursor: pointer;
      font-size: 14px; padding: 2px 4px; border-radius: 4px;
    }
    .list-menu-btn:hover { background: #1e1e2e; color: #e2e8f0; }
    .list-body {
      flex: 1; overflow-y: auto; padding: 6px 8px;
      display: flex; flex-direction: column; gap: 6px;
    }

    /* ── Card ─────────────────────────────────────────────────────────────── */
    .card {
      background: #16162a; border: 1px solid #1e1e2e; border-radius: 8px;
      padding: 8px 10px; cursor: pointer; transition: border-color 0.15s;
    }
    .card:hover { border-color: #4c1d95; }
    .card.dragging { opacity: 0.5; }
    .card.drag-over { border-color: #a78bfa; border-style: dashed; }
    .card-labels { display: flex; gap: 4px; margin-bottom: 4px; flex-wrap: wrap; }
    .card-label {
      height: 6px; width: 32px; border-radius: 3px;
    }
    .card-title { font-size: 13px; color: #e2e8f0; line-height: 1.3; }
    .card-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; color: #64748b; }
    .card-due { display: flex; align-items: center; gap: 3px; }
    .card-due.overdue { color: #ef4444; }
    .card-checklist-progress { display: flex; align-items: center; gap: 3px; }
    .card-assignee { margin-left: auto; color: #a78bfa; font-weight: 500; }

    /* ── Add card / list ─────────────────────────────────────────────────── */
    .add-card-btn, .add-list-btn {
      background: none; border: none; color: #64748b; cursor: pointer;
      font-size: 13px; padding: 8px 10px; text-align: left; border-radius: 6px;
      width: 100%;
    }
    .add-card-btn:hover, .add-list-btn:hover { background: #1a1a2a; color: #e2e8f0; }
    .add-card-form, .add-list-form {
      padding: 6px 8px;
    }
    .add-card-form textarea, .add-list-form input {
      width: 100%; background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit;
      box-sizing: border-box; resize: none;
    }
    .add-card-form textarea { height: 54px; }
    .form-actions { display: flex; gap: 6px; margin-top: 6px; }
    .form-actions button {
      background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px;
    }
    .form-actions .btn-add { background: #7c3aed; border-color: #8b5cf6; }
    .form-actions .btn-add:hover { background: #8b5cf6; }
    .form-actions .btn-cancel:hover { background: #1e1e2e; }

    .add-list-placeholder {
      min-width: 272px; max-width: 272px;
      flex-shrink: 0;
    }

    /* ── No board / empty state ──────────────────────────────────────────── */
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      flex: 1; gap: 12px; color: #64748b;
    }
    .empty-state h2 { color: #94a3b8; font-size: 18px; margin: 0; }

    /* ── Card detail modal ───────────────────────────────────────────────── */
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      display: flex; align-items: flex-start; justify-content: center;
      z-index: 100; padding-top: 60px;
    }
    .modal {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 12px;
      width: 600px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
      padding: 20px 24px;
    }
    .modal h3 { margin: 0 0 12px; font-size: 18px; color: #e2e8f0; }
    .modal-section { margin-bottom: 16px; }
    .modal-section-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .modal input, .modal textarea, .modal select {
      width: 100%; background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .modal textarea { resize: vertical; min-height: 60px; }
    .modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
    .modal-actions button {
      background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 13px;
    }
    .modal-actions button:hover { background: #1e1e2e; }
    .modal-actions .btn-save { background: #7c3aed; border-color: #8b5cf6; }
    .modal-actions .btn-save:hover { background: #8b5cf6; }
    .modal-actions .btn-delete { color: #ef4444; border-color: #3b0a0a; }
    .modal-actions .btn-delete:hover { background: #3b0a0a; }

    /* ── Labels in modal ─────────────────────────────────────────────────── */
    .label-picker { display: flex; gap: 6px; flex-wrap: wrap; }
    .label-swatch {
      width: 32px; height: 24px; border-radius: 4px; cursor: pointer;
      border: 2px solid transparent; transition: border-color 0.15s;
    }
    .label-swatch.active { border-color: #fff; }
    .label-swatch:hover { opacity: 0.8; }

    /* ── Checklist in modal ──────────────────────────────────────────────── */
    .checklist-item {
      display: flex; align-items: center; gap: 8px; padding: 4px 0;
    }
    .checklist-item input[type="checkbox"] { accent-color: #a78bfa; cursor: pointer; }
    .checklist-item .cl-text { font-size: 13px; color: #e2e8f0; flex: 1; }
    .checklist-item .cl-text.done { text-decoration: line-through; color: #64748b; }
    .checklist-item .cl-del {
      background: none; border: none; color: #64748b; cursor: pointer; font-size: 11px; padding: 2px 4px;
    }
    .checklist-item .cl-del:hover { color: #ef4444; }
    .progress-bar { height: 4px; background: #1e1e2e; border-radius: 2px; margin-bottom: 6px; }
    .progress-fill { height: 100%; background: #22c55e; border-radius: 2px; transition: width 0.2s; }

    /* ── Comments ─────────────────────────────────────────────────────────── */
    .comment {
      padding: 8px 0; border-bottom: 1px solid #1e1e2e;
    }
    .comment:last-child { border-bottom: none; }
    .comment-author { font-size: 12px; font-weight: 600; color: #a78bfa; }
    .comment-time { font-size: 11px; color: #475569; margin-left: 8px; }
    .comment-text { font-size: 13px; color: #e2e8f0; margin-top: 3px; white-space: pre-wrap; }

    /* ── Board create modal ──────────────────────────────────────────────── */
    .board-modal {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 12px;
      width: 400px; max-width: 90vw; padding: 20px 24px;
    }
    .board-modal h3 { margin: 0 0 14px; font-size: 16px; color: #e2e8f0; }
    .board-modal .form-row { margin-bottom: 10px; }
    .board-modal label { display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .board-modal input, .board-modal textarea {
      width: 100%; background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit; box-sizing: border-box;
    }
  `;

  @property({ attribute: false }) app!: AppFacade;

  // Board selection
  @state() private selectedBoardId = "";
  @state() private showBoardCreate = false;
  @state() private boardFormName = "";
  @state() private boardFormDesc = "";

  // Add card inline
  @state() private addingCardListId = "";
  @state() private addCardTitle = "";

  // Add list inline
  @state() private addingList = false;
  @state() private addListName = "";

  // Card detail modal
  @state() private selectedCardId = "";
  @state() private cardComments: TrelloComment[] = [];
  @state() private commentText = "";

  // Card edit fields
  @state() private editTitle = "";
  @state() private editDesc = "";
  @state() private editLabels: TrelloLabel[] = [];
  @state() private editDueAt = "";
  @state() private editAssignee = "";
  @state() private editChecklist: TrelloChecklistItem[] = [];
  @state() private newChecklistItem = "";

  // Drag state
  @state() private dragCardId = "";
  @state() private dragOverListId = "";

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  updated(changed: Map<string, unknown>) {
    // Auto-select first board if none selected
    if (changed.has("app") && this.app.trelloBoards.length > 0 && !this.selectedBoardId) {
      this.selectedBoardId = this.app.trelloBoards[0].id;
      this.app.setCurrentTrelloBoardId(this.selectedBoardId);
      void this.app.loadTrelloBoardData(this.selectedBoardId);
    }
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  private get selectedBoard(): TrelloBoard | undefined {
    return this.app.trelloBoards.find((b) => b.id === this.selectedBoardId);
  }

  private get sortedLists(): TrelloList[] {
    return [...this.app.trelloLists].sort((a, b) => a.position - b.position);
  }

  private cardsForList(listId: string): TrelloCard[] {
    return this.app.trelloCards
      .filter((c) => c.listId === listId)
      .sort((a, b) => a.position - b.position);
  }

  private get selectedCard(): TrelloCard | undefined {
    return this.app.trelloCards.find((c) => c.id === this.selectedCardId);
  }

  // ── Board management ───────────────────────────────────────────────────────

  private async onSelectBoard(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    this.selectedBoardId = id;
    this.app.setCurrentTrelloBoardId(id || null);
    if (id) void this.app.loadTrelloBoardData(id);
  }

  private async onCreateBoard() {
    if (!this.boardFormName.trim()) return;
    const board = await this.app.createTrelloBoard({
      name: this.boardFormName.trim(),
      description: this.boardFormDesc.trim() || undefined,
    });
    if (board) {
      this.selectedBoardId = board.id;
      this.app.setCurrentTrelloBoardId(board.id);
      void this.app.loadTrelloBoardData(board.id);
    }
    this.showBoardCreate = false;
    this.boardFormName = "";
    this.boardFormDesc = "";
  }

  private async onDeleteBoard() {
    const board = this.selectedBoard;
    if (!board) return;
    if (!confirm(`Delete board "${board.name}" and all its lists/cards?`)) return;
    await this.app.deleteTrelloBoard(board.id);
    this.selectedBoardId = this.app.trelloBoards[0]?.id ?? "";
    this.app.setCurrentTrelloBoardId(this.selectedBoardId || null);
    if (this.selectedBoardId) void this.app.loadTrelloBoardData(this.selectedBoardId);
  }

  // ── List management ────────────────────────────────────────────────────────

  private async onAddList() {
    if (!this.addListName.trim() || !this.selectedBoardId) return;
    await this.app.createTrelloList({ boardId: this.selectedBoardId, name: this.addListName.trim() });
    this.addListName = "";
    this.addingList = false;
  }

  private async onRenameList(listId: string, name: string) {
    if (!name.trim()) return;
    await this.app.updateTrelloList(listId, { name: name.trim() });
  }

  private async onDeleteList(listId: string) {
    if (!confirm("Delete this list and all its cards?")) return;
    await this.app.deleteTrelloList(listId);
  }

  // ── Card management ────────────────────────────────────────────────────────

  private async onAddCard(listId: string) {
    if (!this.addCardTitle.trim()) return;
    await this.app.createTrelloCard({
      listId,
      boardId: this.selectedBoardId,
      title: this.addCardTitle.trim(),
    });
    this.addCardTitle = "";
    this.addingCardListId = "";
  }

  private openCardDetail(card: TrelloCard) {
    this.selectedCardId = card.id;
    this.editTitle = card.title;
    this.editDesc = card.description ?? "";
    this.editLabels = [...card.labels];
    this.editDueAt = card.dueAt ? new Date(card.dueAt).toISOString().slice(0, 10) : "";
    this.editAssignee = card.assignee ?? "";
    this.editChecklist = card.checklist.map((c) => ({ ...c }));
    this.commentText = "";
    this.newChecklistItem = "";
    void this.loadComments(card.id);
  }

  private async loadComments(cardId: string) {
    this.cardComments = await this.app.listTrelloComments(cardId);
  }

  private async onSaveCard() {
    const card = this.selectedCard;
    if (!card) return;
    await this.app.updateTrelloCard(card.id, {
      title: this.editTitle.trim() || card.title,
      description: this.editDesc,
      labels: this.editLabels,
      dueAt: this.editDueAt ? new Date(this.editDueAt).getTime() : null,
      assignee: this.editAssignee || null,
      checklist: this.editChecklist,
    });
    this.selectedCardId = "";
  }

  private async onDeleteCard() {
    const card = this.selectedCard;
    if (!card) return;
    if (!confirm(`Delete card "${card.title}"?`)) return;
    await this.app.deleteTrelloCard(card.id);
    this.selectedCardId = "";
  }

  private async onAddComment() {
    if (!this.commentText.trim() || !this.selectedCardId) return;
    const comment = await this.app.addTrelloComment(this.selectedCardId, this.commentText.trim());
    if (comment) this.cardComments = [...this.cardComments, comment];
    this.commentText = "";
  }

  // ── Checklist helpers ──────────────────────────────────────────────────────

  private toggleChecklistItem(index: number) {
    this.editChecklist = this.editChecklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item,
    );
  }

  private removeChecklistItem(index: number) {
    this.editChecklist = this.editChecklist.filter((_, i) => i !== index);
  }

  private addChecklistItem() {
    if (!this.newChecklistItem.trim()) return;
    this.editChecklist = [...this.editChecklist, { text: this.newChecklistItem.trim(), done: false }];
    this.newChecklistItem = "";
  }

  // ── Label helpers ──────────────────────────────────────────────────────────

  private toggleLabel(color: string) {
    const exists = this.editLabels.find((l) => l.color === color);
    if (exists) {
      this.editLabels = this.editLabels.filter((l) => l.color !== color);
    } else {
      this.editLabels = [...this.editLabels, { color, text: "" }];
    }
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  private onDragStart(e: DragEvent, cardId: string) {
    this.dragCardId = cardId;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", cardId);
  }

  private onDragOver(e: DragEvent, listId: string) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    this.dragOverListId = listId;
  }

  private onDragLeave(_e: DragEvent, listId: string) {
    if (this.dragOverListId === listId) this.dragOverListId = "";
  }

  private async onDrop(e: DragEvent, listId: string) {
    e.preventDefault();
    this.dragOverListId = "";
    const cardId = this.dragCardId;
    this.dragCardId = "";
    if (!cardId) return;
    const cardsInList = this.cardsForList(listId);
    const position = cardsInList.length > 0 ? cardsInList[cardsInList.length - 1].position + 1 : 0;
    await this.app.moveTrelloCard(cardId, listId, position);
  }

  private onDragEnd() {
    this.dragCardId = "";
    this.dragOverListId = "";
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const boards = this.app.trelloBoards;

    return html`
      ${this.renderToolbar(boards)}
      ${this.selectedBoardId
        ? this.renderBoard()
        : html`
            <div class="empty-state">
              <h2>No board selected</h2>
              <p>Create a board to get started</p>
              <button class="toolbar btn-primary" style="background:#7c3aed;border:1px solid #8b5cf6;color:#e2e8f0;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;"
                @click=${() => { this.showBoardCreate = true; }}>+ New Board</button>
            </div>
          `}
      ${this.selectedCardId ? this.renderCardModal() : nothing}
      ${this.showBoardCreate ? this.renderBoardCreateModal() : nothing}
    `;
  }

  private renderToolbar(boards: TrelloBoard[]) {
    const board = this.selectedBoard;
    return html`
      <div class="toolbar">
        <select .value=${this.selectedBoardId} @change=${this.onSelectBoard}>
          ${boards.length === 0 ? html`<option value="">No boards</option>` : nothing}
          ${boards.map((b) => html`<option value=${b.id}>${b.name}</option>`)}
        </select>
        <button class="btn-primary" @click=${() => { this.showBoardCreate = true; }}>+ Board</button>
        ${board ? html`
          <span class="board-name">${board.name}</span>
          ${board.description ? html`<span class="board-desc">— ${board.description}</span>` : nothing}
          <button class="btn-danger" @click=${this.onDeleteBoard}>Delete Board</button>
        ` : nothing}
      </div>
    `;
  }

  private renderBoard() {
    const lists = this.sortedLists;
    return html`
      <div class="board">
        ${lists.map((list) => this.renderList(list))}
        <div class="add-list-placeholder">
          ${this.addingList
            ? html`
                <div class="list" style="background:#0d0d14;">
                  <div class="add-list-form">
                    <input
                      placeholder="List name..."
                      .value=${this.addListName}
                      @input=${(e: Event) => { this.addListName = (e.target as HTMLInputElement).value; }}
                      @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this.onAddList(); if (e.key === "Escape") this.addingList = false; }}
                    />
                    <div class="form-actions">
                      <button class="btn-add" @click=${this.onAddList}>Add List</button>
                      <button class="btn-cancel" @click=${() => { this.addingList = false; }}>Cancel</button>
                    </div>
                  </div>
                </div>
              `
            : html`<button class="add-list-btn" style="background:#111118;border:1px solid #1e1e2e;border-radius:10px;" @click=${() => { this.addingList = true; }}>+ Add list</button>`}
        </div>
      </div>
    `;
  }

  private renderList(list: TrelloList) {
    const cards = this.cardsForList(list.id);
    const isDragOver = this.dragOverListId === list.id;
    return html`
      <div
        class="list"
        @dragover=${(e: DragEvent) => this.onDragOver(e, list.id)}
        @dragleave=${(e: DragEvent) => this.onDragLeave(e, list.id)}
        @drop=${(e: DragEvent) => this.onDrop(e, list.id)}
        style=${isDragOver ? "border-color:#a78bfa;border-style:dashed;" : ""}
      >
        <div class="list-header">
          <input
            class="list-title"
            .value=${list.name}
            @blur=${(e: Event) => this.onRenameList(list.id, (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <span class="list-count">${cards.length}</span>
          <button class="list-menu-btn" title="Delete list" @click=${() => this.onDeleteList(list.id)}>x</button>
        </div>
        <div class="list-body">
          ${cards.map((card) => this.renderCard(card))}
        </div>
        ${this.addingCardListId === list.id
          ? html`
              <div class="add-card-form">
                <textarea
                  placeholder="Card title..."
                  .value=${this.addCardTitle}
                  @input=${(e: Event) => { this.addCardTitle = (e.target as HTMLTextAreaElement).value; }}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.onAddCard(list.id); } if (e.key === "Escape") this.addingCardListId = ""; }}
                ></textarea>
                <div class="form-actions">
                  <button class="btn-add" @click=${() => this.onAddCard(list.id)}>Add</button>
                  <button class="btn-cancel" @click=${() => { this.addingCardListId = ""; }}>Cancel</button>
                </div>
              </div>
            `
          : html`<button class="add-card-btn" @click=${() => { this.addingCardListId = list.id; this.addCardTitle = ""; }}>+ Add card</button>`}
      </div>
    `;
  }

  private renderCard(card: TrelloCard) {
    const isDragging = this.dragCardId === card.id;
    const checkDone = card.checklist.filter((c) => c.done).length;
    const checkTotal = card.checklist.length;
    const isOverdue = card.dueAt ? card.dueAt < Date.now() : false;
    return html`
      <div
        class="card ${isDragging ? "dragging" : ""}"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.onDragStart(e, card.id)}
        @dragend=${this.onDragEnd}
        @click=${() => this.openCardDetail(card)}
      >
        ${card.labels.length > 0 ? html`
          <div class="card-labels">
            ${card.labels.map((l) => html`<div class="card-label" style="background:${l.color}"></div>`)}
          </div>
        ` : nothing}
        <div class="card-title">${card.title}</div>
        ${card.dueAt || checkTotal > 0 || card.assignee ? html`
          <div class="card-meta">
            ${card.dueAt ? html`<span class="card-due ${isOverdue ? "overdue" : ""}">${new Date(card.dueAt).toLocaleDateString()}</span>` : nothing}
            ${checkTotal > 0 ? html`<span class="card-checklist-progress">${checkDone}/${checkTotal}</span>` : nothing}
            ${card.assignee ? html`<span class="card-assignee">${card.assignee}</span>` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }

  // ── Card detail modal ──────────────────────────────────────────────────────

  private renderCardModal() {
    const card = this.selectedCard;
    if (!card) return nothing;

    const checkDone = this.editChecklist.filter((c) => c.done).length;
    const checkTotal = this.editChecklist.length;
    const progressPct = checkTotal > 0 ? (checkDone / checkTotal) * 100 : 0;

    return html`
      <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.selectedCardId = ""; }}>
        <div class="modal">
          <h3>Edit Card</h3>

          <!-- Title -->
          <div class="modal-section">
            <div class="modal-section-title">Title</div>
            <input .value=${this.editTitle} @input=${(e: Event) => { this.editTitle = (e.target as HTMLInputElement).value; }} />
          </div>

          <!-- Description -->
          <div class="modal-section">
            <div class="modal-section-title">Description</div>
            <textarea .value=${this.editDesc} @input=${(e: Event) => { this.editDesc = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </div>

          <!-- Labels -->
          <div class="modal-section">
            <div class="modal-section-title">Labels</div>
            <div class="label-picker">
              ${LABEL_COLORS.map((lc) => {
                const active = this.editLabels.some((l) => l.color === lc.color);
                return html`<div
                  class="label-swatch ${active ? "active" : ""}"
                  style="background:${lc.color}"
                  title=${lc.name}
                  @click=${() => this.toggleLabel(lc.color)}
                ></div>`;
              })}
            </div>
          </div>

          <!-- Due date -->
          <div class="modal-section">
            <div class="modal-section-title">Due Date</div>
            <input type="date" .value=${this.editDueAt} @input=${(e: Event) => { this.editDueAt = (e.target as HTMLInputElement).value; }} />
          </div>

          <!-- Assignee -->
          <div class="modal-section">
            <div class="modal-section-title">Assignee</div>
            <input placeholder="Agent ID or name" .value=${this.editAssignee} @input=${(e: Event) => { this.editAssignee = (e.target as HTMLInputElement).value; }} />
          </div>

          <!-- Checklist -->
          <div class="modal-section">
            <div class="modal-section-title">Checklist${checkTotal > 0 ? ` (${checkDone}/${checkTotal})` : ""}</div>
            ${checkTotal > 0 ? html`
              <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
            ` : nothing}
            ${this.editChecklist.map((item, i) => html`
              <div class="checklist-item">
                <input type="checkbox" .checked=${item.done} @change=${() => this.toggleChecklistItem(i)} />
                <span class="cl-text ${item.done ? "done" : ""}">${item.text}</span>
                <button class="cl-del" @click=${() => this.removeChecklistItem(i)}>x</button>
              </div>
            `)}
            <div style="display:flex;gap:6px;margin-top:6px;">
              <input
                style="flex:1;"
                placeholder="Add item..."
                .value=${this.newChecklistItem}
                @input=${(e: Event) => { this.newChecklistItem = (e.target as HTMLInputElement).value; }}
                @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this.addChecklistItem(); }}
              />
              <button style="background:#0a0a0f;border:1px solid #2d2d44;color:#e2e8f0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;" @click=${this.addChecklistItem}>+</button>
            </div>
          </div>

          <!-- Comments -->
          <div class="modal-section">
            <div class="modal-section-title">Comments</div>
            ${this.cardComments.map((c) => html`
              <div class="comment">
                <span class="comment-author">${c.author}</span>
                <span class="comment-time">${new Date(c.createdAt).toLocaleString()}</span>
                <div class="comment-text">${c.text}</div>
              </div>
            `)}
            <div style="display:flex;gap:6px;margin-top:8px;">
              <input
                style="flex:1;"
                placeholder="Add a comment..."
                .value=${this.commentText}
                @input=${(e: Event) => { this.commentText = (e.target as HTMLInputElement).value; }}
                @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this.onAddComment(); }}
              />
              <button style="background:#0a0a0f;border:1px solid #2d2d44;color:#e2e8f0;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;" @click=${this.onAddComment}>Send</button>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn-delete" @click=${this.onDeleteCard}>Delete</button>
            <button @click=${() => { this.selectedCardId = ""; }}>Cancel</button>
            <button class="btn-save" @click=${this.onSaveCard}>Save</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Board create modal ─────────────────────────────────────────────────────

  private renderBoardCreateModal() {
    return html`
      <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showBoardCreate = false; }}>
        <div class="board-modal">
          <h3>New Board</h3>
          <div class="form-row">
            <label>Name</label>
            <input
              .value=${this.boardFormName}
              @input=${(e: Event) => { this.boardFormName = (e.target as HTMLInputElement).value; }}
              @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this.onCreateBoard(); }}
            />
          </div>
          <div class="form-row">
            <label>Description (optional)</label>
            <textarea
              .value=${this.boardFormDesc}
              @input=${(e: Event) => { this.boardFormDesc = (e.target as HTMLTextAreaElement).value; }}
            ></textarea>
          </div>
          <div class="modal-actions">
            <button @click=${() => { this.showBoardCreate = false; }}>Cancel</button>
            <button class="btn-save" @click=${this.onCreateBoard}>Create</button>
          </div>
        </div>
      </div>
    `;
  }
}
