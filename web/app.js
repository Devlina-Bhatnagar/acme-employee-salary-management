/* global React, ReactDOM */
/* ACME HR client — JSX source, compiled to /app.js for a zero-build Docker deployment. */
const COUNTRY_NAMES = { US: 'United States', IN: 'India', GB: 'United Kingdom', DE: 'Germany', CA: 'Canada' };
const COUNTRY_CURRENCY = { US: 'USD', IN: 'INR', GB: 'GBP', DE: 'EUR', CA: 'CAD' };
const DEPARTMENTS = ['Engineering', 'Product', 'Sales', 'Marketing', 'Finance', 'People', 'Operations', 'Support'];
const TODAY = new Date().toISOString().slice(0, 10); // Business-effective calendar date (UTC)
const emptyEmployee = () => ({ employee_code: '', full_name: '', email: '', country: 'US', department: 'Engineering', job_title: '', currency: 'USD', annual_salary: '' });
const money = (minor, currency) => {
    if (minor == null)
        return '—';
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(minor / 100);
    }
    catch (_) {
        return `${currency} ${(minor / 100).toLocaleString()}`;
    }
};
const moneyExact = (minor, currency) => {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
    }
    catch (_) {
        return `${currency} ${(minor / 100).toFixed(2)}`;
    }
};
const initials = name => (name || '?').split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
const errorMessage = detail => {
    if (typeof detail === 'string')
        return detail;
    if (Array.isArray(detail))
        return detail.map(item => item.msg).join('; ');
    return 'Something went wrong. Please try again.';
};
class App extends React.Component {
    constructor(props) {
        super(props);
        const token = sessionStorage.getItem('acme_hr_token') || '';
        this.state = {
            token, authChecked: !token, user: null, loginEmail: '', loginPassword: '',
            tab: 'dashboard', busy: false, error: '', toast: '',
            report: null, employees: { items: [], total: 0, page: 1, pages: 0 },
            filterCountry: '', filterDepartment: '', search: '', status: 'active', sort: 'name', page: 1,
            selected: null, detailBusy: false, modal: '', addForm: emptyEmployee(), editForm: {},
            salaryForm: { annual_salary: '', effective_on: TODAY, reason: '' }, importFile: null, importStatus: '',
        };
        this.employeeLoadId = 0;
        this.searchDelay = null;
    }
    componentDidMount() {
        if (this.state.token)
            this.checkSession();
    }
    componentWillUnmount() { clearTimeout(this.searchDelay); }
    async api(path, opts = {}) {
        const headers = { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
        if (this.state.token)
            headers.Authorization = `Bearer ${this.state.token}`;
        const response = await fetch(`/api${path}`, { ...opts, headers, cache: 'no-store' });
        if (!response.ok) {
            let detail = null;
            try {
                detail = (await response.json()).detail;
            }
            catch (_) {
                detail = null;
            }
            if (response.status === 401 && path !== '/auth/login')
                this.logout(true);
            throw new Error(errorMessage(detail) || `HTTP ${response.status}`);
        }
        if (opts.asBlob)
            return response.blob();
        return response.json();
    }
    async checkSession() {
        try {
            const user = await this.api('/auth/me');
            this.setState({ user, authChecked: true }, () => this.refreshAll());
        }
        catch (_) {
            this.logout(true);
        }
    }
    logout(expired = false) {
        sessionStorage.removeItem('acme_hr_token');
        this.setState({ token: '', user: null, authChecked: true, selected: null, error: expired ? 'Your session ended. Please sign in again.' : '', loginPassword: '' });
    }
    async login(e) {
        e.preventDefault();
        this.setState({ busy: true, error: '' });
        try {
            const result = await this.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: this.state.loginEmail, password: this.state.loginPassword }) });
            sessionStorage.setItem('acme_hr_token', result.access_token);
            this.setState({ token: result.access_token, user: result.user, busy: false, loginPassword: '', authChecked: true }, () => this.refreshAll());
        }
        catch (err) {
            this.setState({ error: err.message, busy: false });
        }
    }
    refreshAll() { this.loadReport(); this.loadEmployees(); }
    async loadReport() {
        try {
            const params = new URLSearchParams();
            if (this.state.filterCountry)
                params.set('country', this.state.filterCountry);
            if (this.state.filterDepartment)
                params.set('department', this.state.filterDepartment);
            const report = await this.api(`/reports/summary?${params}`);
            this.setState({ report });
        }
        catch (err) {
            this.setState({ error: err.message });
        }
    }
    async loadEmployees() {
        const requestId = ++this.employeeLoadId;
        try {
            const params = new URLSearchParams({ page: String(this.state.page), page_size: '20', status: this.state.status, sort: this.state.sort });
            if (this.state.filterCountry)
                params.set('country', this.state.filterCountry);
            if (this.state.filterDepartment)
                params.set('department', this.state.filterDepartment);
            if (this.state.search.trim())
                params.set('search', this.state.search.trim());
            const employees = await this.api(`/employees?${params}`);
            if (requestId === this.employeeLoadId)
                this.setState({ employees });
        }
        catch (err) {
            if (requestId === this.employeeLoadId)
                this.setState({ error: err.message });
        }
    }
    filter(field, value, debounce = false) {
        const resetSort = field === 'filterCountry' && !value && this.state.sort.startsWith('salary_');
        this.setState({ [field]: value, page: 1, ...(resetSort ? { sort: 'name' } : {}) }, () => {
            if (field === 'filterCountry' || field === 'filterDepartment')
                this.loadReport();
            clearTimeout(this.searchDelay);
            this.searchDelay = setTimeout(() => this.loadEmployees(), debounce ? 250 : 0);
        });
    }
    changePage(page) { this.setState({ page }, () => this.loadEmployees()); }
    changeTab(tab) { this.setState({ tab, modal: '', selected: null, error: '' }); }
    notify(message) { this.setState({ toast: message, error: '' }); }
    async openEmployee(id) {
        this.setState({ detailBusy: true, modal: 'detail', selected: null, error: '' });
        try {
            const selected = await this.api(`/employees/${id}`);
            const editForm = { full_name: selected.full_name, email: selected.email, department: selected.department, job_title: selected.job_title, status: selected.status };
            this.setState({ selected, editForm, detailBusy: false, salaryForm: { annual_salary: (selected.current_salary_minor / 100).toFixed(2), effective_on: TODAY, reason: '' } });
        }
        catch (err) {
            this.setState({ modal: '', error: err.message, detailBusy: false });
        }
    }
    async saveSalary(e) {
        e.preventDefault();
        const selected = this.state.selected;
        if (!selected)
            return;
        this.setState({ busy: true, error: '' });
        try {
            const detail = await this.api(`/employees/${selected.id}/salary`, { method: 'POST', body: JSON.stringify(this.state.salaryForm) });
            this.setState({ selected: detail, busy: false, modal: 'detail', salaryForm: { annual_salary: (detail.current_salary_minor / 100).toFixed(2), effective_on: TODAY, reason: '' } });
            this.notify('Salary updated and recorded in history.');
            this.refreshAll();
        }
        catch (err) {
            this.setState({ busy: false, error: err.message });
        }
    }
    async saveProfile(e) {
        e.preventDefault();
        this.setState({ busy: true, error: '' });
        try {
            const selected = this.state.selected;
            await this.api(`/employees/${selected.id}`, { method: 'PATCH', body: JSON.stringify(this.state.editForm) });
            const detail = await this.api(`/employees/${selected.id}`);
            this.setState({ selected: detail, modal: 'detail', busy: false });
            this.notify('Employee profile updated.');
            this.refreshAll();
        }
        catch (err) {
            this.setState({ busy: false, error: err.message });
        }
    }
    async deactivate() {
        if (!window.confirm('Mark this employee inactive? Salary history will be retained.'))
            return;
        this.setState({ editForm: { ...this.state.editForm, status: 'inactive' } }, async () => {
            try {
                const employee = this.state.selected;
                await this.api(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) });
                const detail = await this.api(`/employees/${employee.id}`);
                this.setState({ selected: detail, modal: 'detail' });
                this.notify('Employee deactivated. History was preserved.');
                this.refreshAll();
            }
            catch (err) {
                this.setState({ error: err.message });
            }
        });
    }
    async addEmployee(e) {
        e.preventDefault();
        this.setState({ busy: true, error: '' });
        try {
            const employee = await this.api('/employees', { method: 'POST', body: JSON.stringify(this.state.addForm) });
            this.setState({ busy: false, addForm: emptyEmployee(), modal: '' });
            this.notify(`Employee ${employee.employee_code} created.`);
            this.refreshAll();
            this.changeTab('employees');
        }
        catch (err) {
            this.setState({ busy: false, error: err.message });
        }
    }
    async importCsv(e) {
        e.preventDefault();
        if (!this.state.importFile)
            return;
        const data = new FormData();
        data.append('file', this.state.importFile);
        this.setState({ busy: true, importStatus: '', error: '' });
        try {
            const result = await this.api('/employees/import', { method: 'POST', body: data });
            this.setState({ busy: false, importFile: null, importStatus: `${result.imported} employees successfully imported. All rows validated.` });
            this.notify('Import successful.');
            this.refreshAll();
        }
        catch (err) {
            this.setState({ busy: false, error: err.message });
        }
    }
    async exportCsv() {
        this.setState({ busy: true, error: '' });
        try {
            const params = new URLSearchParams({ status: this.state.status });
            if (this.state.filterCountry)
                params.set('country', this.state.filterCountry);
            if (this.state.filterDepartment)
                params.set('department', this.state.filterDepartment);
            if (this.state.search.trim())
                params.set('search', this.state.search.trim());
            const blob = await this.api(`/employees/export?${params}`, { asBlob: true });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'acme-employees.csv';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.setState({ busy: false });
            this.notify('Filtered employee CSV exported.');
        }
        catch (err) {
            this.setState({ busy: false, error: err.message });
        }
    }
    renderLogin() {
        return React.createElement("div", { className: "login-screen" },
            React.createElement("div", { className: "login-art" },
                React.createElement("div", { className: "brand brand-light" },
                    React.createElement("span", { className: "brand-mark" }, "A"),
                    React.createElement("span", null,
                        "acme",
                        React.createElement("span", { className: "brand-dot" }, "."))),
                React.createElement("div", { className: "login-illustration" },
                    React.createElement("div", { className: "login-illustration-orb" }),
                    React.createElement("div", { className: "illustration-card big" },
                        React.createElement("span", null, "Annual payroll clarity"),
                        React.createElement("strong", null, "10,000 people"),
                        React.createElement("div", { className: "illustration-bars" },
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null))),
                    React.createElement("div", { className: "illustration-card small" }, "\u2197 \u00A0 Better decisions")),
                React.createElement("h1", null,
                    "People first.",
                    React.createElement("br", null),
                    "Pay with clarity."),
                React.createElement("p", null, "One secure workspace to understand and manage compensation across countries."),
                React.createElement("div", { className: "login-foot" }, "ACME HR Workspace \u2022 Internal use only")),
            React.createElement("div", { className: "login-panel" },
                React.createElement("div", { className: "login-box" },
                    React.createElement("span", { className: "eyebrow" }, "WELCOME BACK"),
                    React.createElement("h2", null, "Sign in to your workspace"),
                    React.createElement("p", null, "Manage employee salary data with confidence."),
                    this.state.error && React.createElement("div", { className: "alert danger", role: "alert" }, this.state.error),
                    React.createElement("form", { onSubmit: e => this.login(e) },
                        React.createElement("label", null,
                            "Email address",
                            React.createElement("input", { "aria-label": "Email address", required: true, type: "email", autoComplete: "username", value: this.state.loginEmail, onChange: e => this.setState({ loginEmail: e.target.value }), placeholder: "hr@acme.example.invalid" })),
                        React.createElement("label", null,
                            "Password",
                            React.createElement("input", { "aria-label": "Password", required: true, type: "password", autoComplete: "current-password", value: this.state.loginPassword, onChange: e => this.setState({ loginPassword: e.target.value }), placeholder: "Enter your password" })),
                        React.createElement("button", { className: "button button-primary login-submit", disabled: this.state.busy },
                            " ",
                            this.state.busy ? 'Signing in…' : 'Sign in →',
                            " ")),
                    React.createElement("div", { className: "security-note" }, "\u25C8 \u00A0 Encrypted session \u2022 Authorized HR personnel only"))));
    }
    renderSidebar() {
        return React.createElement("aside", { className: "sidebar" },
            React.createElement("div", { className: "brand" },
                React.createElement("span", { className: "brand-mark" }, "A"),
                React.createElement("span", null,
                    "acme",
                    React.createElement("span", { className: "brand-dot" }, "."))),
            React.createElement("div", { className: "workspace-label" }, "HR WORKSPACE"),
            React.createElement("nav", { "aria-label": "Main navigation" },
                React.createElement("button", { className: `nav-item ${this.state.tab === 'dashboard' ? 'active' : ''}`, onClick: () => this.changeTab('dashboard') },
                    React.createElement("span", null, "\u25A6"),
                    " Overview"),
                React.createElement("button", { className: `nav-item ${this.state.tab === 'employees' ? 'active' : ''}`, onClick: () => this.changeTab('employees') },
                    React.createElement("span", null, "\u2659"),
                    " Employees"),
                React.createElement("button", { className: `nav-item ${this.state.tab === 'import' ? 'active' : ''}`, onClick: () => this.changeTab('import') },
                    React.createElement("span", null, "\u21E7"),
                    " Import data")),
            React.createElement("div", { className: "side-bottom" },
                React.createElement("div", { className: "side-tip" },
                    React.createElement("span", { className: "side-tip-icon" }, "\u2726"),
                    React.createElement("strong", null, "Built for clarity"),
                    React.createElement("p", null, "Compensation insights, always in the correct local currency.")),
                React.createElement("div", { className: "side-user" },
                    React.createElement("span", { className: "user-avatar" }, "HR"),
                    React.createElement("div", null,
                        React.createElement("strong", null, "HR Administrator"),
                        React.createElement("small", null, this.state.user && this.state.user.email)),
                    React.createElement("button", { title: "Sign out", "aria-label": "Sign out", onClick: () => this.logout() }, "\u21AA"))));
    }
    renderHeader() {
        const tabName = { dashboard: 'Overview', employees: 'Employees', import: 'Import data' }[this.state.tab];
        return React.createElement("header", { className: "topbar" },
            React.createElement("div", { className: "breadcrumb" },
                "ACME ",
                React.createElement("span", null, "/"),
                " HR Workspace ",
                React.createElement("span", null, "/"),
                " ",
                React.createElement("strong", null, tabName)),
            React.createElement("div", { className: "header-right" },
                React.createElement("span", { className: "secure-pill" },
                    React.createElement("span", { className: "status-dot" }),
                    " Secure workspace"),
                React.createElement("div", { className: "avatar-small" }, "HR")));
    }
    renderFilters(includeStatus = false) {
        return React.createElement("div", { className: "filters" },
            React.createElement("label", { className: "select-label" },
                "Country",
                React.createElement("select", { "aria-label": "Country filter", value: this.state.filterCountry, onChange: e => this.filter('filterCountry', e.target.value) },
                    React.createElement("option", { value: "" }, "All countries"),
                    Object.keys(COUNTRY_NAMES).map(code => React.createElement("option", { key: code, value: code }, COUNTRY_NAMES[code])))),
            React.createElement("label", { className: "select-label" },
                "Department",
                React.createElement("select", { "aria-label": "Department filter", value: this.state.filterDepartment, onChange: e => this.filter('filterDepartment', e.target.value) },
                    React.createElement("option", { value: "" }, "All departments"),
                    DEPARTMENTS.map(d => React.createElement("option", { key: d, value: d }, d)))),
            includeStatus && React.createElement("label", { className: "select-label" },
                "Status",
                React.createElement("select", { "aria-label": "Status filter", value: this.state.status, onChange: e => this.filter('status', e.target.value) },
                    React.createElement("option", { value: "active" }, "Active only"),
                    React.createElement("option", { value: "inactive" }, "Inactive only"),
                    React.createElement("option", { value: "all" }, "All employees"))));
    }
    renderDashboard() {
        const report = this.state.report;
        return React.createElement("div", { className: "page" },
            React.createElement("div", { className: "page-head" },
                React.createElement("div", null,
                    React.createElement("span", { className: "eyebrow" }, "COMPENSATION INTELLIGENCE"),
                    React.createElement("h1", null, "People & pay, at a glance"),
                    React.createElement("p", null, "Accurate compensation insights for your global team.")),
                React.createElement("button", { className: "button button-primary", onClick: () => { this.setState({ modal: 'add', addForm: emptyEmployee() }); } }, "+ Add employee")),
            React.createElement("div", { className: "welcome-banner" },
                React.createElement("div", null,
                    React.createElement("span", { className: "welcome-eyebrow" }, "YOUR ORGANIZATION"),
                    React.createElement("h2", null,
                        "Better decisions start",
                        React.createElement("br", null),
                        "with clearer data."),
                    React.createElement("p", null, "Explore pay trends across locations and teams \u2014 all in one place.")),
                React.createElement("div", { className: "banner-design" },
                    React.createElement("div", { className: "circles" }),
                    React.createElement("div", { className: "banner-card" },
                        React.createElement("span", null, "GLOBAL WORKFORCE"),
                        React.createElement("strong", null, (report && report.headcount || 0).toLocaleString()),
                        React.createElement("small", null, "Active employees")))),
            React.createElement("div", { className: "section-row" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Compensation snapshot"),
                    React.createElement("p", null, "Annual base pay \u2022 Active employees only")),
                this.renderFilters()),
            React.createElement("div", { className: "stats-grid" },
                React.createElement("div", { className: "stat-card" },
                    React.createElement("div", { className: "stat-icon lilac" }, "\u2659"),
                    React.createElement("div", { className: "stat-label" }, "Active headcount"),
                    React.createElement("strong", null, report ? report.headcount.toLocaleString() : '—'),
                    React.createElement("span", { className: "stat-meta" }, "Within selected filters")),
                React.createElement("div", { className: "stat-card" },
                    React.createElement("div", { className: "stat-icon blue" }, "\u25CE"),
                    React.createElement("div", { className: "stat-label" }, "Countries represented"),
                    React.createElement("strong", null, report ? new Set(report.groups.map(item => item.country)).size : '—'),
                    React.createElement("span", { className: "stat-meta" }, "Across your organization")),
                React.createElement("div", { className: "stat-card" },
                    React.createElement("div", { className: "stat-icon amber" }, "\u25A5"),
                    React.createElement("div", { className: "stat-label" }, "Departments"),
                    React.createElement("strong", null, report ? new Set(report.groups.map(item => item.department)).size : '—'),
                    React.createElement("span", { className: "stat-meta" }, "With active employees")),
                React.createElement("div", { className: "stat-card" },
                    React.createElement("div", { className: "stat-icon mint" }, "\u25C8"),
                    React.createElement("div", { className: "stat-label" }, "Currencies tracked"),
                    React.createElement("strong", null, report ? report.currencies.length : '—'),
                    React.createElement("span", { className: "stat-meta" }, "Reported separately"))),
            React.createElement("div", { className: "info-banner" },
                React.createElement("span", { className: "info-symbol" }, "i"),
                React.createElement("div", null,
                    React.createElement("strong", null, "Currency-aware analytics"),
                    React.createElement("p", null, "Totals and averages are shown separately per currency to avoid misleading global comparisons."))),
            React.createElement("div", { className: "dashboard-columns" },
                React.createElement("section", { className: "panel" },
                    React.createElement("div", { className: "panel-title" },
                        React.createElement("div", null,
                            React.createElement("h3", null, "Salary by currency"),
                            React.createElement("p", null, "Annual base salary for active employees")),
                        React.createElement("span", { className: "panel-tag" }, "LIVE DATA")),
                    React.createElement("div", { className: "currency-list" }, report && report.by_currency.length ? report.by_currency.map(row => React.createElement("div", { className: "currency-row", key: row.currency },
                        React.createElement("div", { className: "currency-avatar" }, row.currency.slice(0, 1)),
                        React.createElement("div", { className: "currency-main" },
                            React.createElement("strong", null,
                                row.currency,
                                " ",
                                React.createElement("small", null,
                                    "\u2022 ",
                                    row.headcount.toLocaleString(),
                                    " people")),
                            React.createElement("div", { className: "currency-track" },
                                React.createElement("span", { style: { width: `${Math.max(4, row.headcount / report.headcount * 100)}%` } }))),
                        React.createElement("div", { className: "currency-numbers" },
                            React.createElement("strong", null, money(row.total_salary_minor, row.currency)),
                            React.createElement("small", null,
                                "Avg ",
                                money(row.average_salary_minor, row.currency))))) : React.createElement("div", { className: "empty-state" }, "No salary data matches these filters."))),
                React.createElement("section", { className: "panel" },
                    React.createElement("div", { className: "panel-title" },
                        React.createElement("div", null,
                            React.createElement("h3", null, "Pay distribution"),
                            React.createElement("p", null, "Salary bands in local currency"))),
                    report && report.salary_bands.length ? React.createElement("div", { className: "band-list" },
                        report.currencies.map(currency => { const items = report.salary_bands.filter(b => b.currency === currency); const total = items.reduce((acc, b) => acc + b.headcount, 0); return React.createElement("div", { className: "band-group", key: currency },
                            React.createElement("div", { className: "band-header" },
                                React.createElement("strong", null, currency),
                                React.createElement("small", null,
                                    total.toLocaleString(),
                                    " employees")),
                            React.createElement("div", { className: "band-track" }, items.map((b, i) => React.createElement("span", { key: b.band, className: `band-color c${i}`, style: { width: `${total ? b.headcount / total * 100 : 0}%` }, title: `${b.band}: ${b.headcount}` })))); }),
                        React.createElement("div", { className: "legend" },
                            React.createElement("span", null,
                                React.createElement("i", { className: "c0" }),
                                " Under 50k"),
                            React.createElement("span", null,
                                React.createElement("i", { className: "c1" }),
                                " 50\u2013100k"),
                            React.createElement("span", null,
                                React.createElement("i", { className: "c2" }),
                                " 100\u2013200k"),
                            React.createElement("span", null,
                                React.createElement("i", { className: "c3" }),
                                " 200k+"))) : React.createElement("div", { className: "empty-state" }, "No matching employees."))),
            React.createElement("section", { className: "panel breakdown" },
                React.createElement("div", { className: "panel-title" },
                    React.createElement("div", null,
                        React.createElement("h3", null, "Department & country breakdown"),
                        React.createElement("p", null, "Answer compensation questions by location and team"))),
                React.createElement("div", { className: "table-wrap" },
                    React.createElement("table", null,
                        React.createElement("thead", null,
                            React.createElement("tr", null,
                                React.createElement("th", null, "COUNTRY"),
                                React.createElement("th", null, "DEPARTMENT"),
                                React.createElement("th", null, "EMPLOYEES"),
                                React.createElement("th", null, "AVG ANNUAL BASE"),
                                React.createElement("th", null, "TOTAL ANNUAL BASE"))),
                        React.createElement("tbody", null, report && report.groups.length ? report.groups.map((g, i) => React.createElement("tr", { key: i },
                            React.createElement("td", null, COUNTRY_NAMES[g.country] || g.country),
                            React.createElement("td", null, g.department),
                            React.createElement("td", null, g.headcount.toLocaleString()),
                            React.createElement("td", { className: "money-cell" }, money(g.average_salary_minor, g.currency)),
                            React.createElement("td", { className: "money-cell" }, money(g.total_salary_minor, g.currency)))) : React.createElement("tr", null,
                            React.createElement("td", { colSpan: "5", className: "empty-state" }, "No records for the selected filters.")))))));
    }
    renderEmployees() {
        const data = this.state.employees;
        return React.createElement("div", { className: "page" },
            React.createElement("div", { className: "page-head" },
                React.createElement("div", null,
                    React.createElement("span", { className: "eyebrow" }, "EMPLOYEE DIRECTORY"),
                    React.createElement("h1", null, "Your people, in one place"),
                    React.createElement("p", null, "Search, review, and update compensation records across your workforce.")),
                React.createElement("div", { className: "head-buttons" },
                    React.createElement("button", { className: "button button-outline", disabled: this.state.busy, onClick: () => this.exportCsv() }, "\u21E9 Export CSV"),
                    React.createElement("button", { className: "button button-primary", onClick: () => this.setState({ modal: 'add', addForm: emptyEmployee() }) }, "+ Add employee"))),
            React.createElement("section", { className: "panel directory-panel" },
                React.createElement("div", { className: "dir-top" },
                    React.createElement("div", { className: "dir-heading" },
                        React.createElement("h2", null,
                            "All employees ",
                            React.createElement("span", { className: "count-pill" }, data.total.toLocaleString())),
                        React.createElement("p", null, "Browse and manage salary information")),
                    React.createElement("div", { className: "dir-search" },
                        React.createElement("span", null, "\u2315"),
                        React.createElement("input", { "aria-label": "Search employees", value: this.state.search, onChange: e => this.filter('search', e.target.value, true), placeholder: "Search name, ID or email..." }))),
                React.createElement("div", { className: "directory-filters" },
                    this.renderFilters(true),
                    React.createElement("label", { className: "select-label" },
                        "Sort by",
                        React.createElement("select", { "aria-label": "Sort employees", value: this.state.sort, onChange: e => this.filter('sort', e.target.value) },
                            React.createElement("option", { value: "name" }, "Name A\u2013Z"),
                            React.createElement("option", { value: "salary_asc", disabled: !this.state.filterCountry }, "Salary low\u2013high (select country)"),
                            React.createElement("option", { value: "salary_desc", disabled: !this.state.filterCountry }, "Salary high\u2013low (select country)"),
                            React.createElement("option", { value: "updated" }, "Recently updated")))),
                React.createElement("div", { className: "table-wrap" },
                    React.createElement("table", null,
                        React.createElement("thead", null,
                            React.createElement("tr", null,
                                React.createElement("th", null, "EMPLOYEE"),
                                React.createElement("th", null, "ID"),
                                React.createElement("th", null, "COUNTRY"),
                                React.createElement("th", null, "DEPARTMENT"),
                                React.createElement("th", null, "ANNUAL BASE SALARY"),
                                React.createElement("th", null, "STATUS"),
                                React.createElement("th", null))),
                        React.createElement("tbody", null, data.items.length ? data.items.map(e => React.createElement("tr", { key: e.id, className: "clickable", onClick: () => this.openEmployee(e.id) },
                            React.createElement("td", null,
                                React.createElement("div", { className: "person-cell" },
                                    React.createElement("span", { className: "person-avatar" }, initials(e.full_name)),
                                    React.createElement("div", null,
                                        React.createElement("strong", null, e.full_name),
                                        React.createElement("small", null, e.email)))),
                            React.createElement("td", { className: "mono" }, e.employee_code),
                            React.createElement("td", null, COUNTRY_NAMES[e.country]),
                            React.createElement("td", null, e.department),
                            React.createElement("td", { className: "money-cell" }, money(e.current_salary_minor, e.currency)),
                            React.createElement("td", null,
                                React.createElement("span", { className: `status ${e.status}` }, e.status)),
                            React.createElement("td", null,
                                React.createElement("button", { className: "icon-button", "aria-label": `View ${e.full_name}`, onClick: event => { event.stopPropagation(); this.openEmployee(e.id); } }, "\u2192")))) : React.createElement("tr", null,
                            React.createElement("td", { colSpan: "7", className: "empty-state" }, "No employees match these filters."))))),
                React.createElement("div", { className: "pagination" },
                    React.createElement("span", null,
                        "Showing ",
                        data.total ? (data.page - 1) * data.page_size + 1 : 0,
                        "\u2013",
                        Math.min(data.page * data.page_size, data.total),
                        " of ",
                        data.total.toLocaleString(),
                        " records"),
                    React.createElement("div", null,
                        React.createElement("button", { disabled: data.page <= 1, onClick: () => this.changePage(data.page - 1) }, "\u2190 Previous"),
                        React.createElement("span", null,
                            "Page ",
                            data.page,
                            " / ",
                            Math.max(1, data.pages)),
                        React.createElement("button", { disabled: data.page >= data.pages, onClick: () => this.changePage(data.page + 1) }, "Next \u2192")))));
    }
    renderImport() {
        return React.createElement("div", { className: "page" },
            React.createElement("div", { className: "page-head" },
                React.createElement("div", null,
                    React.createElement("span", { className: "eyebrow" }, "DATA MIGRATION"),
                    React.createElement("h1", null, "Bring your data together"),
                    React.createElement("p", null, "Move from spreadsheets to a secure, searchable salary workspace."))),
            React.createElement("div", { className: "import-layout" },
                React.createElement("section", { className: "panel upload-panel" },
                    React.createElement("div", { className: "upload-icon" }, "\u21E7"),
                    React.createElement("h2", null, "Import employee records"),
                    React.createElement("p", null, "Upload a CSV with your employee data. Every row is validated before any records are added."),
                    React.createElement("form", { onSubmit: e => this.importCsv(e) },
                        React.createElement("label", { className: "file-picker" },
                            React.createElement("strong", null, this.state.importFile ? this.state.importFile.name : 'Choose a CSV file'),
                            React.createElement("span", null, "CSV only \u2022 max 3 MB \u2022 up to 10,000 rows"),
                            React.createElement("input", { "aria-label": "Choose CSV file", type: "file", required: true, accept: ".csv,text/csv", onChange: e => this.setState({ importFile: e.target.files[0] || null }) })),
                        React.createElement("button", { className: "button button-primary", disabled: !this.state.importFile || this.state.busy }, this.state.busy ? 'Validating & importing…' : 'Import employees →')),
                    this.state.importStatus && React.createElement("div", { className: "alert success", role: "status" },
                        "\u2713 ",
                        this.state.importStatus)),
                React.createElement("section", { className: "panel tips-panel" },
                    React.createElement("h3", null, "Before you import"),
                    React.createElement("div", { className: "tips-item" },
                        React.createElement("span", null, "1"),
                        React.createElement("div", null,
                            React.createElement("strong", null, "Prepare your spreadsheet"),
                            React.createElement("p", null, "Use the exact columns listed in the template, including local annual base salary."))),
                    React.createElement("div", { className: "tips-item" },
                        React.createElement("span", null, "2"),
                        React.createElement("div", null,
                            React.createElement("strong", null, "Validate your countries"),
                            React.createElement("p", null, "Supported in this demo: US/USD, India/INR, UK/GBP, Germany/EUR, Canada/CAD."))),
                    React.createElement("div", { className: "tips-item" },
                        React.createElement("span", null, "3"),
                        React.createElement("div", null,
                            React.createElement("strong", null, "Prevent duplicates"),
                            React.createElement("p", null, "Employee ID and email must be unique. An invalid file imports no rows."))),
                    React.createElement("a", { className: "button button-outline template-link", href: "/import-template.csv", download: "acme-import-template.csv" }, "\u21E9 Download CSV template"))));
    }
    textInput(label, value, onChange, props = {}) { return React.createElement("label", { className: "form-field" },
        label,
        React.createElement("input", { value: value == null ? '' : value, onChange: onChange, ...props })); }
    renderModal() {
        const modal = this.state.modal;
        if (!modal)
            return null;
        const selected = this.state.selected;
        const addForm = this.state.addForm;
        const editForm = this.state.editForm;
        const salaryForm = this.state.salaryForm;
        return React.createElement("div", { className: "overlay", onMouseDown: e => { if (e.target === e.currentTarget)
                this.setState({ modal: '' }); } },
            React.createElement("div", { className: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Employee information" },
                React.createElement("div", { className: "drawer-top" },
                    React.createElement("div", null,
                        React.createElement("span", { className: "eyebrow" }, modal === 'add' ? 'NEW TEAM MEMBER' : 'EMPLOYEE RECORD'),
                        React.createElement("h2", null, modal === 'add' ? 'Add employee' : modal === 'salary' ? 'Update annual salary' : modal === 'edit' ? 'Edit profile' : 'Employee details')),
                    React.createElement("button", { className: "close-button", "aria-label": "Close dialog", onClick: () => this.setState({ modal: '' }) }, "\u00D7")),
                React.createElement("div", { className: "drawer-body" },
                    (modal === 'detail' && this.state.detailBusy) && React.createElement("div", { className: "empty-state" }, "Loading employee\u2026"),
                    modal === 'detail' && selected && React.createElement("div", null,
                        React.createElement("div", { className: "drawer-person" },
                            React.createElement("div", { className: "drawer-avatar" }, initials(selected.full_name)),
                            React.createElement("div", null,
                                React.createElement("h3", null, selected.full_name),
                                React.createElement("p", null,
                                    selected.job_title,
                                    " \u00B7 ",
                                    selected.department),
                                React.createElement("span", { className: `status ${selected.status}` }, selected.status))),
                        React.createElement("div", { className: "detail-grid" },
                            React.createElement("div", null,
                                React.createElement("small", null, "EMPLOYEE ID"),
                                React.createElement("strong", null, selected.employee_code)),
                            React.createElement("div", null,
                                React.createElement("small", null, "COUNTRY"),
                                React.createElement("strong", null, COUNTRY_NAMES[selected.country])),
                            React.createElement("div", null,
                                React.createElement("small", null, "EMAIL"),
                                React.createElement("strong", { className: "break-word" }, selected.email)),
                            React.createElement("div", null,
                                React.createElement("small", null, "DEPARTMENT"),
                                React.createElement("strong", null, selected.department))),
                        React.createElement("div", { className: "salary-highlight" },
                            React.createElement("small", null, "CURRENT ANNUAL BASE SALARY"),
                            React.createElement("strong", null, moneyExact(selected.current_salary_minor, selected.currency)),
                            React.createElement("span", null,
                                "Local currency \u2022 ",
                                selected.currency)),
                        React.createElement("div", { className: "drawer-actions" },
                            React.createElement("button", { className: "button button-primary", disabled: selected.status !== 'active', onClick: () => this.setState({ modal: 'salary' }) }, "Update salary"),
                            React.createElement("button", { className: "button button-outline", onClick: () => this.setState({ modal: 'edit' }) }, "Edit profile")),
                        React.createElement("div", { className: "history-head" },
                            React.createElement("h3", null, "Salary history"),
                            React.createElement("span", null,
                                selected.salary_history.length,
                                " events")),
                        React.createElement("div", { className: "history-list" }, selected.salary_history.map((revision, i) => React.createElement("div", { className: "history-item", key: revision.id },
                            React.createElement("div", { className: "timeline-dot" }),
                            React.createElement("div", null,
                                React.createElement("div", { className: "history-line" },
                                    React.createElement("strong", null, moneyExact(revision.new_salary_minor, revision.currency)),
                                    React.createElement("small", null, revision.effective_on)),
                                React.createElement("p", null, revision.reason),
                                React.createElement("small", null,
                                    revision.changed_by_email || 'System seed',
                                    " ",
                                    revision.old_salary_minor != null ? `• From ${money(revision.old_salary_minor, revision.currency)}` : '• Initial salary'))))),
                        selected.status === 'active' && React.createElement("button", { className: "link-danger", onClick: () => this.deactivate() }, "Deactivate employee")),
                    modal === 'salary' && selected && React.createElement("form", { className: "edit-form", onSubmit: e => this.saveSalary(e) },
                        React.createElement("div", { className: "context-note" },
                            selected.full_name,
                            " \u2022 ",
                            selected.currency,
                            " \u2022 Current: ",
                            moneyExact(selected.current_salary_minor, selected.currency)),
                        this.textInput(`New annual base salary (${selected.currency})`, salaryForm.annual_salary, e => this.setState({ salaryForm: { ...salaryForm, annual_salary: e.target.value } }), { type: 'number', min: '0.01', max: '999999999.99', step: '0.01', required: true }),
                        this.textInput('Effective date (UTC)', salaryForm.effective_on, e => this.setState({ salaryForm: { ...salaryForm, effective_on: e.target.value } }), { type: 'date', max: TODAY, required: true }),
                        React.createElement("label", { className: "form-field" },
                            "Reason for salary change",
                            React.createElement("textarea", { minLength: "5", maxLength: "500", required: true, rows: "4", value: salaryForm.reason, placeholder: "e.g. Annual compensation review", onChange: e => this.setState({ salaryForm: { ...salaryForm, reason: e.target.value } }) })),
                        React.createElement("div", { className: "form-note" }, "This change is recorded permanently with the effective date and your HR account."),
                        React.createElement("div", { className: "drawer-actions" },
                            React.createElement("button", { disabled: this.state.busy, className: "button button-primary" }, this.state.busy ? 'Saving…' : 'Save salary change'),
                            React.createElement("button", { type: "button", className: "button button-outline", onClick: () => this.setState({ modal: 'detail' }) }, "Cancel"))),
                    modal === 'edit' && selected && React.createElement("form", { className: "edit-form", onSubmit: e => this.saveProfile(e) },
                        this.textInput('Full name', editForm.full_name, e => this.setState({ editForm: { ...editForm, full_name: e.target.value } }), { required: true }),
                        this.textInput('Email address', editForm.email, e => this.setState({ editForm: { ...editForm, email: e.target.value } }), { required: true, type: 'email' }),
                        React.createElement("label", { className: "form-field" },
                            "Department",
                            React.createElement("select", { value: editForm.department, onChange: e => this.setState({ editForm: { ...editForm, department: e.target.value } }) }, DEPARTMENTS.map(d => React.createElement("option", { key: d }, d)))),
                        this.textInput('Job title', editForm.job_title, e => this.setState({ editForm: { ...editForm, job_title: e.target.value } }), { required: true }),
                        React.createElement("label", { className: "form-field" },
                            "Status",
                            React.createElement("select", { value: editForm.status, onChange: e => this.setState({ editForm: { ...editForm, status: e.target.value } }) },
                                React.createElement("option", { value: "active" }, "Active"),
                                React.createElement("option", { value: "inactive" }, "Inactive"))),
                        React.createElement("div", { className: "form-note" }, "Country and currency are locked to preserve salary history consistency."),
                        React.createElement("div", { className: "drawer-actions" },
                            React.createElement("button", { disabled: this.state.busy, className: "button button-primary" }, this.state.busy ? 'Saving…' : 'Save profile'),
                            React.createElement("button", { type: "button", className: "button button-outline", onClick: () => this.setState({ modal: 'detail' }) }, "Cancel"))),
                    modal === 'add' && React.createElement("form", { className: "edit-form", onSubmit: e => this.addEmployee(e) },
                        this.textInput('Employee ID', addForm.employee_code, e => this.setState({ addForm: { ...addForm, employee_code: e.target.value } }), { placeholder: 'e.g. ACME-X1020', required: true }),
                        this.textInput('Full name', addForm.full_name, e => this.setState({ addForm: { ...addForm, full_name: e.target.value } }), { placeholder: 'e.g. Avery Quinn', required: true }),
                        this.textInput('Work email', addForm.email, e => this.setState({ addForm: { ...addForm, email: e.target.value } }), { type: 'email', required: true }),
                        React.createElement("label", { className: "form-field" },
                            "Country",
                            React.createElement("select", { value: addForm.country, onChange: e => this.setState({ addForm: { ...addForm, country: e.target.value, currency: COUNTRY_CURRENCY[e.target.value] } }) }, Object.keys(COUNTRY_NAMES).map(code => React.createElement("option", { key: code, value: code }, COUNTRY_NAMES[code])))),
                        React.createElement("label", { className: "form-field" },
                            "Department",
                            React.createElement("select", { value: addForm.department, onChange: e => this.setState({ addForm: { ...addForm, department: e.target.value } }) }, DEPARTMENTS.map(d => React.createElement("option", { key: d }, d)))),
                        this.textInput('Job title', addForm.job_title, e => this.setState({ addForm: { ...addForm, job_title: e.target.value } }), { required: true, placeholder: 'e.g. Software Engineer' }),
                        this.textInput(`Annual base salary (${addForm.currency})`, addForm.annual_salary, e => this.setState({ addForm: { ...addForm, annual_salary: e.target.value } }), { type: 'number', min: '0.01', max: '999999999.99', step: '0.01', required: true }),
                        React.createElement("div", { className: "form-note" }, "Only fictitious employee data belongs in this assessment environment."),
                        React.createElement("div", { className: "drawer-actions" },
                            React.createElement("button", { disabled: this.state.busy, className: "button button-primary" }, this.state.busy ? 'Saving…' : 'Create employee'),
                            React.createElement("button", { type: "button", className: "button button-outline", onClick: () => this.setState({ modal: '' }) }, "Cancel"))))));
    }
    render() {
        if (!this.state.authChecked)
            return React.createElement("div", { className: "boot" }, "Checking secure session\u2026");
        if (!this.state.token)
            return this.renderLogin();
        return React.createElement("div", { className: "shell" },
            this.renderSidebar(),
            React.createElement("main", { className: "main" },
                this.renderHeader(),
                this.state.error && React.createElement("div", { className: "alert danger global-error", role: "alert" },
                    this.state.error,
                    React.createElement("button", { onClick: () => this.setState({ error: '' }) }, "\u00D7")),
                this.state.toast && React.createElement("div", { className: "toast", role: "status" },
                    "\u2713 \u00A0",
                    this.state.toast,
                    React.createElement("button", { onClick: () => this.setState({ toast: '' }) }, "\u00D7")),
                this.state.tab === 'dashboard' && this.renderDashboard(),
                this.state.tab === 'employees' && this.renderEmployees(),
                this.state.tab === 'import' && this.renderImport()),
            this.renderModal());
    }
}
ReactDOM.render(React.createElement(App, null), document.getElementById('app'));
