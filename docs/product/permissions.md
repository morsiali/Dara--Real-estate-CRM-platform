# Role & permission matrix (generated from server/rbac.js)

Values: **Own** (records they own) · **Team** (their team) · **Tenant** (whole brokerage) · **None**. Enforced server-side on every request; out-of-scope records return 404. Platform staff (Dara) have no access to brokerage data — only the platform console.

| Action | admin | manager | team_lead | agent |
|---|---|---|---|---|
| leads.read | Tenant | Tenant | Team | Own |
| leads.create | Tenant | Tenant | Team | Own |
| leads.update | Tenant | Tenant | Team | Own |
| leads.assign | Tenant | Tenant | Team | None |
| deals.read | Tenant | Tenant | Team | Own |
| deals.update | Tenant | Tenant | Team | Own |
| deals.reopen | Tenant | Tenant | None | None |
| properties.read | Tenant | Tenant | Tenant | Tenant |
| properties.update | Tenant | Tenant | Team | Own |
| tasks.read | Tenant | Tenant | Team | Own |
| tasks.assign | Tenant | Tenant | Team | Own |
| tasks.review | Tenant | Tenant | Team | None |
| events.read | Tenant | Tenant | Team | Own |
| events.create | Tenant | Tenant | Team | Own |
| dashboard.member | Tenant | Tenant | Team | Own |
| dashboard.main | Tenant | Tenant | Tenant | Tenant |
| leaderboard.read | Tenant | Tenant | Tenant | Tenant |
| analytics.time | Tenant | Tenant | Team | None |
| goals.set | Tenant | Tenant | Team | None |
| announcements.create | Tenant | Tenant | None | None |
| users.manage | Tenant | Tenant | None | None |
| teams.manage | Tenant | None | None | None |
| audit.read | Tenant | Tenant | None | None |
| projects.manage | Tenant | Tenant | None | None |
| reservations.read | Tenant | Tenant | Team | Own |
| reservations.create | Tenant | Tenant | Team | Own |
| reservations.confirm | Tenant | Tenant | None | None |
| reservations.renew | Tenant | Tenant | None | None |
| compliance.read | Tenant | Tenant | Team | Own |
| workspace.manage | Tenant | None | None | None |
| data.export | Tenant | None | None | None |
| chat.use | Tenant | Tenant | Tenant | Tenant |
| channels.create | Tenant | Tenant | Team | None |

Additional rules: managers create/edit only agents and team leads (admins: any role); nobody can deactivate themselves or change their own role; a task assignee cannot approve their own task unless management; team leads cannot set their own goals; confirmed reservations are cancelled by management only; any write is refused while the workspace is read-only (except sign-in, sign-out and password change).
