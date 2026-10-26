// Route table.
import { home, member, team, leaderboard, time } from './dashboards.js';
import { leads, lead, pipeline, listings } from './crm.js';
import { tasks, calendar, chat } from './work.js';
import { people, audit } from './admin.js';
import { projects, reservations, workspace, platform } from './saas.js';
import { assistant } from './ai.js';

export const routes = {
  home, me: member, member, team, leaderboard, time,
  leads, lead, assistant, pipeline, listings,
  tasks, calendar, chat,
  people, audit,
  projects, reservations, workspace, platform,
};
