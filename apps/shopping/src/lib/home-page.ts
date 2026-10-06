import { createList, renameMe } from './actions';
import { isRedirecting, logout } from './auth';
import { restoreHome, saveHome } from './cache';
import { fromIsoDate, quickDays, shortDateLabel, toIsoDate, weekdayShort } from './dates';
import { resumeDeletions } from './deletions';
import { contributors, homeSummary, listProgress, rowStatus, splitLists } from './groups';
import { goTo, listUrl, takeFlash } from './nav';
import { installApp } from './pwa';
import { disableNotifications, enableNotifications, sendTestPush } from './push';
import type { List } from './pb';
import { loadHome, loadUsers, onReconnect, subscribeHome } from './realtime';
import { items, lists, session, toast } from './stores';

export function homePage() {
  return {
    loaded: false,
    sheet: null as 'newList' | 'profile' | null,
    pastOpen: false,
    days: quickDays(),
    newListDate: toIsoDate(new Date()),
    newListTitle: '',
    creating: false,
    nameDraft: '',

    async init() {
      if (isRedirecting()) return;
      this.loaded = restoreHome();
      resumeDeletions();
      const flash = takeFlash();
      if (flash) toast().show(flash);

      subscribeHome();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.reload();
        else saveHome();
      });
      onReconnect(() => void this.reload());
      await this.reload();
    },

    async reload() {
      try {
        await Promise.all([loadUsers(), loadHome()]);
        saveHome();
      } catch {
        // Offline or a server error: the page keeps what it already shows.
      } finally {
        this.loaded = true;
      }
    },

    get greeting() {
      return `Ciao ${session().me?.name ?? ''}`;
    },

    get groups() {
      return splitLists(lists().all);
    },

    get summary() {
      return homeSummary(this.groups.upcoming, items().all);
    },

    get partnerName() {
      return session().partner?.name ?? '';
    },

    rows(group: List[]) {
      const meId = session().me?.id ?? '';
      return group.map((list) => {
        const listItems = items().forList(list.id);
        const progress = listProgress(listItems);
        return {
          id: list.id,
          url: listUrl(list.id),
          title: list.title,
          day: fromIsoDate(list.date).getDate(),
          weekday: weekdayShort(list.date),
          date: shortDateLabel(list.date),
          status: rowStatus(progress),
          percent: progress.percent,
          done: progress.total > 0 && progress.toBuy === 0,
          people: contributors(listItems, meId),
        };
      });
    },

    openNewList() {
      this.days = quickDays();
      this.newListDate = this.days[0].date;
      this.newListTitle = '';
      this.sheet = 'newList';
    },

    openProfile() {
      this.nameDraft = session().me?.name ?? '';
      this.sheet = 'profile';
    },

    async submitNewList() {
      if (this.creating) return;
      this.creating = true;
      const id = await createList(this.newListDate || toIsoDate(new Date()), this.newListTitle);
      if (id) goTo(`${listUrl(id)}&nuova=1`);
      else this.creating = false;
    },

    open: goTo,

    saveName() {
      void renameMe(this.nameDraft);
    },

    install: installApp,
    enableNotifications,
    sendTestPush,
    // The test push route exists only on a backend started with DEV=1.
    devTools: import.meta.env.DEV,

    toggleNotifications() {
      if (session().notifications === 'on') void disableNotifications();
      else void enableNotifications();
    },

    logout,
  };
}
