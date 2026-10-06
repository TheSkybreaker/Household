import Alpine from 'alpinejs';
import { addItem, type AddOutcome } from './actions';
import { splitItems, suggestions } from './groups';
import { items } from './stores';

const scrollBehavior = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function showItem(outcome: AddOutcome) {
  void Alpine.nextTick(() => {
    const row = document.querySelector<HTMLElement>(`.item[data-id="${outcome.itemId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    if (outcome.kind === 'added') return;
    // Restart the flash even when the same row flashed a moment ago.
    row.classList.remove('is-flash');
    void row.offsetWidth;
    row.classList.add('is-flash');
  });
}

export function composer(listId: string) {
  return {
    text: '',

    get chips() {
      return suggestions(splitItems(items().forList(listId)).toBuy);
    },

    submit() {
      const outcome = addItem(listId, this.text);
      if (!outcome) return;
      // A duplicate keeps the text, so it can be corrected.
      if (outcome.kind !== 'duplicate') this.text = '';
      showItem(outcome);
    },

    addSuggestion(name: string) {
      const outcome = addItem(listId, name);
      if (outcome) showItem(outcome);
    },
  };
}
