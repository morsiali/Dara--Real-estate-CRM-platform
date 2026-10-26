// UI strings. English is the source; Arabic is a first draft that needs native-speaker review (see QUESTIONS.md).
const en = {
  'nav.workspace': 'Workspace', 'nav.sales': 'Sales', 'nav.work': 'Work', 'nav.admin': 'Administration',
  'nav.home': 'Main dashboard', 'nav.me': 'My dashboard', 'nav.team': 'Team control', 'nav.leaderboard': 'Leaderboard',
  'nav.leads': 'Leads', 'nav.pipeline': 'Pipeline', 'nav.listings': 'Listings', 'nav.tasks': 'Tasks', 'nav.calendar': 'Calendar',
  'nav.chat': 'Team chat', 'nav.projects': 'Projects', 'nav.reservations': 'Reservations', 'nav.settings': 'Workspace & compliance', 'nav.platform': 'Platform console', 'nav.platformGroup': 'Dara platform', 'nav.time': 'Time insights', 'nav.people': 'People & teams', 'nav.audit': 'Audit log',
  'period.today': 'Today', 'period.week': 'This week', 'period.month': 'This month', 'period.quarter': 'This quarter', 'period.year': 'This year',
  'role.admin': 'Administrator', 'role.manager': 'Manager', 'role.team_lead': 'Team lead', 'role.agent': 'Agent',
  'kpi.won_volume': 'Closed volume', 'kpi.deals_won': 'Deals won', 'kpi.commission_won': 'Gross commission', 'kpi.viewings_done': 'Viewings done',
  'kpi.leads_new': 'New leads', 'kpi.leads_qualified': 'Leads qualified', 'kpi.calls_logged': 'Calls', 'kpi.meetings_held': 'Meetings held',
  'kpi.tasks_approved': 'Tasks approved', 'kpi.tasks_on_time_rate': 'On-time tasks', 'kpi.meeting_hours': 'Hours in meetings', 'kpi.points': 'Points',
  'kpi.win_rate': 'Win rate', 'kpi.no_show_rate': 'No-show rate', 'kpi.pipeline_value': 'Open pipeline',
  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.retry': 'Try again', 'common.loading': 'Loading…',
  'common.vsPrev': 'vs previous', 'common.none': 'Nothing here yet', 'common.signout': 'Sign out', 'common.password': 'Change password', 'common.mfa': 'Two-step sign-in',
  'common.notifications': 'Notifications', 'common.markAll': 'Mark all read', 'common.language': 'العربية', 'common.search': 'Search',
  'common.all': 'All', 'common.new': 'New', 'common.edit': 'Edit', 'common.online': 'Online', 'common.viewAll': 'View all',
  'home.title': 'Main dashboard', 'home.sub': 'Company performance — visible to everyone', 'home.agenda': 'Your day', 'home.wins': 'Recent wins',
  'home.announcements': 'Announcements', 'home.top': 'Top performers', 'home.activity': 'Team activity', 'home.pipeline': 'Pipeline by stage',
  'home.post': 'Post announcement', 'home.rank': 'Your rank',
  'me.title': 'My dashboard', 'me.goals': 'Monthly goals', 'me.tasks': 'Open tasks', 'me.upcoming': 'Upcoming', 'me.achievements': 'Achievements',
  'me.points': 'Recent points', 'me.setGoals': 'Set goals',
  'team.title': 'Team control', 'team.sub': 'Every member’s numbers, workload and status', 'team.member': 'Member',
  'board.title': 'Leaderboard', 'board.sub': 'Points from closed deals, viewings, approved tasks and logged activity',
  'leads.title': 'Leads', 'leads.add': 'Add lead', 'nav.assistant': 'AI follow-up', 'ai.title': 'AI follow-up desk', 'pipeline.title': 'Pipeline', 'pipeline.add': 'New deal', 'listings.title': 'Listings', 'listings.add': 'Add listing',
  'tasks.title': 'Tasks', 'tasks.add': 'Assign task', 'calendar.title': 'Calendar', 'calendar.add': 'Schedule', 'chat.title': 'Team chat',
  'time.title': 'Time insights', 'people.title': 'People & teams', 'audit.title': 'Audit log',
};

const ar = {
  'nav.workspace': 'مساحة العمل', 'nav.sales': 'المبيعات', 'nav.work': 'العمل', 'nav.admin': 'الإدارة',
  'nav.home': 'اللوحة الرئيسية', 'nav.me': 'لوحتي', 'nav.team': 'متابعة الفريق', 'nav.leaderboard': 'لوحة المتصدرين',
  'nav.leads': 'العملاء المحتملون', 'nav.pipeline': 'الصفقات', 'nav.listings': 'العقارات', 'nav.tasks': 'المهام', 'nav.calendar': 'التقويم',
  'nav.chat': 'محادثة الفريق', 'nav.projects': 'المشاريع', 'nav.reservations': 'الحجوزات', 'nav.settings': 'مساحة العمل والامتثال', 'nav.platform': 'لوحة المنصة', 'nav.platformGroup': 'منصة دارا', 'nav.time': 'تحليل الوقت', 'nav.people': 'الأفراد والفرق', 'nav.audit': 'سجل التدقيق',
  'period.today': 'اليوم', 'period.week': 'هذا الأسبوع', 'period.month': 'هذا الشهر', 'period.quarter': 'هذا الربع', 'period.year': 'هذه السنة',
  'role.admin': 'مسؤول النظام', 'role.manager': 'مدير', 'role.team_lead': 'قائد فريق', 'role.agent': 'وكيل',
  'kpi.won_volume': 'قيمة الصفقات المغلقة', 'kpi.deals_won': 'صفقات ناجحة', 'kpi.commission_won': 'إجمالي العمولة', 'kpi.viewings_done': 'معاينات منجزة',
  'kpi.leads_new': 'عملاء جدد', 'kpi.leads_qualified': 'عملاء مؤهلون', 'kpi.calls_logged': 'مكالمات', 'kpi.meetings_held': 'اجتماعات منعقدة',
  'kpi.tasks_approved': 'مهام معتمدة', 'kpi.tasks_on_time_rate': 'مهام في موعدها', 'kpi.meeting_hours': 'ساعات الاجتماعات', 'kpi.points': 'النقاط',
  'kpi.win_rate': 'نسبة الفوز', 'kpi.no_show_rate': 'نسبة عدم الحضور', 'kpi.pipeline_value': 'قيمة الصفقات المفتوحة',
  'common.save': 'حفظ', 'common.cancel': 'إلغاء', 'common.close': 'إغلاق', 'common.retry': 'إعادة المحاولة', 'common.loading': 'جارٍ التحميل…',
  'common.vsPrev': 'مقارنة بالفترة السابقة', 'common.none': 'لا يوجد شيء بعد', 'common.signout': 'تسجيل الخروج', 'common.password': 'تغيير كلمة المرور', 'common.mfa': 'التحقق بخطوتين',
  'common.notifications': 'الإشعارات', 'common.markAll': 'تعليم الكل كمقروء', 'common.language': 'English', 'common.search': 'بحث',
  'common.all': 'الكل', 'common.new': 'جديد', 'common.edit': 'تعديل', 'common.online': 'متصل', 'common.viewAll': 'عرض الكل',
  'home.title': 'اللوحة الرئيسية', 'home.sub': 'أداء الشركة — متاح للجميع', 'home.agenda': 'يومك', 'home.wins': 'أحدث الصفقات الناجحة',
  'home.announcements': 'الإعلانات', 'home.top': 'الأفضل أداءً', 'home.activity': 'نشاط الفريق', 'home.pipeline': 'الصفقات حسب المرحلة',
  'home.post': 'نشر إعلان', 'home.rank': 'ترتيبك',
  'me.title': 'لوحتي', 'me.goals': 'الأهداف الشهرية', 'me.tasks': 'المهام المفتوحة', 'me.upcoming': 'القادم', 'me.achievements': 'الإنجازات',
  'me.points': 'أحدث النقاط', 'me.setGoals': 'تحديد الأهداف',
  'team.title': 'متابعة الفريق', 'team.sub': 'أرقام كل عضو وحجم عمله وحالته', 'team.member': 'العضو',
  'board.title': 'لوحة المتصدرين', 'board.sub': 'نقاط من الصفقات المغلقة والمعاينات والمهام المعتمدة والأنشطة المسجلة',
  'leads.title': 'العملاء المحتملون', 'leads.add': 'إضافة عميل', 'nav.assistant': 'متابعة بالذكاء الاصطناعي', 'ai.title': 'مكتب المتابعة الذكي', 'pipeline.title': 'الصفقات', 'pipeline.add': 'صفقة جديدة', 'listings.title': 'العقارات', 'listings.add': 'إضافة عقار',
  'tasks.title': 'المهام', 'tasks.add': 'إسناد مهمة', 'calendar.title': 'التقويم', 'calendar.add': 'جدولة', 'chat.title': 'محادثة الفريق',
  'time.title': 'تحليل الوقت', 'people.title': 'الأفراد والفرق', 'audit.title': 'سجل التدقيق',
};

let lang = 'en';
try { lang = localStorage.getItem('dara.lang') || 'en'; } catch { /* storage unavailable */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem('dara.lang', lang); } catch { /* ignore */ }
  applyDir();
}
export function applyDir() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
export function t(key, vars) {
  let s = (lang === 'ar' ? ar[key] : undefined) ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export const coverage = () => ({ en: Object.keys(en).length, ar: Object.keys(ar).length });
