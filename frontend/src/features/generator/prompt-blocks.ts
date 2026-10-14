// Bausteine unter dem Prompt: Stimmung, Szene, Detail als Auswahl, jeder einzeln würfelbar.
// Sie lesen den Prompt-Text und schreiben nur ihren eigenen Teil zurück; eigener Text bleibt stehen.
import { blockOptions, PROMPT_BLOCKS, promptBlock, rollPromptBlock, setPromptBlock, type DiceOptions, type PromptBlock } from "./random-content.ts";

export interface PromptBlocksDeps {
  field: HTMLTextAreaElement;
  root: HTMLElement;
  dice: () => DiceOptions;
  /** Vor jeder Änderung durch einen Baustein (für ↶) */
  beforeChange: () => void;
}

export class PromptBlocks {
  private readonly deps: PromptBlocksDeps;

  constructor(deps: PromptBlocksDeps) {
    this.deps = deps;
    deps.field.addEventListener("input", () => this.sync());
    deps.root.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      const block = select.dataset.block as PromptBlock | undefined;
      if (block) this.write(setPromptBlock(deps.field.value, block, select.value));
    });
    deps.root.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLElement>("[data-block-dice]");
      if (!button) return;
      this.write(rollPromptBlock(deps.field.value, button.dataset.blockDice as PromptBlock, deps.dice()));
      button.classList.remove("roll");
      void button.offsetWidth;
      button.classList.add("roll");
    });
    this.sync();
  }

  /** Auswahl an den Prompt-Text und das Thema anpassen; nach Änderungen von außen aufrufen. */
  sync(): void {
    const prompt = this.deps.field.value;
    for (const block of PROMPT_BLOCKS) {
      const select = this.deps.root.querySelector<HTMLSelectElement>(`select[data-block="${block}"]`)!;
      const current = promptBlock(prompt, block);
      const options = ["", ...blockOptions(block, this.deps.dice().theme ?? "all", current)];
      if ([...select.options].map((o) => o.value).join("\n") !== options.join("\n")) {
        select.replaceChildren(...options.map((v) => new Option(v || "—", v)));
      }
      select.value = current;
      select.title = current;
    }
  }

  private write(prompt: string): void {
    this.deps.beforeChange();
    this.deps.field.value = prompt;
    this.sync();
  }
}
